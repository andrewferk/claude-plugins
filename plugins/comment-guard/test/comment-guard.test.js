const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const guard = require("../hooks/comment-guard.js");
const SCRIPT = path.join(__dirname, "..", "hooks", "comment-guard.js");
const FIXTURES = path.join(__dirname, "fixtures", "pr100");
const config = guard.DEFAULT_CONFIG;

function analyze(source, file = "src/example.ts") {
  return guard.analyzeSource(source, file, config);
}

function kinds(result) {
  return result.problems.map((p) => p.kind);
}

test("a comment citing an ADR is flagged", () => {
  const result = analyze(`/** A generated Short code is always exactly 7 base62 characters (ADR 0002). */\nexport const GENERATED_LENGTH = 7;\n`);
  assert.deepEqual(kinds(result), ["cites a document"]);
  assert.equal(result.problems[0].line, 1);
});

test("a citation appended to an existing comment block is reported at its own line", () => {
  const result = analyze("// Public surface of the package.\n// Workers import only what is exported here.\n// per ADR 0002\nexport { createLink } from \"./create-link\";\n");
  assert.deepEqual(kinds(result), ["cites a document"]);
  assert.equal(result.problems[0].line, 3);
  assert.equal(result.problems[0].endLine, 3);
  assert.equal(result.problems[0].text, "per ADR 0002");
});

test("every citing line in a block is its own problem", () => {
  const result = analyze("// Public surface of the package (ADR 0015).\n// Workers import only what is exported here.\n// per ADR 0002\nexport const a = 1;\n");
  assert.deepEqual(kinds(result), ["cites a document", "cites a document"]);
  assert.deepEqual(result.problems.map((p) => [p.line, p.text]), [[1, "Public surface of the package (ADR 0015)."], [3, "per ADR 0002"]]);
});

test("a problem judged on a whole block reports the block's line range", () => {
  const result = analyze("// Now we validate the input\n// and then normalise it\nconst x = 1;\n");
  assert.deepEqual(kinds(result), ["narrates the steps"]);
  assert.equal(result.problems[0].line, 1);
  assert.equal(result.problems[0].endLine, 2);
  const report = guard.formatReport([result], config);
  assert.match(report, /L1-L2 narrates the steps/);
});

test("issue, ticket, slice and spec-section references are flagged", () => {
  for (const text of ["// see ticket #94", "// (#94)", "// slice 1.2 of the plan", "// as required by spec section 3", "// per the ADR", "// PROJ-123 asked for this", "// see docs/adr/0009-keyed.md"]) {
    const result = analyze(`${text}\nconst x = 1;\n`);
    assert.deepEqual(kinds(result), ["cites a document"], text);
  }
});

test("standards names that look like ticket keys are not references", () => {
  for (const text of ["// hashed with SHA-256", "// dates are ISO-8601", "// RFC-7231 says 302 keeps the method", "// UTF-8 only"]) {
    const result = analyze(`${text}\nconst x = 1;\n`);
    assert.deepEqual(kinds(result), [], text);
  }
});

test("TODO with an issue number is allowed", () => {
  const result = analyze(`// TODO(#123): remove after the migration\nconst x = 1;\n`);
  assert.deepEqual(kinds(result), []);
});

test("a comment that restates the identifier is flagged", () => {
  const result = analyze(`/** Epoch ms. */\ntype EpochMs = number;\n`);
  assert.deepEqual(kinds(result), ["restates the name"]);
});

test("a units comment the type cannot express is allowed", () => {
  const result = analyze(`/** Epoch ms. */\nreadonly expiresAt?: number;\n`);
  assert.deepEqual(kinds(result), []);
});

test("narration and changelog comments are flagged", () => {
  assert.deepEqual(kinds(analyze(`// Now we validate the input\nvalidate(input);\n`)), ["narrates the steps"]);
  assert.deepEqual(kinds(analyze(`// First, load the config\nload();\n`)), ["narrates the steps"]);
  assert.deepEqual(kinds(analyze(`// Added to support retries\nconst retries = 3;\n`)), ["describes the change, not the code"]);
});

test("section banners and commented-out code are flagged", () => {
  assert.deepEqual(kinds(analyze(`// ---- Helpers ----\nfunction a() {}\n`)), ["section banner"]);
  assert.deepEqual(kinds(analyze(`// const old = compute(x);\nconst fresh = compute(y);\n`)), ["commented-out code"]);
});

test("a genuine why comment passes", () => {
  const source = `for (const byte of bytes) {\n  // 248 is the largest multiple of 62 a byte holds; a higher byte would skew the draw.\n  if (byte < 248) use(byte);\n}\n`;
  assert.deepEqual(kinds(analyze(source)), []);
});

test("pragmas and shebangs are ignored", () => {
  assert.deepEqual(kinds(analyze(`// eslint-disable-next-line no-console\nconsole.log(1);\n`)), []);
  assert.deepEqual(kinds(analyze(`#!/usr/bin/env python3\nx = 1\n`, "tool.py")), []);
  assert.deepEqual(kinds(analyze(`x = 1  # noqa: E501\n`, "tool.py")), []);
});

test("comment markers inside strings are not comments", () => {
  const result = analyze(`const url = "https://example.com/path"; // ADR 0001\nconst re = /\\/\\//;\n`);
  assert.equal(result.commentLines, 0);
  assert.deepEqual(kinds(result), ["cites a document"]);
});

test("consecutive line comments are one comment; a citation inside it is reported at the citing line", () => {
  const result = analyze(`const a = 1;\n\n// Letters, digits, '-' and '_' only. Other characters are excluded\n// because future routes depend on it (ADR 0002).\nconst RE = /x/;\n`);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].line, 4);
  assert.equal(result.problems[0].text, "because future routes depend on it (ADR 0002).");
});

test("python docstrings and hash comments are extracted", () => {
  const source = `def shard_name(n):\n    """Shard n's Durable Object name (ADR-0008)."""\n    return f"shard-{n}"\n\n# Now compute the total\ntotal = 0\n`;
  const result = analyze(source, "pkg/mod.py");
  assert.deepEqual(kinds(result), ["cites a document", "narrates the steps"]);
  assert.equal(result.commentLines, 2);
});

test("the comment budget is enforced on files with enough comments", () => {
  const dense = `// one\nconst a = 1;\n// two\nconst b = 2;\n// three\nconst c = 3;\nconst d = 4;\n`;
  assert.equal(analyze(dense).overBudget, true);
  const sparse = `// one\n${Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n")}\n`;
  assert.equal(analyze(sparse).overBudget, false);
});

test("config, docs, declaration and generated files are excluded", () => {
  for (const file of ["/repo/vitest.config.ts", "/repo/.eslintrc.js", "/repo/docs/x.ts", "/repo/types.d.ts", "/repo/node_modules/a/b.js", "/repo/.dependency-cruiser.js"]) {
    assert.equal(guard.isExcluded(file, config), true, file);
  }
  assert.equal(guard.isExcluded("/repo/packages/core/src/link.ts", config), false);
});

test("non-source files are skipped", () => {
  assert.equal(analyze("# Title\nSome prose", "README.md"), null);
  assert.equal(analyze("key: value # note", "config.yml"), null);
});

test("the PR #100 fixtures: every ADR citation is flagged and the why comments survive", () => {
  const shortCode = guard.analyzeFile(path.join(FIXTURES, "short-code.ts"), config);
  assert.equal(shortCode.problems.filter((p) => p.kind === "cites a document").length, 5);
  assert.equal(shortCode.overBudget, true);

  const generator = guard.analyzeFile(path.join(FIXTURES, "generator.ts"), config);
  assert.deepEqual(kinds(generator), ["cites a document"]);
  assert.ok(!generator.problems.some((p) => p.text.includes("248")));

  const link = guard.analyzeFile(path.join(FIXTURES, "link.ts"), config);
  assert.ok(!link.problems.some((p) => p.text.includes("outranks a live record")));

  const total = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".ts")).map((f) => guard.analyzeFile(path.join(FIXTURES, f), config)).reduce((n, r) => n + r.problems.filter((p) => p.kind === "cites a document").length, 0);
  assert.ok(total >= 25, `expected the fixtures to carry at least 25 ADR citations, found ${total}`);
});

function runHook(input, env = {}) {
  const proc = spawnSync("node", [SCRIPT, "--hook"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
  return { status: proc.status, stdout: proc.stdout.trim(), stderr: proc.stderr.trim() };
}

test("PostToolUse on Edit blocks a file that breaks the policy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "src", "thing.ts");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, `/** Creates the thing (ADR 0014). */\nexport function createThing() {}\n`);
  const result = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file }, cwd: dir });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /cites a document/);
});

test("PostToolUse on Edit stays silent for a clean file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, `export function createThing() {}\n`);
  const result = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file }, cwd: dir });
  assert.equal(result.stdout, "");
});

test("the policy is delivered once per session, on the first source file read or edited", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n");
  fs.writeFileSync(path.join(dir, "thing.ts"), "export function createThing() {}\n");
  fs.writeFileSync(path.join(dir, "bad.ts"), "// Now we create the thing\nexport function createThing() {}\n");
  const session_id = `policy-${process.pid}-${Date.now()}`;

  const markdown = runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(dir, "notes.md") }, cwd: dir, session_id });
  assert.equal(markdown.stdout, "", "a non-source file does not trigger the policy");

  const first = runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(dir, "thing.ts") }, cwd: dir, session_id });
  const context = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /# Code comments/);
  assert.match(context, /Decision record/);

  const second = runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(dir, "thing.ts") }, cwd: dir, session_id });
  assert.equal(second.stdout, "", "the same session is not told twice");

  const otherSession = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, "bad.ts") }, cwd: dir, session_id: `${session_id}-b` });
  const output = JSON.parse(otherSession.stdout);
  assert.equal(output.decision, "block", "a first edit that breaks the policy still blocks");
  assert.match(output.hookSpecificOutput.additionalContext, /# Code comments/, "and carries the policy alongside the block");
});

test("COMMENT_GUARD=warn turns a block into additional context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, `// Now we create the thing\nexport function createThing() {}\n`);
  const result = runHook({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file }, cwd: dir }, { COMMENT_GUARD: "warn" });
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /narrates the steps/);
});

test("PostToolUse on a mattpocock skill injects the policy and a skill-specific addendum", () => {
  const review = runHook({ hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "mattpocock-skills:code-review" }, cwd: os.tmpdir() });
  const reviewContext = JSON.parse(review.stdout).hookSpecificOutput.additionalContext;
  assert.match(reviewContext, /comment hygiene/);
  assert.match(reviewContext, /open that document/);

  const tdd = runHook({ hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "mattpocock-skills:tdd" }, cwd: os.tmpdir() });
  assert.match(JSON.parse(tdd.stdout).hookSpecificOutput.additionalContext, /refactor step/);

  const other = runHook({ hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "mattpocock-skills:grilling" }, cwd: os.tmpdir() });
  assert.equal(other.stdout, "");
});

test("UserPromptExpansion injects the policy for a user-typed mattpocock skill", () => {
  const typed = runHook({ hook_event_name: "UserPromptExpansion", command_type: "skill", command_name: "mattpocock-skills:implement", expanded_prompt: "...", cwd: os.tmpdir() });
  const output = JSON.parse(typed.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "UserPromptExpansion");
  assert.match(output.additionalContext, /refactor step/);

  const slash = runHook({ hook_event_name: "UserPromptExpansion", command_type: "slash_command", command_name: "clear", cwd: os.tmpdir() });
  assert.equal(slash.stdout, "");
});

test("hooks.json narrows to the plugin once; the script's skillMatch picks the skills within it", () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hooks", "hooks.json"), "utf8")).hooks;
  const skillGroup = hooksJson.PostToolUse.find((group) => group.matcher === "Skill");
  assert.equal(skillGroup.hooks.length, 1);
  const prefix = skillGroup.hooks[0].if.match(/^Skill\((.+) \*\)$/)[1];
  const expansion = new RegExp(`^${hooksJson.UserPromptExpansion[0].matcher}$`);
  const skillMatch = new RegExp(config.skillMatch);
  const targeted = config.skillMatch.match(/\((.+)\)/)[1].split("|").map((name) => `${prefix}:${name}`);
  assert.ok(targeted.length >= 8);
  for (const name of targeted) {
    assert.ok(skillMatch.test(name), `${name} is not in skillMatch`);
    assert.ok(expansion.test(name), `${name} is not covered by the UserPromptExpansion matcher`);
  }
  assert.ok(!skillMatch.test(`${prefix}:domain-modeling`), "a plugin skill outside the list gets no context");
  for (const group of [...hooksJson.PostToolUse, ...hooksJson.UserPromptExpansion, ...hooksJson.Stop]) {
    for (const handler of group.hooks) assert.match(handler.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/comment-guard\.js/);
  }
});

test("Stop checks only files this session edited, reports only added lines, and respects stop_hook_active", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-repo-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  run("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.ts"), `// legacy note (ADR 0001)\nexport const a = 1;\n`);
  run("add", ".");
  run("commit", "-q", "-m", "base");
  run("checkout", "-q", "-b", "feature");
  fs.writeFileSync(path.join(dir, "a.ts"), `// legacy note (ADR 0001)\nexport const a = 1;\n// Added for the new flow\nexport const b = 2;\n`);
  run("commit", "-q", "-am", "feature work");
  fs.writeFileSync(path.join(dir, "c.ts"), `// Now wire it up\nexport const c = 3;\n`);

  const session_id = `test-${process.pid}-${Date.now()}`;
  const untouched = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  assert.equal(untouched.stdout, "", "a session that edited nothing is never blocked");

  for (const file of ["a.ts", "c.ts"]) {
    runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, file) }, cwd: dir, session_id });
  }
  const blocked = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /a\.ts:\n  L3 describes the change/);
  assert.doesNotMatch(output.reason, /legacy note/);
  assert.match(output.reason, /c\.ts:\n  L1 narrates/);

  const second = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: true });
  assert.equal(second.stdout, "");
});

test("Stop catches a citation appended under a pre-existing comment block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-repo-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  run("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "index.ts"), "// Public surface of the package.\n// Workers import only what is exported here.\nexport const a = 1;\n");
  run("add", ".");
  run("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(dir, "index.ts"), "// Public surface of the package.\n// Workers import only what is exported here.\n// per ADR 0002\nexport const a = 1;\n");

  const session_id = `block-${process.pid}-${Date.now()}`;
  runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, "index.ts") }, cwd: dir, session_id });
  const blocked = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  assert.notEqual(blocked.stdout, "", "the appended citation is an added line and must be reported");
  const output = JSON.parse(blocked.stdout);
  assert.match(output.reason, /index\.ts:\n  L3 cites a document: "per ADR 0002"/);
});

test("the CLI exits non-zero on problems and zero when clean", () => {
  const dirty = spawnSync("node", [SCRIPT, path.join(FIXTURES, "short-code.ts")], { encoding: "utf8" });
  assert.equal(dirty.status, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const clean = path.join(dir, "clean.ts");
  fs.writeFileSync(clean, "export const x = 1;\n");
  assert.equal(spawnSync("node", [SCRIPT, clean], { encoding: "utf8" }).status, 0);
});
