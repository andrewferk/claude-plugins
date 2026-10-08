# comment-guard

A Claude Code plugin that keeps LLM-written code free of comments that restate the code, narrate steps, or cite an ADR, spec, ticket, or issue. Names, types, tests, and commit messages carry those facts instead. The policy is delivered and enforced by hooks, so it holds in every project without touching the project's files or your settings.

Built for the [mattpocock skills](https://github.com/mattpocock/skills) implement loop, where `/implement`, `/tdd`, and `/code-review` otherwise leave a trail of `// per ADR 0008` comments that drift from both the ADR and the code.

## Install

```
/plugin marketplace add andrewferk/claude-plugins
/plugin install comment-guard@andrewferk
```

Requires Node 18 or later on the path. Start a new session after installing.

## What it does

Three layers, from advisory to deterministic, all shipped as hooks:

| Layer | Hook | Effect |
|---|---|---|
| Policy | PostToolUse on `Read`, `Edit`, `Write` | The first time a session reads or edits a source file (TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift, C#, Ruby), the [policy](./policy/code-comments.md) is added to context, once. A session that never touches source never sees it. |
| Skill context | `UserPromptExpansion`, and PostToolUse on the `Skill` tool, both narrowed to the `mattpocock-skills` plugin | When `implement`, `tdd`, `code-review`, `diagnosing-bugs`, `prototype`, `improve-codebase-architecture`, `implement-spec`, or `codebase-design` starts, whether you typed it or Claude invoked it, the policy is injected again with a skill-specific addendum. For `code-review` that adds a comment-hygiene check to the Standards brief and a citation check to the Spec brief: open the cited document and confirm it says what the comment claims. |
| Enforcement | PreToolUse and PostToolUse on `Edit`, `Write`, `MultiEdit`, PostToolUse on `Bash`, and a `Stop` hook | Before an edit lands, the hook computes the file it would produce and refuses the call if the lines it adds break the policy, with a line-by-line report and the fix; the file on disk is never touched. After an edit that got through, the same check runs on the lines the tool's patch says were added (a file the agent creates is judged whole), as a safety net. Before the agent stops, every file changed on the branch is checked, whichever way it was written, and again only added lines count; a file the agent produced through a shell command is covered here. This check runs only once the session has edited a file or run a command, so a session that only reads and answers is never blocked. A comment that was already in the file before the branch never blocks, so legacy files stay out of the report. The agent cannot finish with violations in place. |

## What the scanner flags

| Kind | Example | Fix it tells the agent |
|---|---|---|
| cites a document | `// per ADR 0008`, `(#94)`, `slice 1.2`, `PROJ-123`, `see docs/adr/...` | Delete; the link goes in the commit trailer or the ADR's Implemented-by list. |
| restates the name | `/** Epoch ms. */ type EpochMs` | Delete; rename if the name was unclear. |
| narrates the steps | `// Now we validate the input` | Delete; extract a function named after the step. |
| describes the change | `// Added to support retries` | Delete; that is the commit message. |
| section banner | `// ---- Helpers ----` | Delete; extract. |
| commented-out code | `// const old = compute(x);` | Delete. |
| budget | more than 10% of the change's non-blank lines are comments (and at least 3); the CLI measures the whole file | Delete restating and paraphrasing comments. |

Never flagged: `TODO(#123)`, lint pragmas, shebangs, standards names such as `SHA-256` or `ISO-8601`, a units note the type cannot express (`/** Epoch ms. */ expiresAt?: number`), and any "why" comment that states a fact without naming a document.

Skipped: dotfiles, `*.config.*`, `*.d.ts`, `docs/`, `node_modules/`, `dist/`, generated files, and anything not in the language list.

## Where traceability lives instead

- Commit trailers: `Implements: ADR-0009`, `Refs: #94`. `git log --grep` finds every implementing commit.
- Test names that state the rule. A test asserting an ADR's constraint is the executable link to it.
- An "Implemented by" section in the ADR itself, pointing from the decision to the code.
- Architecture rules (dependency-cruiser, ESLint) named after the ADR they enforce.

## Tune or switch off

- `COMMENT_GUARD=warn` turns blocks into advisory context and lets every edit land. `COMMENT_GUARD=off` disables every hook.
- `~/.claude/comment-guard.json` or `<project>/.claude/comment-guard.json` overrides `maxCommentRatio`, `minCommentLines`, `exclude` (globs, added to the defaults), `referenceAllowlistPrefixes`, `skillMatch` (which skills get the addendum), and `policyFile` (your own policy text).
- To target another skills plugin, change the `if` rule and the `UserPromptExpansion` matcher in `hooks/hooks.json` as well as `skillMatch`. `if` holds one permission rule with no list syntax, so a prefix such as `Skill(mattpocock-skills *)` is how a whole plugin is named.
- Run it by hand: `node hooks/comment-guard.js src/**/*.ts` exits 1 on problems, `--json` gives structured output. `--base <commit>` judges only the lines added since that commit across every changed file, `--scope all` audits every tracked source file, and `--paths` takes newline- or comma-separated globs that narrow either run. This also works as a pre-commit check under any agent.

## Use in CI

The same scanner ships as a composite GitHub Action, so a pull request fails on the comments the hook would have refused locally. It judges only the lines the pull request adds, fetches the base commit itself when the checkout is shallow, annotates each finding on the diff, and writes a table to the job summary. No token or permission is needed.

```yaml
name: comment-guard

on:
  pull_request:
  merge_group:

jobs:
  comments:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: andrewferk/claude-plugins/plugins/comment-guard@comment-guard-v0.3.0
```

| Input | Default | Effect |
|---|---|---|
| `scope` | `changed` | `changed` judges the lines added since the base; `all` audits every tracked source file. |
| `base` | from the event | A commit sha to diff against. Read from the `pull_request`, `merge_group`, or `push` payload when empty; any other event needs `base` or `scope: all`. |
| `paths` | every source file | Newline-separated globs that narrow the file set. They never add back a file the exclude list removes. |
| `fail` | `true` | `false` annotates and summarises but lets the job pass, for a repository adopting the policy gradually. |

Policy settings come from the repository's `.claude/comment-guard.json`, the same file the hook reads, so the action and the hook cannot disagree. The runner needs Node 18 or later on the path, which GitHub's hosted runners provide. Pin the exact release tag; there is no floating major tag before 1.0.

## Tests

```bash
npm test
```

The fixtures in `test/fixtures/pr100` are files copied from [andrewferk/url-shortener](https://github.com/andrewferk/url-shortener) pull request #100 (Apache-2.0, see the NOTICE beside them). The tests assert that every ADR citation in them is flagged and that the two genuine "why" comments are not.

## Limits

- The refusal before an edit reconstructs the file from the tool's input. For `Write` over an existing file, a line counts as added when the old file did not contain it verbatim, so a moved line is judged again.
- The hooks never report a comment that predates the change, so a touched file can keep old violations. Run the CLI on it to see them all.
- The `Stop` check covers the whole branch, not just the agent's edits. Once the session has edited a file or run a command, a violation you added by hand on the same branch is reported alongside the agent's.
- The scanner is pattern-based. It cannot judge whether a comment that cites no document is worthwhile; the budget and the policy text carry that part.
- Template literals, nested block comments, and raw strings in Rust or Python are handled approximately. A false positive is cheap to see in the report and can be excluded by path.
- The `Stop` hook fires once per stop; if the agent cannot fix a violation it stops on the second attempt with the report still in context.
- Hooks run in parallel with other hooks on the same event, so a formatter hook on `Edit` may rewrite a file while this one scans the pre-format copy.
