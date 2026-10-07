# Route ADR traceability around code comments

The ADR-citing comments in url-shortener PR #100 are not hallucinated and not prompted by any line in the mattpocock-skills plugin; they are the agent's cheapest way to prove compliance in a workflow that tags every acceptance criterion with an ADR, tells it five times to "respect ADRs", asks the code-review Spec reviewer to "quote the spec line for each finding", and never names a smell for comment volume. **PR #100 added 1,470 TypeScript lines, of which 196 (13%) are comment lines, 46 cite an ADR by number, and 60 of 68 exports in `packages/core/src` carry a JSDoc block; the previous PR by the same workflow (#99) ran at 5% comment lines with 5 ADR citations** ([PR #100](https://github.com/andrewferk/url-shortener/pull/100), [PR #99](https://github.com/andrewferk/url-shortener/pull/99)). Every ADR citation checked against the ADR text is accurate except one attribution (the `MAX_DRAWS = 8` constant credited to ADR 0002, whose number actually comes from ADR 0009's keyed-create walk), so the problem is redundancy and placement, not falsehood: the same sentence ends up in the ADR, issue #94, the PR body, the source JSDoc and the test file. In speech-dataset-workbench the behaviour is explicitly instructed by the user's own `docs/agents/code-comments.md` ("Cite a decision by bare tag — `(ADR-0005)`"), which has produced 816 `ADR-NNNN` tags in 14,317 lines ([code-comments.md](https://github.com/andrewferk/speech-dataset-workbench/blob/main/docs/agents/code-comments.md)). The literature supports a principled policy: both the minimalist and essentialist schools reject comments that restate what code, names or tests already say; empirical mining finds comments co-change with code in only 13–20% of edits and that more than half of renamed identifiers leave stale prose behind; and no canonical ADR source (Nygard, MADR, adr-tools, Log4brains, AWS, Microsoft, Google Cloud) recommends citing ADR IDs from code, while MADR's "Confirmation" section gives the sanctioned reverse link from decision to test. The fix is to build the replacement channels first (commit trailers, Vitest tags, an ADR-side "Implemented by / Confirmation" section, ADR-named architecture rules), then rewrite the comment policy in positive terms, then enforce it with a PreToolUse hook, an ESLint comment rule and commitlint, and finally patch the code-review skill's two briefs so the review verifies citations and flags comment smells instead of rewarding them.

## PR #100 restates ADR sentences on 36 of 70 source comment blocks

Counting over `gh pr diff 100` (ts/js only; `package-lock.json` and `docs/adr` excluded), the PR carries **86 comment blocks, 70 in `src` and 14 in `test`; 36 of the `src` blocks and 7 of the `test` blocks cite an ADR**, across 12 distinct ADRs, with ADR 0014 and 0008 cited nine times each ([PR #100 files](https://github.com/andrewferk/url-shortener/pull/100/files)). Comment density is highest exactly where the ADRs are densest: `short-code.ts` 41%, `link-id.ts` 29%, `encoding.ts`, `link.ts` and `ports.ts` 27% each, `create-link.ts` 14%, while most test files sit at 0–3%. **[evidenced]**

The dominant form, roughly 36 blocks, is a one-line JSDoc that paraphrases an ADR sentence onto the symbol it governs. `link-id.ts` has `/** A Namespace's opaque ID: 'default', or 'ns_' plus 10 base62 characters (ADR 0014). */` on `export type NamespaceId = string;`, which is ADR 0014 lines 25–26 almost verbatim ([ADR 0014](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/adr/0014-link-identity-carries-an-opaque-namespace.md)). `encoding.ts` has `/** Shard n's Durable Object name, with n in decimal (ADR 0008). */` on a function whose entire body is `` return `shard-${String(shard)}`; ``, and `/** A Creator's Durable Object name: its Creator ID (ADR 0008). */` on a function whose body is `return creatorId;` ([ADR 0008](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/adr/0008-link-data-model-shards-kv-creator-lists-backups.md)). A second form, about 20 blocks, restates the code without any ADR: `/** The current time, as epoch milliseconds. */` on `interface Clock { now(): number; }`, and `/** Epoch ms. */` three times over on `at`, `createdAt` and expiry fields, which a name like `createdAtMs` would carry. A third form is the file banner: `ports.ts` opens with `// The core's ports (ADRs 0001, 0005, 0014). The Workers implement them as // adapters over Cloudflare; in-memory.ts implements them for tests and for // embedders who bring nothing else.`, and `encoding.test.ts` opens with `// Pinned test vectors for every permanent encoding (ADRs 0008, 0009, 0014, // 0018, 0019, 0028). Every adapter, in any language, must reproduce them // exactly.` The redundancy is five-deep in the worst case: the sentence "`.`, `/` and `+` are permanently excluded: future routes depend on it (ADR 0002)" appears in `short-code.test.ts`, in `short-code.ts`, in ADR 0002 line 31, in issue #94's first acceptance criterion and in the PR body ([Issue #94](https://github.com/andrewferk/url-shortener/issues/94), [ADR 0002](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/adr/0002-random-short-codes-claimed-by-conditional-insert.md)). **[evidenced]**

Only a minority, about six blocks, are the "why" comments every school endorses: `generator.ts`'s `// 248 is the largest multiple of 62 a byte holds; a higher byte would skew the draw.`, `link.ts`'s `// A delete outranks a live record; of two deletes, the later wins, so the result doesn't depend on the order records arrive in.`, and `.dependency-cruiser.js`'s explanation of why type-only cycles are checked there rather than in ESLint. These are the comments the policy below keeps. **[evidenced]**

### The one citation that does not hold, and why it matters

Every ADR citation checked against the ADR text on the PR branch was accurate (ADRs 0004, 0005, 0006, 0008, 0009, 0014, 0018, 0019, 0028), with one exception. `create-link.ts` has `/** How many generated Short codes a create draws before giving up (ADR 0002's small, bounded retry budget). */` on `const MAX_DRAWS = 8;`. **ADR 0002 line 27 says only that "the retry budget is small and bounded"; the number 8 comes from ADR 0009 line 36, "The walk gives up after 8 candidates", which is about keyed creates, not the unkeyed CSPRNG path the constant governs** ([ADR 0002](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/adr/0002-random-short-codes-claimed-by-conditional-insert.md), [ADR 0009](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/adr/0009-idempotent-link-creation-by-key-derived-short-codes.md)). A second, softer case sits in `link.ts` `applyDelete`, where "Another Creator's Link reads as not found, so a Creator learns nothing about Links it doesn't own" shares a block with an ADR 0019 tag although the rule lives in ADR 0005 line 32 and ADR 0014 line 59. **[evidenced]** Neither is wrong enough to mislead today, but both are exactly the drift the literature predicts: a citation is a pointer whose target the reader rarely checks, and nobody checked these, because the PR has zero human reviews and zero review comments, and the only "review" was the agent's own second commit "Apply the review of slice 1.2", which added more comments rather than removing any ([PR #100 commits](https://github.com/andrewferk/url-shortener/pull/100/commits)). **[evidenced]** The MAX_DRAWS case is also the strongest argument for the executable alternative: a test named "gives up after 8 draws" tagged `adr-0009` cannot cite the wrong ADR silently, because the tag must exist in the Vitest config and the test must pass.

### Nothing in url-shortener asks for comments; three things make them the path of least resistance

`AGENTS.md` on the PR branch is 13 lines of pointers to `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md`; `CLAUDE.md` does not exist (404), and `docs/agents/code-comments.md` has never existed in the repo's history ([AGENTS.md](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/AGENTS.md)). **[evidenced]** Three documents nevertheless push the agent toward ADR-tagging. `CONTRIBUTING.md` line 8 says "Read the ADRs in `docs/adr/` that touch the area you're changing. A change that contradicts one needs a new ADR, or an amendment, in the same pull request", and line 84 says "Explain the change, and link the issue or ADR it implements"; the file itself cites ADRs inline in prose, e.g. "([ADR 0001](./docs/adr/0001-...md))" ([CONTRIBUTING.md](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/CONTRIBUTING.md)). It names the PR as the place to link an ADR but never says where references do not belong. `docs/agents/domain.md` (the plugin's stock file) line 9 says "read ADRs that touch the area you're about to work in", and lines 47–51 give the only worked example of referencing an ADR anywhere in the config: "If your output contradicts an existing ADR, surface it explicitly rather than silently overriding: _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_" ([domain.md](https://github.com/andrewferk/url-shortener/blob/worktree-94-domain-core/docs/agents/domain.md)). And issue #94 itself puts ADR tags inside its acceptance criteria ("Pinned test vectors cover ADR 0009's candidate derivation", "Link identity is `(Namespace, Short code)` throughout (ADR 0014)"), so an agent proving each criterion is met has a one-to-one map from "criterion (ADR N)" to "symbol with JSDoc (ADR N)" ([Issue #94](https://github.com/andrewferk/url-shortener/issues/94)). The ADRs compound this by handing the model quotable sentences per function: ADR 0009 line 28, 0018 line 31, 0019 line 46 and 0014 line 52 each say some variant of "The domain core owns this function, pinned by test vectors", and the ADRs' own prose uses the parenthetical "(ADR NNNN)" style dozens of times, which the PR copies exactly. **[evidenced for the text; inferred for the causal path]**

### speech-dataset-workbench instructs the pattern outright

The second repo removes any doubt about where the house style comes from. `AGENTS.md` lines 17–19 read "### Code comments / Trace, don't restate: cite ADRs by tag, keep code to the constraint. See `docs/agents/code-comments.md`", and that ten-line file, added by the user on 2026-07-24 (commit 36c569d9, co-authored with Claude), says in full: "**Trace, don't restate.** The ADR is the single source of truth for *why*. Code carries only what a future editor needs at the moment they edit. / - Cite a decision by bare tag — `(ADR-0005)` — and let the tag carry the reasoning. / - Comment when an edit that looks correct would break a decision. Say what breaks, in one line. / - Docstrings state the contract: what it returns, what it raises, what invariant it holds. One to three lines. / - Rejected alternatives, trade-offs, library choices, and licensing live in the ADR. If a rationale needs a paragraph, add that paragraph to the ADR and cite the tag. / - Delete any comment whose removal wouldn't change what a future editor does. If a comment restates a sentence that exists in an ADR, the tag alone replaces it. / - Comments and docstrings together stay under ~40% of a module's lines. This is a smell detector, not a build gate" ([code-comments.md](https://github.com/andrewferk/speech-dataset-workbench/blob/main/docs/agents/code-comments.md), [commit 36c569d9](https://github.com/andrewferk/speech-dataset-workbench/commit/36c569d9)). **The result is 816 `ADR-NNNN` tags across `src/sdw` (203 tagged lines), `tests/unit` (195), `tests/e2e` (94), `tests/synth.py` and `examples/generate.py`**, with samples like `# default, so an upgrade does not change every byte of every image (ADR-0011).` and `"""An abort anywhere leaves no durable --data-out, reports included (ADR-0003)."""` ([speech-dataset-workbench](https://github.com/andrewferk/speech-dataset-workbench)). **[evidenced]** Two details are diagnostic. First, the policy's "~40%" ceiling legitimises the 27–41% densities seen in PR #100's core files. Second, sdw's tags are all hyphenated (`ADR-0005`), as the policy prescribes, while PR #100 uses the spaced form (`ADR 0008`) that url-shortener's ADRs use in their own prose; the url-shortener comments were therefore shaped by that repo's ADR text and by the model's memory of a style this user has accepted before, not by a copied policy file. **[inferred]**

## The plugin never asks for comments, but its loop has no counter-pressure

An exhaustive grep of the installed plugin (v1.2.3: `skills/`, `CLAUDE.md`, `CONTEXT.md`, `.agents/`, `README.md`) for `comment`, `jsdoc` and `docstring` finds every hit to be about issue or PR comments, except two prototype-skill lines about a top-of-file plan note and the plugin's own contributor rule banning em-dashes in "code comments" ([mattpocock/skills](https://github.com/mattpocock/skills)). **`skills/engineering/implement/SKILL.md` is 15 lines; its entire operative text is "Implement the work described by the user in the spec or tickets. / Use /tdd where possible, at pre-agreed seams. / Run typechecking regularly, single test files regularly, and the full test suite once at the end. / Once done, use /code-review to review the work. / Commit your work to the current branch."** It says nothing about what the diff should look like. **[evidenced]**

What the skills do say, repeatedly, is "respect ADRs": `tdd/SKILL.md` line 10 ("read `CONTEXT.md` ... so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching"), `to-spec` line 13, `to-tickets` line 21, `triage` line 70, `diagnosing-bugs` line 10, and `improve-codebase-architecture` lines 14, 25 and 56, the last of which models the reference as a tag: "_contradicts ADR-0007, but worth reopening because…_". `domain-modeling/ADR-FORMAT.md` line 34 frames an ADR as the answer when "a future reader will look at the code and wonder 'why on earth did they do it this way?'", and line 45 says ADRs "stop the next engineer from 'fixing' something that was deliberate"; the natural inference for an agent is that the code should point back at the ADR. `codebase-design/SKILL.md` line 16 defines an Interface as "everything a caller must know to use the module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics", which on a TypeScript signature can only be carried by a doc comment and matches what PR #100 did (JSDoc on 60 of 68 exports stating invariants such as "never reissued" and "goes Gone at its Expiry exactly"). **[evidenced for the text; inferred for the mechanism]**

The review stage, where comment pruning could happen, is structurally blind to it. `tdd/SKILL.md` line 38 says "**Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill)". `code-review/SKILL.md` line 70 briefs the Spec sub-agent to report missing requirements, scope creep and wrong implementations and to "Quote the spec line for each finding", which rewards leaving the quoted line next to the code; line 64 briefs the Standards sub-agent to "cite the standard (file + the rule)" for each violation and to flag "any baseline smell you spot" from a 12-smell Fowler list (lines 45–56) that includes "Mysterious Name" and "Speculative Generality" but omits Fowler's own "Comments" smell. **[evidenced]** So the only agent in the loop with a mandate to remove things has no criterion under which a redundant comment is a finding, and the one with a mandate to verify spec compliance is told to quote, not to check whether a citation in the diff is correct. Matt Pocock's stated maintenance bar is that he "only change[s] skills in response to a failure seen in a real session" (closing #613, which proposed linking specs to governing ADRs), and no issue on mattpocock/skills concerns code comments or ADR tags in source ([#613](https://github.com/mattpocock/skills/issues/613)); his remark on #1089 that "Cranking effort high can incentivise the model to simply produce more tokens, i.e. write more files" is a plausible contributor here too, but the user's `effortLevel` value was not inspected ([#1089](https://github.com/mattpocock/skills/issues/1089)). **[evidenced for the quotes; inferred for effort]**

### The model brings its own prior, and prose rules alone will not remove it

The behaviour persists despite Claude Code's own system prompt, which (per a community transcription Anthropic does not publish) says "Do not add comments to the code you write, unless the user asks you to, or the code is complex and requires additional context" ([claude-code-prompts transcription](https://github.com/BrendanGraham14/claude-code-prompts/blob/main/system_prompt.md); unverified wording). Anthropic's own documentation records that "Claude Opus 4.5 and Claude Opus 4.6 have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested", and its sample mitigation prompt includes "Don't add docstrings, comments, or type annotations to code you didn't change. Only add comments where the logic isn't self-evident" ([Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)). A June 2026 issue on anthropics/claude-code, open and unanswered, reports that "A clear, mandatory rule in CLAUDE.md does not reliably suppress it" and that enforcement hooks are "still only partially effective" ([#65961](https://github.com/anthropics/claude-code/issues/65961)). **[evidenced]**

Three mechanisms with real evidence behind them explain the prior, though none has been isolated as the cause of over-commenting specifically. Reward models used in RLHF are length-biased: "a purely length-based reward reproduces most downstream RLHF improvements" ([Singhal et al., COLM 2024](https://arxiv.org/abs/2310.03716)), and preference models "favor longer responses that appear more comprehensive, even when their quality is equal to or lower" ([Zhang et al.](https://arxiv.org/html/2409.11704v1)). Comments act as a reasoning pivot for code models: a decoding strategy that emits a comment before code "significantly improves the code pass rate" ([MANGO, ACL 2024](https://arxiv.org/html/2404.07549v1)), and an ICSE 2025 interpretability study found comments are internalised as a distinct latent concept whose manipulation shifts task performance from -90% to +67% ([Inside Out](https://arxiv.org/html/2512.16790v1)). And negated instructions are followed worse as models scale ([Jang et al.](https://arxiv.org/abs/2209.12711)), which both Anthropic ("Tell Claude what to do instead of what not to do") and the plugin's own `writing-for-agents` skill ("steering by prohibition drags the forbidden behaviour into context and makes it _more_ available") already warn about. Anthropic's docs add the operational constraints: CLAUDE.md is "advisory" while "hooks are deterministic and guarantee the action happens", bloated CLAUDE.md files cause rules to be ignored, and a PreToolUse `deny` "blocks the tool even in `bypassPermissions` mode" ([best practices](https://code.claude.com/docs/en/best-practices), [hooks guide](https://code.claude.com/docs/en/hooks-guide)). **[evidenced]** A readability study of five frontier models found LLM code shows 24 redundant-comment instances per 500 samples against 3 for human code, and that prompt design helps but "its overall role remains bounded" ([Ye et al., 2026](https://arxiv.org/html/2605.13280v1)). The practical reading is that a prose rule sets the default and a deterministic check catches the residue; neither alone is enough. **[evidenced]**

## Both schools reject restating, and rot is measurable

The two camps in the comments debate agree on more than their reputations suggest. Robert Martin's hardest line is "Comments are always failures", yet he also writes "Nothing can be quite so helpful as a well placed comment"; Fowler and Beck call comments "a sweet smell" that "are often used as a deodorant" for bad code; Kevlin Henney's formulation is "Comment what the code cannot say, not simply what it does not say"; Google's Code Health guidance replaces a comment on `timeout` with the name `timeoutMillis` ([aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code), [Refactoring excerpt](https://www.informit.com/articles/article.aspx?p=2952392), [Henney, Overload 157](https://accu.org/journals/overload/28/157/henney_2796/), [Google Testing Blog](https://testing.googleblog.com/2017/07/code-health-to-comment-or-not-to-comment.html)). On the other side, John Ousterhout holds that "the cost of missing comments is easily 10-100x the cost of incorrect comments" and that interface comments are essential because "there is a lot of important information that simply cannot be expressed in code"; Google's Go guide requires doc comments on "All top-level, exported names"; Hillel Wayne argues even "what" comments can pay for themselves when they save a context switch ([aposd-vs-clean-code README](https://raw.githubusercontent.com/johnousterhout/aposd-vs-clean-code/main/README.md), [Go CodeReviewComments](https://go.dev/wiki/CodeReviewComments), [Wayne](https://hillelwayne.com/post/what-comments/)). The debate's recorded agreements are that "comments should not restate obvious code", that "some comments are necessary, particularly for public APIs", and that both accept references to external documentation when necessary; the recorded disagreements are the default trust level, density, and whether internal single-team interfaces need doc comments at all. **[evidenced]** Of PR #100's comments, the ~36 ADR-paraphrase JSDocs and the ~20 code-restating JSDocs fall into the category both camps reject; only Ousterhout would defend doc comments on internal exports, and even he wants them to "add precision or intuition", which `/** Epoch ms. */` does not.

The empirical record on rot is consistent across two decades of mining. Wen et al. analysed 1.3 billion AST-level changes across 1,500 Java systems and found that only "13% to 20% of code changes trigger a comment change", with comments referring to renamed identifiers the most frequent fixed inconsistency ([Wen et al., ICPC 2019](https://www.inf.usi.ch/faculty/lanza/PUBS/P/Wen2019a.pdf)). Ratol and Robillard found that "more than half of the total number of identifiers in the dataset had fragile comments after renaming" ([Fraco, ASE 2017](https://www.cs.mcgill.ca/~martin/papers/ase2017.pdf)). iComment extracted rules from comments in Linux, Mozilla, Wine and Apache and found 60 comment–code inconsistencies of which 33 were new bugs ([Tan et al., SOSP 2007](https://www.cs.purdue.edu/homes/lintan/publications/icomment_sosp07.pdf)); inconsistent comment/code changes are about 1.5 times more likely to sit in bug-introducing commits ([arXiv 2409.10781](https://arxiv.org/html/2409.10781v1)). Links in comments decay at a measured rate: of 9.6 million links in source comments across 25,925 repositories, 9.1% returned 404 and fewer than 10% had ever been revised ([Hata et al., ICSE 2019](https://ar5iv.arxiv.org/html/1901.07440)). Self-admitted technical debt comments are removed only 26.3%–63.5% of the time after introduction ([Potdar & Shihab, ICSME 2014](https://users.encs.concordia.ca/~eshihab/pubs/Potdar_ICSME2014.pdf)). For LLM-written comments the picture is worse: "roughly a fifth" of the best model's comments contained demonstrably inaccurate statements ([arXiv 2406.14836](https://arxiv.org/abs/2406.14836)), misleading comments degrade LLM code-reasoning accuracy by 21–33% because models "readily rationalize the plausible hint as authoritative" ([CodeCrash](https://arxiv.org/html/2504.14119)), and a 2026 preprint on spec-driven development reports models "frequently generate citations to specification requirements that either don't exist or misrepresent actual requirements" ([Citation Discipline, arXiv 2606.30689](https://arxiv.org/pdf/2606.30689); single-author, preliminary). **[evidenced]** In a codebase that is maintained and reviewed by LLM agents, a comment is therefore not just a maintenance cost but an input the next agent will over-trust; the MAX_DRAWS misattribution is a small live example.

One point cuts in the ADR comments' favour and must be stated honestly. An in-repo, numbered, never-edited ADR (Nygard: "If a decision is reversed, we will keep the old one around, but mark it as superseded") is structurally the safest target a comment can point at: no 404, no drift ([Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)). The Hata decay numbers are about external URLs, and no study measures rot of ADR references specifically. The case against the tags is not that they will break but that they are redundant with a channel that can be executed, and that no canonical ADR source recommends them: Nygard, adr.github.io, MADR, adr-tools (which links ADRs only to other ADRs via `adr link`), Log4brains (whose `@adr` code annotation is listed as unshipped "Coming soon"), AWS ("the reviewer asks the author of the code change to update the code, and shares a link to the ADR"), Microsoft, Google Cloud and Spotify are all silent on code-to-ADR references ([MADR template](https://raw.githubusercontent.com/adr/madr/develop/template/adr-template.md), [adr-tools](https://github.com/npryce/adr-tools), [Log4brains](https://github.com/thomvaill/log4brains), [AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)). The one vendor site that advocates bidirectional linking warns in the same breath: "Not every line needs an ADR reference. Overdo it and the signal disappears" ([archman.dev](https://archman.dev/docs/documentation-and-modeling/architecture-decision-records-adr/linking-to-code-and-docs)). MADR's optional "Confirmation" section is the sanctioned reverse direction: "Is there any automated or manual fitness function? If so, list it ... a test with a library such as ArchUnit can help validate this", and the template notes that "although we classify this element as optional, it is included in many ADRs" ([MADR](https://raw.githubusercontent.com/adr/madr/develop/template/adr-template.md)). **[evidenced]** Vercel's AI SDK ADR skill is the counter-example that instructs agents to add "one comment at the entry point, not on every line" ([vercel/ai adr-skill](https://github.com/vercel/ai/blob/main/skills/adr-skill/SKILL.md)); the sQVe/tau project went the other way in September 2026 and banned "comments that cite an ADR, ticket, PR, or review, or describe the code's history" because "almost any comment could be argued into one of" the permitted kinds ([sQVe/tau #165](https://github.com/sQVe/tau/pull/165)).

### A reconciled position for a TDD, small-commit, ADR-driven TypeScript codebase

The synthesis that follows is inference from the cited positions; no source states it in this form. **[inferred]** Assign each kind of information to the medium that cannot rot for it. Behaviour belongs in tests and types: with TDD the test is the executable contract, and Beck's point that "Passing tests are guaranteed to be in sync with the code" is the one documentation claim that is true by construction ([Beck](https://newsletter.kentbeck.com/p/the-documentation-tradeoff)). The reason for a cross-cutting decision belongs in the ADR, which in turn names what implements and confirms it. Provenance (which commit realised which decision) belongs in commit trailers, where the Linux kernel has kept `Fixes:` and `Link:` for years while insisting that the commit body be "understandable without external resources" ([kernel SubmittingPatches](https://www.kernel.org/doc/html/latest/process/submitting-patches.html)). A comment in a source file is reserved for the residue: a local fact that an edit which looks correct would break, stated in plain words without an identifier, which is Henney's "cannot say", McConnell's "level of intent", Google Python's "Never describe the code" and the second bullet of the user's own sdw policy. Wen et al.'s practitioner advice completes the design rule: write comments so they "will not require any future update", which means no identifiers in prose, no enumerated values, no pasted sentences ([Wen et al.](https://www.inf.usi.ch/faculty/lanza/PUBS/P/Wen2019a.pdf)). Ousterhout's objection that "Comments belong to the code, not the commit log" is answered by keeping the one-line "why" inline and moving only the citation to the trailer ([Lebrero's APoSD notes](https://danlebrero.com/2021/02/24/philosophy-of-software-design-summary/)). The user's instinct (expressive naming, patterns, TDD with very small commits, few comments) is therefore not an idiosyncrasy to defend; it is the position the two schools converge on once tests and ADRs exist, with one explicit carve-out for TSDoc on exports carrying what the type signature cannot (units, ordering, side effects, permanence).

## Build the channels first, then ban the comments, then enforce

Ordering matters: removing 816 tags from sdw, or the 46 from url-shortener, before the replacement channels exist would lose traceability. The sequence is (1) harvest existing tags into ADR-side "Implemented by" lists, (2) add test tags and the trailer convention, (3) replace the policy text, (4) add deterministic enforcement, (5) patch the review skill. Reliability follows Anthropic's own characterisation: PreToolUse deny (cannot be bypassed by permission mode) > ESLint/commitlint in a pre-commit hook or CI (deterministic, post hoc) > PostToolUse feedback (cannot block, but Claude self-corrects) > CLAUDE.md/AGENTS.md rule (advisory, degrades as context fills and after compaction) ([hooks guide](https://code.claude.com/docs/en/hooks-guide), [#19471](https://claudeissues.com/issue/19471-bug-claude-md-instructions-completely-ignored-after-context-compaction)). **[evidenced for the ordering; the specific texts below are proposals]**

| Priority | Change | Why first | Effort |
|---|---|---|---|
| 1 | ADR-side "Implemented by / Confirmation" sections, seeded by `git grep` of existing tags | Preserves the traceability the tags currently carry | 1–2 h per repo (scriptable) |
| 2 | Vitest tags per ADR + `describe`/`it` naming rule | Makes the decision executable and filterable | 1 h |
| 3 | Commit trailer `Implements:`/`Refs:` + commitlint | Durable provenance in the clone, queryable | 30 min |
| 4 | Replace `docs/agents/code-comments.md` (sdw) and add it to url-shortener; one AGENTS.md block | Removes the instruction that produces the tags | 30 min |
| 5 | PreToolUse hook + ESLint comment rule | Deterministic; catches what prose misses | 1 h |
| 6 | code-review brief edits (project-level) + upstream issue with PR #100 numbers | Makes the review verify citations and flag smells | 30 min + issue |
| 7 | ADR-named dependency-cruiser rules for structural ADRs | Fitness functions for the ADRs that are about boundaries | per ADR |

### 1. ADR-side "Implemented by / Confirmation" section

Seed the lists from the tags you already have. In sdw, `git grep -n 'ADR-0009' src tests` is a ready-made index of every module and test that currently cites the decision; in url-shortener, `git grep -nE 'ADR 0009|ADRs [0-9, ]*0009'` does the same. Paste the paths (names, not links, per matklad: "Do _not_ directly link them (links go stale)") into the ADR before deleting the tags ([matklad, ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html)). Proposed section, appended to each ADR after Consequences:

```markdown
## Implemented by

- `packages/core/src/encoding.ts` (`keyedCandidate`), `packages/core/src/create-link.ts` (`MAX_DRAWS`)
- Tests: `vitest --tags-filter=adr-0009` (`packages/core/test/encoding.test.ts` "keyedCandidate",
  `packages/core/test/create-link.test.ts` "gives up after 8 candidates")
- Commits: `git log --grep='Implements: ADR-0009'`

## Confirmation

- The pinned vectors in the "keyedCandidate" suite fail if the derivation, digit order or padding changes.
- "gives up after 8 candidates" pins the retry budget; changing the constant without amending this ADR fails the suite.
- Review: a change to the base62 digit order or the candidate count needs an amendment to this ADR in the same PR
  (CONTRIBUTING.md, "A change that contradicts one needs a new ADR, or an amendment").
```

The "Confirmation" wording follows MADR's definition verbatim in spirit ("how the implementation / compliance of the ADR can/will be confirmed"), so a reader familiar with MADR knows what the section is for ([MADR](https://raw.githubusercontent.com/adr/madr/develop/template/adr-template.md)).

### 2. Test naming and tagging convention

Vitest 4.1+ has config-validated tags: "If a test uses a tag that isn't defined in the config, the test runner will throw an error", tags are inherited by nested suites, and `vitest --tags-filter=adr-0009` or `--list-tags` query them ([Vitest test tags](https://vitest.dev/guide/test-tags)). That makes the tag definitions themselves a tiny decision index and makes a wrong ADR number a test-run failure, which no comment can offer.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    tags: [
      { name: "adr-0002", description: "Random Short codes claimed by conditional insert" },
      { name: "adr-0008", description: "Link data model: shards, KV, Creator lists, backups" },
      { name: "adr-0009", description: "Idempotent Link creation by key-derived Short codes" },
      { name: "adr-0014", description: "Link identity carries an opaque Namespace" },
      { name: "adr-0018", description: "Hash the case-folded Short code" },
      { name: "adr-0019", description: "Links are immutable; deletion erases the Target URL" },
      { name: "adr-0028", description: "Void a forged or mistaken delete; never lose a delete in a restore" },
    ],
  },
});
```

```ts
// packages/core/test/encoding.test.ts
describe("keyedCandidate", { tags: ["adr-0009"] }, () => {
  it("derives candidate n from SHA-256 over creatorId:key:n, first 8 bytes big-endian mod 62^7, zero-padded to 7", () => { /* ... */ });
  it("encodes with digit order 0-9, A-Z, a-z", () => { /* ... */ });
});

describe("createLink", { tags: ["adr-0002", "adr-0009"] }, () => {
  it("gives up after 8 candidates and reports exhaustion", () => { /* ... */ });
});
```

Naming rule for the policy file: `describe` names the exported symbol or the domain concept from `CONTEXT.md`; `it` states the behaviour as a plain sentence a spec reader would recognise, with the number or rule in it; the ADR lives only in the tag. On a Vitest older than 4.1, put the ADR in the `describe` string instead (`describe("keyedCandidate (ADR-0009)")`) so `vitest -t adr-0009` still selects it. Either way the `// Pinned test vectors ... (ADRs 0008, 0009, 0014, 0018, 0019, 0028)` banner in `encoding.test.ts` becomes redundant and goes.

### 3. Commit trailer convention and commitlint

Git trailers are first-class: `git commit --trailer 'Implements: ADR-0009'` adds one, `git log --format='%h %(trailers:key=Implements,valueonly)'` extracts them, and Conventional Commits footers are "inspired by the git trailer convention" ([git-interpret-trailers](https://git-scm.com/docs/git-interpret-trailers), [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)). The convention, for the small-commit TDD style:

```text
feat(core): derive keyed candidates from SHA-256 over creatorId:key:n

The first 8 bytes big-endian mod 62^7, base62 with digit order 0-9, A-Z, a-z,
zero-padded to 7. Pinned by test vectors; the order is permanent because
existing keyed Links were derived with it.

Implements: ADR-0009
Refs: #94
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Rules: one `Implements:` trailer per ADR the commit realises or amends (omit on commits that touch no decision, so a red-green-refactor triple is not three identical trailers); `Refs:` for the issue; the body stays "understandable without external resources" per the kernel rule. Lookup later is `git log --grep='Implements: ADR-0009'` or `git blame` a line then `git show`. The commitlint sketch, using the documented `references-empty` rule and `issuePrefixes` option ([commitlint rules](https://commitlint.js.org/reference/rules.html), [commitlint configuration](https://commitlint.js.org/reference/configuration.html)):

```js
// commitlint.config.cjs
module.exports = {
  extends: ["@commitlint/config-conventional"],
  parserPreset: { parserOpts: { issuePrefixes: ["#", "ADR-"] } },
  rules: {
    "footer-leading-blank": [2, "always"],
    // Warn (1) rather than error so a pure refactor commit need not cite anything;
    // raise to 2 if you want every commit to name an issue or ADR.
    "references-empty": [1, "never"],
    // Uncomment to require the trailer on every commit:
    // "trailer-exists": [2, "always", "Implements:"],
  },
};
```

```json
// package.json (simple-git-hooks; husky equivalent is .husky/commit-msg)
{
  "simple-git-hooks": { "commit-msg": "npx --no -- commitlint --edit \"$1\"" }
}
```

### 4. The comment policy, as a path-scoped rule and an AGENTS.md block

This replaces sdw's `docs/agents/code-comments.md` and is added to url-shortener. It keeps the parts of the existing policy both schools endorse (second, third and fifth bullets), deletes the one bullet that produces the tags, replaces the 40% ceiling with a smell threshold near the PR #99 baseline, and is phrased positively with pass/fail examples taken from PR #100, following Anthropic's "specific over vague" guidance and the plugin's own warning about prohibition ([best practices](https://code.claude.com/docs/en/best-practices)). Use `.claude/rules/comments.md` with `paths:` frontmatter so it re-triggers on every Edit/Write of a matching file, which also sidesteps the compaction decay reported for CLAUDE.md ([memory docs](https://code.claude.com/docs/en/memory)). **[proposal]**

```markdown
---
paths:
  - "packages/**/*.ts"
  - "workers/**/*.ts"
  - "tools/**/*.ts"
---
# Code comments

Names and types carry what the code does. Tests carry the contract. Commit trailers carry which decision a change
realises. ADRs carry why. A comment is the last resort, for what none of those can hold.

## Where a reference to an ADR, issue, ticket or spec belongs

- Commit trailer: `Implements: ADR-0009`, `Refs: #94`.
- Test tag or name: `describe("keyedCandidate", { tags: ["adr-0009"] })`.
- Architecture rule name: `adr-0001-core-imports-no-cloudflare` in `.dependency-cruiser.js` or ESLint.
- The ADR's own `Implemented by` list.
- A TSDoc `@see docs/adr/0009-...md` on an exported symbol, only when no test confirms the constraint.

Source files contain no ADR, issue, ticket, PR or spec identifiers outside those places.

## What a source-file comment may say

Write one only where an edit that looks correct would break something the code cannot show: a permanent encoding,
an invariant, a workaround, a surprising constant. One line, plain words, no identifier. These pass:

- `// 248 is the largest multiple of 62 a byte holds; a higher byte would skew the draw.`
- `// Permanent: every stored Link was written under this encoding. Changing it means moving every Link.`

These fail; rename, extract, or move the sentence to the ADR, the test name or the commit:

- `/** Epoch ms. */` on `readonly createdAt: number` (name it `createdAtMs`).
- `/** Shard n's Durable Object name, with n in decimal (ADR 0008). */` on a one-line function
  (the name and the pinned vector already say it).
- A file banner listing the ADRs the file implements.
- Any sentence that also exists in an ADR, CONTEXT.md, the issue, or the PR body.

## TSDoc on exports

One to three lines, only what the signature cannot express: units, ordering, side effects, error modes, permanence.
Omit it when the name and types say it all.

## Smell threshold

Comment lines stay under 10% of a `src` module's lines. Above that, rename, extract or move prose to the ADR.
```

For `AGENTS.md` (url-shortener has no CLAUDE.md), the pointer block in the plugin's house style:

```markdown
### Code comments

Source files carry no ADR, issue or spec identifiers. Decisions are traced through commit trailers
(`Implements: ADR-NNNN`), test tags, architecture rule names and each ADR's `Implemented by` list.
See `docs/agents/code-comments.md`.
```

Also change one line in `docs/agents/domain.md` so the only worked example of an ADR reference is not a bare tag: after "Flag ADR conflicts", add "Reference an ADR in the issue, the PR body or a commit trailer, never in a code comment."

### 5. Claude Code hook and ESLint rule

The hook uses the documented PreToolUse contract: `tool_input.file_path`, `tool_input.new_string` (Edit) or `tool_input.content` (Write), exit 2 to block with stderr shown to Claude, matcher `Edit|Write`; it fires "before any permission-mode check, in every permission mode" ([hooks reference](https://code.claude.com/docs/en/hooks), [hooks guide](https://code.claude.com/docs/en/hooks-guide)). It is derived from the official "protect-files" example, not copied from a published ADR-comment hook, since none was found. **[proposal]**

```bash
#!/usr/bin/env bash
# .claude/hooks/no-reference-comments.sh
# PreToolUse on Edit|Write: refuse a source edit that puts an ADR/issue/spec id inside a comment.
set -euo pipefail
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
added=$(jq -r '.tool_input.new_string // .tool_input.content // empty' <<<"$input")
[ -z "$file" ] || [ -z "$added" ] && exit 0

# Only implementation files; docs, tests and tool configs are where references belong.
case "$file" in
  *.md|*/docs/*|*.test.ts|*.spec.ts|*/test/*|*/tests/*|*vitest.config.*|*.dependency-cruiser.*|*eslint.config.*|*commitlint.config.*) exit 0 ;;
  *.ts|*.tsx|*.js|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

# A comment line (// , /* , * ) carrying "ADR 0008", "ADR-0008", "(#94)", "slice 1.2" or "PROJ-12".
pattern='^[[:space:]]*(//|/\*+|\*)[^"]*(ADR[- ]?[0-9]{3,4}|\(#[0-9]+\)|slice [0-9]+\.[0-9]+|[A-Z]{2,}-[0-9]+)'
if hits=$(grep -nE "$pattern" <<<"$added" | grep -vE 'TODO\(#[0-9]+\)'); then
  {
    echo "Blocked: $file would gain a decision/ticket reference inside a comment:"
    echo "$hits" | head -5
    echo "Put the reference in the commit trailer (Implements: ADR-NNNN), the test tag, the ADR's Implemented-by list,"
    echo "or an architecture rule name. If a comment is needed, state the constraint in one plain line without the id."
  } >&2
  exit 2
fi
exit 0
```

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/no-reference-comments.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | grep -E '\\.(ts|tsx)$' | xargs -r npx eslint --max-warnings 0" }]
      }
    ]
  }
}
```

The PostToolUse line closes the gaps the PreToolUse hook has (files written through Bash or MultiEdit) by running ESLint with a custom rule. ESLint's AST selectors cannot target comments, so the rule iterates `sourceCode.getAllComments()`, which is the documented path ([ESLint custom rules](https://eslint.org/docs/latest/extend/custom-rules)):

```js
// eslint/no-reference-comments.js
export default {
  meta: {
    type: "suggestion",
    messages: { ref: "Decision/ticket reference in a comment ({{id}}). Trace it through a commit trailer, a test tag or the ADR's Implemented-by list instead." },
  },
  create(context) {
    const re = /\bADR[- ]?\d{3,4}\b|\(#\d+\)|\bslice \d+\.\d+\b|\b[A-Z]{2,}-\d+\b/;
    return {
      Program() {
        for (const c of context.sourceCode.getAllComments()) {
          if (/TODO\(#\d+\)/.test(c.value)) continue;
          const m = re.exec(c.value);
          if (m) context.report({ loc: c.loc, messageId: "ref", data: { id: m[0] } });
        }
      },
    };
  },
};
```

```js
// eslint.config.js (flat config), scoped to implementation files only
import noReferenceComments from "./eslint/no-reference-comments.js";
export default [
  {
    files: ["packages/*/src/**/*.ts", "workers/*/src/**/*.ts", "tools/**/*.ts"],
    plugins: { local: { rules: { "no-reference-comments": noReferenceComments } } },
    rules: { "local/no-reference-comments": "error" },
  },
];
```

The same ESLint invocation in the pre-commit hook or CI makes the rule hold for human commits too. The `TODO(#123)` exemption follows Deno's convention and Google's rule that a TODO must carry a tracked reference, which the SATD removal rates justify ([Deno style guide](https://docs.deno.com/runtime/contributing/style_guide/), [Google Python style guide](https://raw.githubusercontent.com/google/styleguide/gh-pages/pyguide.md)).

### 6. The code-review skill: verify citations, flag comment smells

The plugin's `code-review` skill reads standards from "Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`" (line 36), so the new `docs/agents/code-comments.md` becomes a cited standard automatically once it exists; but the two sub-agent briefs still need a criterion. The following edits can be made in a project-level override of the skill (or a fork) and proposed upstream in an issue that leads with PR #100's numbers, since Matt's bar is a failure "seen in a real session". **[proposal]**

Standards brief (currently line 64, "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot"), add:

```markdown
(c) Comment hygiene. For every added comment in a non-test source file, report it if it (i) repeats a sentence
that exists in an ADR, CONTEXT.md, the issue, or the PR body; (ii) restates the name, type or signature beneath
it; or (iii) contains an ADR, issue, ticket, PR or spec identifier. For each, name the channel that already
carries the information (test name/tag, commit trailer, the ADR) or say "delete".
```

And add to the baseline smell list (lines 45–56), using Fowler's own name:

```markdown
- **Comments**: a comment used as deodorant for an unclear name, or a copy of a sentence that lives in a doc.
  The fix is a rename, an extraction or a deletion, not a better comment.
```

Spec brief (currently line 70, ending "Quote the spec line for each finding. Under 400 words."), add:

```markdown
(d) Citation check. For every ADR or spec identifier that appears anywhere in the diff, the commit messages or
the PR body, open the cited document and confirm it states the constraint attributed to it. Report any citation
whose document does not contain the attributed claim, and name the document that does. A constant or rule whose
cited ADR gives no value for it is a finding.
```

That last sentence is written to catch exactly the `MAX_DRAWS = 8` / ADR 0002 case. One line is also worth adding to `implement/SKILL.md`, which currently says nothing about the shape of the diff: "Decisions show up in names, test tags and commit trailers; a comment states only what an editor must know to avoid breaking something, in plain words."

### 7. ADR-named architecture rules for the structural decisions

For ADRs that are about boundaries rather than values (ADR 0001's plain-Node core with Cloudflare behind ports is the obvious one), the decision can be a fitness function instead of a banner comment on `ports.ts`. dependency-cruiser rules carry a `name` that "appears in reporter output to help identify violated rules" and a `comment` field meant "to document why the rule is there", and `severity: error` fails CI ([dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)); the PR already has a `.dependency-cruiser.js` with a no-cycles rule, so this is an addition, not new tooling. Illustrative, since ADR 0001's exact text was not read:

```js
// .dependency-cruiser.js, forbidden:
{
  name: "adr-0001-core-imports-no-cloudflare",
  comment: "The core runs under plain Node; Cloudflare enters through ports implemented by the Workers. See docs/adr/0001-*.md.",
  severity: "error",
  from: { path: "^packages/core/src" },
  to: { path: "^(workers/|node_modules/@cloudflare)" },
}
```

A failure then reads `error adr-0001-core-imports-no-cloudflare: packages/core/src/x.ts → workers/...`, which tells the reader which ADR to open, and the ADR's Confirmation section names the rule. ArchUnitTS offers the same for Vitest if a test file per ADR is preferred ([ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS)).

## Conclusion

The sharpest finding is that the user's two repos sit at opposite ends of the same mechanism: url-shortener has no comment policy and got ADR paraphrase on half its exports because the surrounding texts (CONTRIBUTING, domain.md, the ticket, the ADRs' own prose, five "respect ADRs" lines, a Spec review that quotes) all point toward citation and nothing points away; speech-dataset-workbench has a policy whose first bullet literally instructs the tag and now carries 816 of them. In both, the agent did what the environment rewarded, and the code-review stage, the only place the loop allows refactoring, has no criterion under which a redundant or misattributed comment is a finding. The MAX_DRAWS attribution shows the cost is not hypothetical: a citation that nobody verifies is a pointer that drifts, and the next LLM to read the file will trust it.

The principled position the user can state is short: tests carry behaviour, trailers carry provenance, ADRs carry why and name what confirms them, and a source comment carries only the one-line local fact an editor needs, in plain words. That position is where Martin, Fowler, Henney, Ousterhout and Google's guides overlap once an executable test suite and an in-repo decision log exist, and it is what the ADR tooling community already practises by never recommending code-to-ADR citations. Implementing it is mostly plumbing that fits the existing stack (Vitest tags, git trailers, dependency-cruiser, Claude Code hooks), with the one non-obvious step being to migrate the existing tags into ADR-side lists before deleting them, so that the traceability the comments were carrying moves rather than disappears.
