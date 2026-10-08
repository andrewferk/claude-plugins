#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_CONFIG = {
  maxCommentRatio: 0.1,
  minCommentLines: 3,
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/*.d.ts",
    "**/*.config.*",
    "**/docs/**",
    "**/*.generated.*",
  ],
  referenceAllowlistPrefixes: [
    "UTF", "SHA", "ISO", "RFC", "AES", "HMAC", "CVE", "ECMA", "ES", "TLS", "SSL",
    "MD", "CRC", "UUID", "PBKDF", "IEEE", "ARGON", "HTTP", "X", "PKCS", "OAUTH", "WCAG",
  ],
  skillMatch: "^mattpocock-skills:(implement|tdd|code-review|diagnosing-bugs|prototype|improve-codebase-architecture|implement-spec|codebase-design)$",
  policyFile: path.join(__dirname, "..", "policy", "code-comments.md"),
};

const LINE_COMMENT_LANGUAGES = {
  ".ts": "c", ".tsx": "c", ".mts": "c", ".cts": "c",
  ".js": "c", ".jsx": "c", ".mjs": "c", ".cjs": "c",
  ".go": "c", ".rs": "c", ".java": "c", ".kt": "c", ".kts": "c",
  ".swift": "c", ".cs": "c", ".scala": "c", ".c": "c", ".h": "c", ".cpp": "c", ".hpp": "c",
  ".py": "hash", ".rb": "hash",
};

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "this", "is", "are", "and", "or", "as", "in", "on",
  "at", "by", "with", "that", "it", "its", "be", "from", "into", "which", "returns", "return",
  "value", "given", "get", "gets", "set", "sets", "whether", "if", "when", "all", "each",
]);

function loadConfig(cwd) {
  const candidates = [
    path.join(os.homedir(), ".claude", "comment-guard.json"),
    cwd ? path.join(cwd, ".claude", "comment-guard.json") : null,
  ];
  let config = { ...DEFAULT_CONFIG };
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const overrides = JSON.parse(fs.readFileSync(file, "utf8"));
      config = { ...config, ...overrides };
      if (overrides.exclude) config.exclude = [...DEFAULT_CONFIG.exclude, ...overrides.exclude];
    } catch (error) {
      process.stderr.write(`comment-guard: ignoring unreadable ${file}: ${error.message}\n`);
    }
  }
  return config;
}

function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      pattern += `\\${char}`;
    } else {
      pattern += char;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function isExcluded(filePath, config) {
  const normalized = filePath.split(path.sep).join("/");
  if (path.basename(normalized).startsWith(".")) return true;
  return config.exclude.some((glob) => globToRegExp(glob).test(normalized) || globToRegExp(glob).test(path.basename(normalized)));
}

function languageFor(filePath) {
  return LINE_COMMENT_LANGUAGES[path.extname(filePath)] || null;
}

function extractComments(source, language) {
  return language === "hash" ? extractHashComments(source) : extractCFamilyComments(source);
}

function extractCFamilyComments(source) {
  const lines = source.split("\n");
  const comments = [];
  const commentLineNumbers = new Set();
  let inBlock = false;
  let block = null;
  let stringDelimiter = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    let column = 0;
    let codeSeen = false;

    while (column < line.length) {
      const char = line[column];
      const next = line[column + 1];

      if (inBlock) {
        const end = line.indexOf("*/", column);
        const segment = end === -1 ? line.slice(column) : line.slice(column, end);
        block.rawLines.push(segment);
        commentLineNumbers.add(lineNumber);
        if (end === -1) {
          column = line.length;
        } else {
          inBlock = false;
          block.endLine = lineNumber;
          comments.push(block);
          block = null;
          column = end + 2;
        }
        continue;
      }

      if (stringDelimiter) {
        if (char === "\\") {
          column += 2;
          continue;
        }
        if (char === stringDelimiter) stringDelimiter = null;
        column++;
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        stringDelimiter = char;
        codeSeen = true;
        column++;
        continue;
      }

      if (char === "/" && next === "/") {
        comments.push({
          kind: "line",
          startLine: lineNumber,
          endLine: lineNumber,
          rawLines: [line.slice(column + 2)],
          trailing: codeSeen,
        });
        commentLineNumbers.add(lineNumber);
        column = line.length;
        continue;
      }

      if (char === "/" && next === "*") {
        inBlock = true;
        const isDoc = line[column + 2] === "*" && line[column + 3] !== "/";
        block = { kind: isDoc ? "doc" : "block", startLine: lineNumber, endLine: lineNumber, rawLines: [], trailing: codeSeen };
        column += isDoc ? 3 : 2;
        continue;
      }

      if (!/\s/.test(char)) codeSeen = true;
      column++;
    }

    if (stringDelimiter !== "`") stringDelimiter = null;
  }

  if (inBlock && block) {
    block.endLine = lines.length;
    comments.push(block);
  }

  return finalize(comments, lines, commentLineNumbers, (raw) => raw.replace(/^\s*\*+\s?/, "").replace(/\s*\*+\s*$/, ""));
}

function extractHashComments(source) {
  const lines = source.split("\n");
  const comments = [];
  const commentLineNumbers = new Set();
  let docstring = null;
  let previousCodeLine = "";

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (docstring) {
      commentLineNumbers.add(lineNumber);
      const end = line.indexOf(docstring.delimiter);
      docstring.rawLines.push(end === -1 ? line : line.slice(0, end));
      if (end !== -1) {
        docstring.endLine = lineNumber;
        comments.push(docstring);
        docstring = null;
      }
      continue;
    }

    const docstringStart = trimmed.match(/^[rRuUbB]*("""|''')/);
    const opensDocstring = docstringStart && (previousCodeLine === "" || /:\s*$/.test(previousCodeLine));
    if (opensDocstring) {
      const delimiter = docstringStart[1];
      const body = trimmed.slice(trimmed.indexOf(delimiter) + 3);
      const closes = body.indexOf(delimiter);
      commentLineNumbers.add(lineNumber);
      if (closes !== -1) {
        comments.push({ kind: "doc", startLine: lineNumber, endLine: lineNumber, rawLines: [body.slice(0, closes)], trailing: false });
      } else {
        docstring = { kind: "doc", delimiter, startLine: lineNumber, endLine: lineNumber, rawLines: [body], trailing: false };
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      if (lineNumber === 1 && trimmed.startsWith("#!")) continue;
      comments.push({ kind: "line", startLine: lineNumber, endLine: lineNumber, rawLines: [trimmed.slice(1)], trailing: false });
      commentLineNumbers.add(lineNumber);
      continue;
    }

    const hashAt = findUnquotedHash(line);
    if (hashAt !== -1) {
      comments.push({ kind: "line", startLine: lineNumber, endLine: lineNumber, rawLines: [line.slice(hashAt + 1)], trailing: true });
      commentLineNumbers.add(lineNumber);
    }
    if (trimmed !== "") previousCodeLine = trimmed;
  }

  return finalize(comments, lines, commentLineNumbers, (raw) => raw);
}

function findUnquotedHash(line) {
  let delimiter = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (delimiter) {
      if (char === "\\") i++;
      else if (char === delimiter) delimiter = null;
    } else if (char === '"' || char === "'") {
      delimiter = char;
    } else if (char === "#") {
      return i;
    }
  }
  return -1;
}

function mergeAdjacentLineComments(comments) {
  const merged = [];
  for (const comment of comments) {
    const previous = merged[merged.length - 1];
    const continues = previous && previous.kind === "line" && comment.kind === "line" && !previous.trailing && !comment.trailing && comment.startLine === previous.endLine + 1;
    if (continues) {
      previous.endLine = comment.endLine;
      previous.rawLines.push(...comment.rawLines);
    } else {
      merged.push(comment);
    }
  }
  return merged;
}

function finalize(extractedComments, lines, commentLineNumbers, cleanLine) {
  const comments = mergeAdjacentLineComments(extractedComments);
  for (const comment of comments) {
    comment.lineTexts = comment.rawLines.map((raw) => cleanLine(raw).trim());
    comment.text = comment.lineTexts.filter(Boolean).join(" ").trim();
    comment.nextCodeLine = "";
    for (let i = comment.endLine; i < lines.length; i++) {
      const candidate = lines[i].trim();
      if (candidate !== "" && !commentLineNumbers.has(i + 1)) {
        comment.nextCodeLine = candidate;
        break;
      }
    }
  }
  const nonBlankLineNumbers = new Set(lines.map((line, index) => (line.trim() === "" ? 0 : index + 1)).filter(Boolean));
  const pureCommentLineNumbers = new Set([...commentLineNumbers].filter((n) => {
    const text = lines[n - 1].trim();
    return text.startsWith("//") || text.startsWith("/*") || text.startsWith("*") || text.startsWith("#") || text.startsWith('"""') || text.startsWith("'''") || commentOnlyLine(n, comments);
  }));
  return { comments, nonBlankLineNumbers, commentLineNumbers: pureCommentLineNumbers, lineCount: lines.length };
}

function commentOnlyLine(lineNumber, comments) {
  return comments.some((c) => c.kind !== "line" && lineNumber > c.startLine && lineNumber <= c.endLine);
}

const REFERENCE_PATTERNS = [
  /\bADRs?[\s-]*\d{2,}/i,
  /\(#\d+\)/,
  /\b(issue|ticket|pull request|PR|epic|story|slice)\s*#?\d+(\.\d+)*/i,
  /\bspec(ification)?\b.*\b(section|§|part|chapter)\s*\d/i,
  /\b(per|as per|according to|as required by|as specified in|as decided in|as agreed in|following|see)\s+(the\s+)?(ADR|spec|ticket|issue|review|PR|decision|RFC doc|design doc|plan)\b/i,
  /\bdocs?\/[\w./-]+\.md\b/i,
];

const NARRATION_PATTERN = /^(now|first|next|then|finally|here|here,|we|we'll|we're|let's|lets|this (function|method|class|file|module|helper|hook|block|section|step|is where)|step \d|note that we|in this (function|method|file|block)|the following|below we|above we)\b/i;
const CHANGELOG_PATTERN = /^(added|removed|updated|changed|refactored|moved|renamed|fixed|replaced|introduced|new:|migrated|extracted|deleted|reverted)\b/i;
const BANNER_PATTERN = /^[-=*#_~.]{4,}|^[-=*#_~]{3,}[^-=*#_~]+[-=*#_~]{3,}$/;
const DEAD_CODE_PATTERN = /^\s*(const|let|var|import|export|return|if\s*\(|else\s*\{|for\s*\(|while\s*\(|function\b|await\b|console\.|throw\b|try\s*\{|catch\s*\(|def\b|class\b|print\(|self\.)|[;{}]\s*$/;
const TODO_PATTERN = /^\s*(TODO|FIXME|HACK|XXX)\b/i;
const PRAGMA_PATTERN = /^\s*(eslint|prettier|biome|ts-|@ts-|istanbul|c8|v8|noqa|type:|pyright:|mypy:|pylint:|fmt:|nolint|#!|region|endregion|#region|#endregion)/i;

function tokens(text) {
  return new Set(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1)
  );
}

function restatesName(comment) {
  if (!comment.nextCodeLine || comment.trailing) return false;
  const docTokens = [...tokens(comment.text)].filter((word) => !STOPWORDS.has(word));
  if (docTokens.length === 0 || docTokens.length > 8) return false;
  const identifierTokens = tokens(comment.nextCodeLine);
  return docTokens.every((word) => identifierTokens.has(word) || (word.endsWith("s") && identifierTokens.has(word.slice(0, -1))));
}

function isReference(text, config) {
  if (TODO_PATTERN.test(text)) return false;
  if (REFERENCE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const ticketKeys = text.match(/\b[A-Z]{2,8}-\d{1,6}\b/g) || [];
  return ticketKeys.some((key) => !config.referenceAllowlistPrefixes.includes(key.split("-")[0]));
}

function analyzeSource(source, filePath, config) {
  const language = languageFor(filePath);
  if (!language) return null;
  const extracted = extractComments(source, language);
  const problems = [];

  for (const comment of extracted.comments) {
    const text = comment.text;
    if (text === "" || PRAGMA_PATTERN.test(text)) continue;
    const where = { line: comment.startLine, endLine: comment.endLine, text };

    if (isReference(text, config)) {
      for (const where of citingLines(comment, config)) {
        problems.push({ ...where, kind: "cites a document", fix: "delete it. The decision record already holds the reasoning; the link belongs in the commit trailer (Implements: ADR-NNNN / Refs: #NN), the test name, or the ADR's Implemented-by list." });
      }
    } else if (BANNER_PATTERN.test(text)) {
      problems.push({ ...where, kind: "section banner", fix: "delete it; if the section needs a name, extract it into a function with that name." });
    } else if (comment.kind === "line" && !comment.trailing && DEAD_CODE_PATTERN.test(text) && /[=(){}:;]/.test(text)) {
      problems.push({ ...where, kind: "commented-out code", fix: "delete it; git history keeps old code." });
    } else if (NARRATION_PATTERN.test(text)) {
      problems.push({ ...where, kind: "narrates the steps", fix: "delete it; if the step needs a label, extract it into a function named after the label." });
    } else if (CHANGELOG_PATTERN.test(text)) {
      problems.push({ ...where, kind: "describes the change, not the code", fix: "delete it; that sentence is the commit message." });
    } else if (restatesName(comment)) {
      problems.push({ ...where, kind: "restates the name", fix: "delete it; the identifier already says it. If it does not, rename the identifier." });
    }
  }

  const { commentLineNumbers, nonBlankLineNumbers, comments } = extracted;
  return { filePath, language, problems, ...commentBudget(extracted, config), commentLineNumbers, nonBlankLineNumbers, comments };
}

function commentBudget(counted, config, within = null) {
  const size = (numbers) => (within ? [...numbers].filter((n) => within.has(n)).length : numbers.size);
  const commentLines = size(counted.commentLineNumbers);
  const nonBlankLines = size(counted.nonBlankLineNumbers);
  const ratio = nonBlankLines === 0 ? 0 : commentLines / nonBlankLines;
  return { commentLines, nonBlankLines, ratio, overBudget: commentLines >= config.minCommentLines && ratio > config.maxCommentRatio };
}

function citingLines(comment, config) {
  const found = [];
  (comment.lineTexts || []).forEach((lineText, index) => {
    if (isReference(lineText, config)) found.push({ line: comment.startLine + index, endLine: comment.startLine + index, text: lineText });
  });
  return found.length > 0 ? found : [{ line: comment.startLine, endLine: comment.endLine, text: comment.text }];
}

function analyzeFile(filePath, config) {
  if (!fs.existsSync(filePath) || isExcluded(filePath, config) || !languageFor(filePath)) return null;
  return analyzeSource(fs.readFileSync(filePath, "utf8"), filePath, config);
}

const FIX_NOW = "Fix this now before continuing: delete the listed comments, and where something was genuinely unclear, rename or extract instead. Do not rewrite a comment into a different comment that says the same thing.";
const REDO_EDIT = "The edit was not applied. Redo it without the listed comments; where something was genuinely unclear, rename or extract instead. Do not rewrite a comment into a different comment that says the same thing.";

function formatReport(results, config, { addedLinesByFile, footer = FIX_NOW } = {}) {
  const sections = [];
  for (const result of results) {
    if (!result) continue;
    const added = addedLinesByFile ? addedLinesByFile.get(result.filePath) : null;
    const problems = added ? result.problems.filter((p) => touchesAddedLine(p, added)) : result.problems;
    const lines = [];
    for (const problem of problems) {
      const preview = problem.text.length > 90 ? `${problem.text.slice(0, 87)}...` : problem.text;
      lines.push(`  ${lineRange(problem)} ${problem.kind}: "${preview}" -> ${problem.fix}`);
    }
    const budget = commentBudget(result, config, added);
    if (budget.overBudget) {
      const percent = Math.round(budget.ratio * 100);
      lines.push(`  budget: ${budget.commentLines} of ${budget.nonBlankLines} ${added ? "added " : ""}non-blank lines are comments (${percent}%); the limit is ${Math.round(config.maxCommentRatio * 100)}%. Delete comments that restate code or paraphrase a document; keep only a non-obvious why.`);
    }
    if (lines.length > 0) sections.push(`${relative(result.filePath)}:\n${lines.join("\n")}`);
  }
  if (sections.length === 0) return null;
  return [
    "comment-guard: the comment policy is not met.",
    ...sections,
    footer,
  ].join("\n");
}

function lineRange(problem) {
  return problem.endLine > problem.line ? `L${problem.line}-L${problem.endLine}` : `L${problem.line}`;
}

function touchesAddedLine(problem, added) {
  for (let line = problem.line; line <= problem.endLine; line++) if (added.has(line)) return true;
  return false;
}

function relative(filePath) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return filePath.startsWith(root) ? path.relative(root, filePath) : filePath;
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function emit(json) {
  process.stdout.write(`${JSON.stringify(json)}\n`);
}

function sessionFile(input) {
  if (!input.session_id || !/^[\w-]+$/.test(input.session_id)) return null;
  const dir = path.join(os.tmpdir(), "comment-guard");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${input.session_id}.txt`);
}

function realPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function rememberChange(input) {
  const file = sessionFile(input);
  if (file) fs.writeFileSync(file, "");
}

function policyDeliveredThisSession(input) {
  const file = sessionFile(input);
  if (!file) return true;
  const marker = `${file}.policy`;
  if (fs.existsSync(marker)) return true;
  fs.writeFileSync(marker, "");
  return false;
}

function changedThisSession(input) {
  const file = sessionFile(input);
  return Boolean(file && fs.existsSync(file));
}

function handlePostToolUse(input, config, mode) {
  const toolName = input.tool_name || "";
  if (toolName === "Skill") return handleSkill(input, config);
  if (toolName === "Bash") return rememberChange(input);
  if (!/^(Read|Edit|Write|MultiEdit)$/.test(toolName)) return;
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath) return;
  const resolved = path.resolve(input.cwd || process.cwd(), filePath);
  const isSource = Boolean(languageFor(resolved)) && !isExcluded(resolved, config);
  const policy = isSource && !policyDeliveredThisSession(input) ? firstSourceFileContext(config) : null;
  if (toolName === "Read") {
    if (policy) emit({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: policy } });
    return;
  }
  rememberChange(input);
  const addedLinesByFile = new Map([[resolved, editedLines(input, toolName, resolved)]]);
  const report = formatReport([analyzeFile(resolved, config)], config, { addedLinesByFile });
  if (!report && !policy) return;
  const output = {};
  if (report && mode !== "warn") {
    output.decision = "block";
    output.reason = report;
  }
  const context = [policy, mode === "warn" ? report : null].filter(Boolean).join("\n\n");
  if (context) output.hookSpecificOutput = { hookEventName: "PostToolUse", additionalContext: context };
  emit(output);
}

function editedLines(input, toolName, filePath) {
  const response = input.tool_response || {};
  if (Array.isArray(response.structuredPatch)) return addedLinesFromPatch(response.structuredPatch);
  if (toolName === "Write" || !fs.existsSync(filePath)) return null;
  const toolInput = input.tool_input || {};
  const edits = toolName === "MultiEdit" ? toolInput.edits || [] : [toolInput];
  const inserted = edits.map((edit) => edit.new_string).filter((text) => typeof text === "string");
  if (inserted.length === 0) return null;
  return linesContaining(fs.readFileSync(filePath, "utf8"), inserted.filter(Boolean));
}

function addedLinesFromPatch(hunks) {
  const added = new Set();
  for (const hunk of hunks) {
    let line = hunk.newStart;
    for (const text of hunk.lines || []) {
      if (text.startsWith("-") || text.startsWith("\\")) continue;
      if (text.startsWith("+")) added.add(line);
      line++;
    }
  }
  return added;
}

function linesContaining(content, snippets) {
  const found = new Set();
  for (const snippet of snippets) {
    for (let at = content.indexOf(snippet); at !== -1; at = content.indexOf(snippet, at + snippet.length)) {
      const first = content.slice(0, at).split("\n").length;
      const span = snippet.replace(/\n$/, "").split("\n").length;
      for (let offset = 0; offset < span; offset++) found.add(first + offset);
    }
  }
  return found;
}

function handlePreToolUse(input, config, mode) {
  if (mode === "warn") return;
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName) || !toolInput.file_path) return;
  const resolved = path.resolve(input.cwd || process.cwd(), toolInput.file_path);
  if (!languageFor(resolved) || isExcluded(resolved, config)) return;
  const current = fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : null;
  const proposed = proposedFile(toolName, toolInput, current);
  if (!proposed) return;
  const result = analyzeSource(proposed.content, resolved, config);
  const report = formatReport([result], config, { addedLinesByFile: new Map([[resolved, proposed.added]]), footer: REDO_EDIT });
  if (!report) return;
  const policy = policyDeliveredThisSession(input) ? null : firstSourceFileContext(config);
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: [report, policy].filter(Boolean).join("\n\n"),
    },
  });
}

function proposedFile(toolName, toolInput, current) {
  if (toolName === "Write") {
    if (typeof toolInput.content !== "string") return null;
    return { content: toolInput.content, added: current === null ? null : linesNotIn(toolInput.content, current) };
  }
  if (current === null) return null;
  const edits = toolName === "MultiEdit" ? toolInput.edits || [] : [toolInput];
  let content = current;
  const inserted = [];
  for (const edit of edits) {
    if (typeof edit.old_string !== "string" || typeof edit.new_string !== "string") return null;
    if (edit.old_string === "" ? content !== "" : !content.includes(edit.old_string)) return null;
    content = edit.replace_all ? content.split(edit.old_string).join(edit.new_string) : content.replace(edit.old_string, () => edit.new_string);
    if (edit.new_string !== "") inserted.push(edit.new_string);
  }
  return { content, added: linesContaining(content, inserted) };
}

function linesNotIn(content, previous) {
  const remaining = new Map();
  for (const line of previous.split("\n")) remaining.set(line, (remaining.get(line) || 0) + 1);
  const added = new Set();
  content.split("\n").forEach((line, index) => {
    const left = remaining.get(line) || 0;
    if (left > 0) remaining.set(line, left - 1);
    else added.add(index + 1);
  });
  return added;
}

function firstSourceFileContext(config) {
  return `This project is under the code comment policy below. It applies to every source file you create or edit; a hook checks each Edit/Write and the branch before you stop.\n\n${readPolicy(config)}`;
}

function handleSkill(input, config) {
  const toolInput = input.tool_input || {};
  const skill = toolInput.skill || toolInput.skill_name || toolInput.name || JSON.stringify(toolInput);
  emitSkillContext(skill, "PostToolUse", config);
}

function handleUserPromptExpansion(input, config) {
  if (input.command_type && input.command_type !== "skill") return;
  emitSkillContext(input.command_name || "", "UserPromptExpansion", config);
}

function emitSkillContext(skill, hookEventName, config) {
  if (!new RegExp(config.skillMatch).test(skill)) return;
  const policy = readPolicy(config);
  const addendum = skillAddendum(skill);
  emit({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: `${skill} is running under the user's global code comment policy. It applies to every file this skill creates or edits, and a hook enforces it on each Edit/Write and before you stop.\n\n${policy}\n\n${addendum}`,
    },
  });
}

function skillAddendum(skill) {
  if (/code-review/.test(skill)) {
    return [
      "For this review, extend both briefs:",
      "- Standards: add a third check, comment hygiene. Every comment that restates the code, narrates steps, cites a document (ADR, spec, ticket, issue), or paraphrases a decision record is a Standards finding with the line and the fix (delete, rename, or extract).",
      "- Spec: for every comment that attributes a constraint or number to a document, open that document and confirm it states exactly that. A comment whose claim is not in the cited document is a Spec finding; report both the comment and the sentence it should have cited, or that no such sentence exists.",
    ].join("\n");
  }
  return [
    "For this work:",
    "- A test name, a commit message, or a type is where a fact about the code goes. A comment is the last resort and states only a non-obvious why.",
    "- The refactor step of each red-green-refactor loop includes deleting comments the green step left behind. Rename or extract instead of commenting.",
    "- References to an ADR, spec, ticket, or issue go in the commit message as trailers (Implements: ADR-NNNN, Refs: #NN), never in source.",
    "- Before each commit, the diff must satisfy the policy. A commit that adds a restating or document-citing comment is a defect, not a style choice.",
  ].join("\n");
}

function readPolicy(config) {
  if (!fs.existsSync(config.policyFile)) return "(The policy file was not found; the policy is: no comments that restate the code, narrate, or cite a document. Use names, types, tests, and commit messages.)";
  return fs.readFileSync(config.policyFile, "utf8").replace(/^---[\s\S]*?---\s*/, "").trim();
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function changedFiles(cwd, explicitBase) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) return { root: null, base: null, files: new Set() };
  const root = realPath(top);
  const base = explicitBase === undefined ? mergeBase(root) : explicitBase;
  const committed = base ? git(["diff", "--name-only", `${base}..HEAD`], root) : "";
  const working = git(["diff", "--name-only", "HEAD"], root) || "";
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root) || "";
  const files = new Set();
  for (const name of [...(committed || "").split("\n"), ...working.split("\n"), ...untracked.split("\n")]) {
    if (name.trim()) files.add(path.join(root, name.trim()));
  }
  return { root, base, files };
}

function mergeBase(root) {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const candidates = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];
  for (const candidate of candidates) {
    const ref = git(["rev-parse", "--verify", "--quiet", candidate], root);
    if (!ref) continue;
    const symbolic = git(["rev-parse", "--abbrev-ref", candidate], root) || candidate;
    if (symbolic.replace(/^origin\//, "") === head) return null;
    const base = git(["merge-base", "HEAD", candidate], root);
    if (base) return base;
  }
  return null;
}

function addedLines(root, base, relativePath) {
  const since = base || "HEAD";
  const diff = git(["diff", "-U0", since, "--", relativePath], root);
  if (diff === null || diff === "") {
    const tracked = git(["ls-files", "--error-unmatch", relativePath], root);
    if (tracked === null) return null;
    return new Set();
  }
  const added = new Set();
  for (const hunk of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i++) added.add(start + i);
  }
  return added;
}

function handleStop(input, config, mode) {
  if (input.stop_hook_active || !changedThisSession(input)) return;
  const { root, base, files } = changedFiles(input.cwd || process.cwd());
  const results = [];
  const addedLinesByFile = new Map();
  for (const file of files) {
    const result = analyzeFile(file, config);
    if (!result) continue;
    results.push(result);
    const added = addedLines(root, base, path.relative(root, file));
    if (added !== null) addedLinesByFile.set(file, added);
  }
  const report = formatReport(results, config, { addedLinesByFile });
  if (!report) return;
  if (mode === "warn") {
    process.stderr.write(`${report}\n`);
    return;
  }
  emit({ decision: "block", reason: `${report}\nThese are the changes on this branch. Clean them up, commit the cleanup, then stop.` });
}

function parseCliArgs(args) {
  const options = { format: "text", base: undefined, files: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") options.format = "json";
    else if (arg === "--base") options.base = args[++i];
    else if (!arg.startsWith("--")) options.files.push(arg);
  }
  return options;
}

function cliTargets(options, config, cwd) {
  if (options.base === undefined) {
    return { results: options.files.map((file) => analyzeFile(path.resolve(cwd, file), config)) };
  }
  const base = git(["rev-parse", "--verify", "--quiet", `${options.base}^{commit}`], cwd);
  if (!base) return { error: `comment-guard: --base ${options.base} is not a commit in this repository` };
  const { root, files } = changedFiles(cwd, base);
  const wanted = options.files.length > 0 ? new Set(options.files.map((file) => realPath(path.resolve(cwd, file)))) : null;
  const results = [];
  const addedLinesByFile = new Map();
  for (const file of files) {
    if (wanted && !wanted.has(file)) continue;
    const result = analyzeFile(file, config);
    if (!result) continue;
    results.push(result);
    const added = addedLines(root, base, path.relative(root, file));
    if (added !== null) addedLinesByFile.set(file, added);
  }
  return { results, addedLinesByFile };
}

function jsonResults(results, config, addedLinesByFile) {
  return results.filter(Boolean).map(({ commentLineNumbers, nonBlankLineNumbers, comments, problems, ...rest }) => {
    const added = addedLinesByFile ? addedLinesByFile.get(rest.filePath) : null;
    return { ...rest, problems: added ? problems.filter((p) => touchesAddedLine(p, added)) : problems, ...commentBudget({ commentLineNumbers, nonBlankLineNumbers }, config, added) };
  });
}

function runCli(args, config) {
  const options = parseCliArgs(args);
  const { results, addedLinesByFile, error } = cliTargets(options, config, process.cwd());
  if (error) {
    process.stderr.write(`${error}\n`);
    process.exitCode = 2;
    return;
  }
  const report = formatReport(results, config, { addedLinesByFile });
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(jsonResults(results, config, addedLinesByFile), null, 2)}\n`);
  } else {
    process.stdout.write(report ? `${report}\n` : "comment-guard: clean\n");
  }
  process.exitCode = report ? 1 : 0;
}

function main() {
  const mode = (process.env.COMMENT_GUARD || "block").toLowerCase();
  if (mode === "off") return;
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "--hook") {
    runCli(args, loadConfig(process.cwd()));
    return;
  }
  const input = readStdin();
  const config = loadConfig(input.cwd || process.cwd());
  switch (input.hook_event_name) {
    case "PreToolUse":
      handlePreToolUse(input, config, mode);
      break;
    case "PostToolUse":
      handlePostToolUse(input, config, mode);
      break;
    case "UserPromptExpansion":
      handleUserPromptExpansion(input, config);
      break;
    case "Stop":
      handleStop(input, config, mode);
      break;
    default:
      break;
  }
}

if (require.main === module) main();

module.exports = { analyzeSource, analyzeFile, formatReport, loadConfig, DEFAULT_CONFIG, extractComments, isReference, restatesName, globToRegExp, isExcluded };
