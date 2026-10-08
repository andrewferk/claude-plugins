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
  assert.equal(shortCode.problems.filter((p) => p.kind === "cites a document").length, 6, "lines 10 and 11 of one block each cite an ADR");
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

test("an edit is judged only on the lines it added", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  const legacy = "// Public surface of the package (ADR 0015).\nexport const a = 1;\n";

  fs.writeFileSync(file, `${legacy}export const b = 2;\n`);
  const cleanPatch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" // Public surface of the package (ADR 0015).", " export const a = 1;", "+export const b = 2;"] }];
  const clean = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "a = 1;\n", new_string: "a = 1;\nexport const b = 2;\n" }, tool_response: { filePath: file, structuredPatch: cleanPatch }, cwd: dir });
  assert.equal(clean.stdout, "", "a citation the edit did not touch does not block");

  fs.writeFileSync(file, `${legacy}// per ADR 0002\nexport const b = 2;\n`);
  const citingPatch = [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 3, lines: [" export const a = 1;", "+// per ADR 0002", "+export const b = 2;"] }];
  const blocked = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "a = 1;\n", new_string: "a = 1;\n// per ADR 0002\nexport const b = 2;\n" }, tool_response: { filePath: file, structuredPatch: citingPatch }, cwd: dir });
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /L3 cites a document: "per ADR 0002"/);
  assert.doesNotMatch(output.reason, /ADR 0015/, "the pre-existing citation is not the edit's problem");
});

test("an edit that carries no patch is scoped by the strings it inserted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, "// Public surface of the package (ADR 0015).\nexport const a = 1;\n// per ADR 0002\nexport const b = 2;\n");
  const blocked = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "export const a = 1;\n", new_string: "export const a = 1;\n// per ADR 0002\nexport const b = 2;\n" }, cwd: dir });
  const output = JSON.parse(blocked.stdout);
  assert.match(output.reason, /L3 cites a document: "per ADR 0002"/);
  assert.doesNotMatch(output.reason, /ADR 0015/);

  const deletion = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "export const c = 3;\n", new_string: "" }, cwd: dir });
  assert.equal(deletion.stdout, "", "an edit that only removes text adds no lines to judge");
});

test("a created file is judged whole", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  const content = "// Public surface of the package (ADR 0015).\nexport const a = 1;\n";
  fs.writeFileSync(file, content);
  const result = runHook({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file, content }, tool_response: { type: "create", filePath: file, content }, cwd: dir });
  assert.match(JSON.parse(result.stdout).reason, /L1 cites a document/);
});

test("the comment budget counts only the lines an edit added", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  const dense = "// kept for the v1 clients\n// the upstream rejects empty bodies\n// retries would double-charge\nexport const a = 1;\n";
  assert.equal(guard.analyzeSource(dense, file, config).overBudget, true, "the whole file is over budget");

  fs.writeFileSync(file, `${dense}export const b = 2;\n`);
  const codePatch = [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 2, lines: [" export const a = 1;", "+export const b = 2;"] }];
  const code = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "a = 1;\n", new_string: "a = 1;\nexport const b = 2;\n" }, tool_response: { filePath: file, structuredPatch: codePatch }, cwd: dir });
  assert.equal(code.stdout, "", "adding a code line to a comment-heavy file is not over budget");

  const commentPatch = [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 3, lines: ["+// kept for the v1 clients", "+// the upstream rejects empty bodies", "+// retries would double-charge"] }];
  const comments = runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "", new_string: dense }, tool_response: { filePath: file, structuredPatch: commentPatch }, cwd: dir });
  assert.match(JSON.parse(comments.stdout).reason, /budget: 3 of 3 added non-blank lines are comments \(100%\)/);

  const created = runHook({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file }, tool_response: { type: "create", filePath: file }, cwd: dir });
  assert.match(JSON.parse(created.stdout).reason, /budget: 3 of 5 non-blank lines are comments \(60%\)/);
});

test("Stop scopes the comment budget to the lines added on the branch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-repo-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  run("init", "-q", "-b", "main");
  const dense = "// kept for the v1 clients\n// the upstream rejects empty bodies\n// retries would double-charge\nexport const a = 1;\n";
  fs.writeFileSync(path.join(dir, "a.ts"), dense);
  run("add", ".");
  run("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(dir, "a.ts"), `${dense}export const b = 2;\n`);

  const session_id = `budget-${process.pid}-${Date.now()}`;
  runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, "a.ts") }, cwd: dir, session_id });
  const stop = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  assert.equal(stop.stdout, "", "legacy comments outside the branch's added lines do not trip the budget");
});

test("PreToolUse refuses an edit whose added lines break the policy, before it lands", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  const legacy = "// Public surface of the package (ADR 0015).\nexport const a = 1;\n";
  fs.writeFileSync(file, legacy);

  const refused = runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "export const a = 1;\n", new_string: "export const a = 1;\n// per ADR 0002\nexport const b = 2;\n" }, cwd: dir });
  const output = JSON.parse(refused.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, "PreToolUse");
  assert.equal(output.permissionDecision, "deny");
  assert.match(output.permissionDecisionReason, /L3 cites a document: "per ADR 0002"/);
  assert.doesNotMatch(output.permissionDecisionReason, /ADR 0015/, "the legacy citation is not the edit's problem");
  assert.equal(fs.readFileSync(file, "utf8"), legacy, "the hook never touches the file");

  const allowed = runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "export const a = 1;\n", new_string: "export const a = 1;\nexport const b = 2;\n" }, cwd: dir });
  assert.equal(allowed.stdout, "", "a clean edit is not mentioned");

  const unmatched = runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "not in the file", new_string: "// per ADR 0002\n" }, cwd: dir });
  assert.equal(unmatched.stdout, "", "an edit the tool itself will reject is left to the tool");
});

test("PreToolUse judges a Write by the lines it would add", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, "// legacy note (ADR 0001)\nexport const a = 1;\n");

  const rewritten = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "// legacy note (ADR 0001)\nexport const a = 1;\n// Now we add b\nexport const b = 2;\n" }, cwd: dir });
  const reason = JSON.parse(rewritten.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /L3 narrates the steps/);
  assert.doesNotMatch(reason, /legacy note/);

  const kept = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "// legacy note (ADR 0001)\nexport const a = 1;\nexport const b = 2;\n" }, cwd: dir });
  assert.equal(kept.stdout, "", "lines the file already had are not added");

  const created = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(dir, "new.ts"), content: "// per ADR 0002\nexport const c = 3;\n" }, cwd: dir });
  assert.match(JSON.parse(created.stdout).hookSpecificOutput.permissionDecisionReason, /L1 cites a document/);
  assert.ok(!fs.existsSync(path.join(dir, "new.ts")));
});

test("PreToolUse applies every edit of a MultiEdit before judging", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, "export const a = 1;\nexport const b = 2;\n");
  const edits = [
    { old_string: "export const a = 1;\n", new_string: "export const a = 1;\n// see ticket #94\n" },
    { old_string: "export const b = 2;\n", new_string: "export const b = 2;\nexport const c = 3;\n" },
  ];
  const refused = runHook({ hook_event_name: "PreToolUse", tool_name: "MultiEdit", tool_input: { file_path: file, edits }, cwd: dir });
  const reason = JSON.parse(refused.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /L2 cites a document: "see ticket #94"/);
  assert.doesNotMatch(reason, /L4/);
});

test("a refusal carries the policy the first time, and a clean edit leaves it for the read hook", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, "export const a = 1;\n");
  const bad = { file_path: file, old_string: "export const a = 1;\n", new_string: "// Now we add b\nexport const b = 2;\n" };
  const good = { file_path: file, old_string: "export const a = 1;\n", new_string: "export const b = 2;\n" };

  const first = `pre-${process.pid}-${Date.now()}`;
  const refused = runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: bad, cwd: dir, session_id: first });
  assert.match(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecisionReason, /# Code comments/);
  const read = runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: file }, cwd: dir, session_id: first });
  assert.equal(read.stdout, "", "the session has seen the policy");

  const second = `${first}-b`;
  assert.equal(runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: good, cwd: dir, session_id: second }).stdout, "");
  const later = runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: file }, cwd: dir, session_id: second });
  assert.match(JSON.parse(later.stdout).hookSpecificOutput.additionalContext, /# Code comments/, "an allowed edit does not spend the one-time policy");
});

test("COMMENT_GUARD=warn never refuses an edit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "thing.ts");
  fs.writeFileSync(file, "export const a = 1;\n");
  const result = runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: file, old_string: "export const a = 1;\n", new_string: "// per ADR 0002\nexport const a = 1;\n" }, cwd: dir }, { COMMENT_GUARD: "warn" });
  assert.equal(result.stdout, "");
});

test("hooks.json runs the script before and after every edit tool", () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hooks", "hooks.json"), "utf8")).hooks;
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const matcher = new RegExp(`^(${hooksJson[event][0].matcher})$`);
    for (const tool of ["Edit", "Write", "MultiEdit"]) assert.ok(matcher.test(tool), `${event} does not cover ${tool}`);
    for (const handler of hooksJson[event][0].hooks) assert.match(handler.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/comment-guard\.js/);
  }
  assert.doesNotMatch(hooksJson.PreToolUse[0].matcher, /Read/, "a read has nothing to refuse");
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

test("Stop checks every file changed on the branch once the session has edited, reports only added lines, and respects stop_hook_active", () => {
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
  assert.equal(untouched.stdout, "", "a session that changed nothing is never blocked");
  runHook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(dir, "a.ts") }, cwd: dir, session_id });
  const readOnly = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  assert.equal(readOnly.stdout, "", "a session that only read files is never blocked");

  runHook({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, "a.ts") }, cwd: dir, session_id });
  const blocked = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /a\.ts:\n  L3 describes the change/);
  assert.doesNotMatch(output.reason, /legacy note/);
  assert.match(output.reason, /c\.ts:\n  L1 narrates/, "a changed file the session never edited through a tool is still checked");

  const second = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: true });
  assert.equal(second.stdout, "");
});

test("a file written through Bash is checked at Stop", () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hooks", "hooks.json"), "utf8")).hooks;
  assert.ok(new RegExp(`^(${hooksJson.PostToolUse[0].matcher})$`).test("Bash"), "PostToolUse does not cover Bash");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-repo-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  run("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  run("add", ".");
  run("commit", "-q", "-m", "base");

  const session_id = `bash-${process.pid}-${Date.now()}`;
  const shell = runHook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat > b.ts" }, tool_response: { stdout: "", stderr: "" }, cwd: dir, session_id });
  assert.equal(shell.stdout, "", "a shell command gets neither a block nor the policy");
  fs.writeFileSync(path.join(dir, "b.ts"), "// per ADR 0002\nexport const b = 2;\n");
  const blocked = runHook({ hook_event_name: "Stop", cwd: dir, session_id, stop_hook_active: false });
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /b\.ts:\n  L1 cites a document: "per ADR 0002"/);
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

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-repo-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  run("init", "-q", "-b", "main");
  return { dir, run };
}

test("the CLI with --base judges only the lines added since that commit", () => {
  const { dir, run } = gitRepo();
  fs.writeFileSync(path.join(dir, "a.ts"), "// legacy note (ADR 0001)\nexport const a = 1;\n");
  run("add", ".");
  run("commit", "-q", "-m", "base");
  const base = run("rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "a.ts"), "// legacy note (ADR 0001)\nexport const a = 1;\n// Now wire it up\nexport const b = 2;\n");
  fs.writeFileSync(path.join(dir, "c.ts"), "// per ADR 0002\nexport const c = 3;\n");
  run("add", ".");
  run("commit", "-q", "-m", "change");

  const changed = spawnSync("node", [SCRIPT, "--base", base], { cwd: dir, encoding: "utf8" });
  assert.equal(changed.status, 1);
  assert.match(changed.stdout, /a\.ts:\n  L3 narrates the steps/);
  assert.match(changed.stdout, /c\.ts:\n  L1 cites a document/);
  assert.doesNotMatch(changed.stdout, /legacy note/);

  const narrowed = spawnSync("node", [SCRIPT, "--base", base, "c.ts"], { cwd: dir, encoding: "utf8" });
  assert.equal(narrowed.status, 1);
  assert.doesNotMatch(narrowed.stdout, /a\.ts/, "file arguments narrow the changed set");

  const nothing = spawnSync("node", [SCRIPT, "--base", "HEAD"], { cwd: dir, encoding: "utf8" });
  assert.equal(nothing.status, 0);
  assert.equal(nothing.stdout, "comment-guard: clean\n");
});

test("the CLI with --format github annotates each finding and writes the step summary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const summary = path.join(dir, "summary.md");
  const plugin = path.join(__dirname, "..");
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };

  const dirty = spawnSync("node", [SCRIPT, "--format", "github", "test/fixtures/pr100/short-code.ts"], { cwd: plugin, encoding: "utf8", env });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /^::error file=test\/fixtures\/pr100\/short-code\.ts,line=7,endLine=7,title=comment-guard::cites a document: "A generated Short code is always exactly 7 base62 characters \(ADR 0002\)\." -> delete it\./m);
  assert.match(dirty.stdout, /^::error file=test\/fixtures\/pr100\/short-code\.ts,title=comment-guard::budget: /m);
  const written = fs.readFileSync(summary, "utf8");
  assert.match(written, /\| test\/fixtures\/pr100\/short-code\.ts \| L7 \| cites a document \|/);

  fs.writeFileSync(summary, "");
  const clean = path.join(dir, "clean.ts");
  fs.writeFileSync(clean, "export const x = 1;\n");
  const ok = spawnSync("node", [SCRIPT, "--format", "github", clean], { cwd: plugin, encoding: "utf8", env });
  assert.equal(ok.status, 0);
  assert.doesNotMatch(ok.stdout, /::error/);
  assert.match(fs.readFileSync(summary, "utf8"), /clean/);
});

test("github annotations escape newlines and percent signs in the message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-"));
  const file = path.join(dir, "a.ts");
  fs.writeFileSync(file, "// Now we validate the input\n// 100% of the time\nconst x = 1;\n");
  const out = spawnSync("node", [SCRIPT, "--format", "github", "a.ts"], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /^::error file=a\.ts,line=1,endLine=2,title=comment-guard::narrates the steps: "Now we validate the input 100%25 of the time"/m);
  assert.doesNotMatch(out.stdout, /%(?!25|0A|0D)/, "every percent sign is encoded");
});

test("the CLI with --scope all checks every tracked source file, and --paths narrows it", () => {
  const { dir, run } = gitRepo();
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "a.ts"), "// per ADR 0002\nexport const a = 1;\n");
  fs.writeFileSync(path.join(dir, "c.py"), "# per ADR 0003\nc = 3\n");
  fs.writeFileSync(path.join(dir, "docs", "b.ts"), "// per ADR 0004\nexport const b = 2;\n");
  fs.writeFileSync(path.join(dir, "README.md"), "per ADR 0005\n");
  run("add", ".");
  run("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(dir, "untracked.ts"), "// per ADR 0006\nexport const u = 6;\n");

  const all = spawnSync("node", [SCRIPT, "--scope", "all"], { cwd: dir, encoding: "utf8" });
  assert.equal(all.status, 1);
  assert.match(all.stdout, /a\.ts:/);
  assert.match(all.stdout, /c\.py:/);
  assert.doesNotMatch(all.stdout, /docs\/b\.ts/, "the exclude list still applies");
  assert.doesNotMatch(all.stdout, /untracked/, "only tracked files are audited");

  const narrowed = spawnSync("node", [SCRIPT, "--scope", "all", "--paths", "**/*.py\nnothing/**"], { cwd: dir, encoding: "utf8" });
  assert.equal(narrowed.status, 1);
  assert.doesNotMatch(narrowed.stdout, /a\.ts/);
  assert.match(narrowed.stdout, /c\.py:/);

  const narrowedChange = spawnSync("node", [SCRIPT, "--base", "HEAD~0", "--paths", "docs/**"], { cwd: dir, encoding: "utf8" });
  assert.equal(narrowedChange.status, 0, "--paths narrows a changed-lines run the same way");
});

test("the CLI with --github-event takes the base from the event and fetches it into a shallow clone", () => {
  const origin = gitRepo();
  fs.writeFileSync(path.join(origin.dir, "a.ts"), "// legacy note (ADR 0001)\nexport const a = 1;\n");
  origin.run("add", ".");
  origin.run("commit", "-q", "-m", "base");
  const base = origin.run("rev-parse", "HEAD");
  fs.writeFileSync(path.join(origin.dir, "a.ts"), "// legacy note (ADR 0001)\nexport const a = 1;\n// Now wire it up\nexport const b = 2;\n");
  origin.run("commit", "-q", "-am", "change");
  origin.run("config", "uploadpack.allowReachableSHA1InWant", "true");

  const checkout = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "comment-guard-clone-")), "repo");
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${origin.dir}`, checkout]);
  assert.notEqual(spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: checkout }).status, 0, "the shallow clone must not already hold the base");

  const event = path.join(checkout, "..", "event.json");
  const runEvent = (name, payload) => {
    fs.writeFileSync(event, JSON.stringify(payload));
    return spawnSync("node", [SCRIPT, "--github-event"], { cwd: checkout, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: event } });
  };

  const pr = runEvent("pull_request", { pull_request: { base: { sha: base } } });
  assert.equal(pr.status, 1, pr.stderr);
  assert.match(pr.stdout, /a\.ts:\n  L3 narrates the steps/);
  assert.doesNotMatch(pr.stdout, /legacy note/);

  const queue = runEvent("merge_group", { merge_group: { base_sha: base } });
  assert.equal(queue.status, 1, queue.stderr);

  const firstPush = runEvent("push", { before: "0000000000000000000000000000000000000000" });
  assert.equal(firstPush.status, 2);
  assert.match(firstPush.stderr, /base/);
  assert.match(firstPush.stderr, /scope: all/);

  const dispatch = runEvent("workflow_dispatch", {});
  assert.equal(dispatch.status, 2);
  assert.match(dispatch.stderr, /workflow_dispatch/);
});
