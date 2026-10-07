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
| Enforcement | PostToolUse on `Edit`, `Write`, and a `Stop` hook | After each edit the whole file is scanned; a violation blocks with a line-by-line report and the fix. Before the agent stops, the files this session edited are scanned against the branch's changes and only added lines are reported, so your own uncommitted work is never blocked. The agent cannot finish with violations in place. |

## What the scanner flags

| Kind | Example | Fix it tells the agent |
|---|---|---|
| cites a document | `// per ADR 0008`, `(#94)`, `slice 1.2`, `PROJ-123`, `see docs/adr/...` | Delete; the link goes in the commit trailer or the ADR's Implemented-by list. |
| restates the name | `/** Epoch ms. */ type EpochMs` | Delete; rename if the name was unclear. |
| narrates the steps | `// Now we validate the input` | Delete; extract a function named after the step. |
| describes the change | `// Added to support retries` | Delete; that is the commit message. |
| section banner | `// ---- Helpers ----` | Delete; extract. |
| commented-out code | `// const old = compute(x);` | Delete. |
| budget | more than 10% of non-blank lines are comments (and at least 3) | Delete restating and paraphrasing comments. |

Never flagged: `TODO(#123)`, lint pragmas, shebangs, standards names such as `SHA-256` or `ISO-8601`, a units note the type cannot express (`/** Epoch ms. */ expiresAt?: number`), and any "why" comment that states a fact without naming a document.

Skipped: dotfiles, `*.config.*`, `*.d.ts`, `docs/`, `node_modules/`, `dist/`, generated files, and anything not in the language list.

## Where traceability lives instead

- Commit trailers: `Implements: ADR-0009`, `Refs: #94`. `git log --grep` finds every implementing commit.
- Test names that state the rule. A test asserting an ADR's constraint is the executable link to it.
- An "Implemented by" section in the ADR itself, pointing from the decision to the code.
- Architecture rules (dependency-cruiser, ESLint) named after the ADR they enforce.

## Tune or switch off

- `COMMENT_GUARD=warn` turns blocks into advisory context. `COMMENT_GUARD=off` disables every hook.
- `~/.claude/comment-guard.json` or `<project>/.claude/comment-guard.json` overrides `maxCommentRatio`, `minCommentLines`, `exclude` (globs, added to the defaults), `referenceAllowlistPrefixes`, `skillMatch` (which skills get the addendum), and `policyFile` (your own policy text).
- To target another skills plugin, change the `if` rule and the `UserPromptExpansion` matcher in `hooks/hooks.json` as well as `skillMatch`. `if` holds one permission rule with no list syntax, so a prefix such as `Skill(mattpocock-skills *)` is how a whole plugin is named.
- Run it by hand: `node hooks/comment-guard.js src/**/*.ts` exits 1 on problems, `--json` gives structured output. This also works as a pre-commit or CI check under any agent.

## Tests

```bash
npm test
```

The fixtures in `test/fixtures/pr100` are files copied from [andrewferk/url-shortener](https://github.com/andrewferk/url-shortener) pull request #100 (Apache-2.0, see the NOTICE beside them). The tests assert that every ADR citation in them is flagged and that the two genuine "why" comments are not.

## Limits

- The scanner is pattern-based. It cannot judge whether a comment that cites no document is worthwhile; the budget and the policy text carry that part.
- Template literals, nested block comments, and raw strings in Rust or Python are handled approximately. A false positive is cheap to see in the report and can be excluded by path.
- The `Stop` hook fires once per stop; if the agent cannot fix a violation it stops on the second attempt with the report still in context.
- Hooks run in parallel with other hooks on the same event, so a formatter hook on `Edit` may rewrite a file while this one scans the pre-format copy.
