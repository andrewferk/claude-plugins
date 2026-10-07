# Code comments

Code explains itself through names, types, small functions, and tests. A comment is the last resort, written only when none of those can carry the fact. A hook checks every file you edit and the whole branch before you stop; it blocks on the patterns below and on any file where more than 10% of non-blank lines are comments.

## Before writing a comment, do one of these instead

1. **Rename.** If the comment says what a thing is or does, put that in the identifier and write no comment.
2. **Extract.** If the comment labels a section of a function, extract the section into a function named after the label.
3. **Type.** If the comment states a constraint (unit, range, nullability, ordering), express it as a type, a branded type, or a parsed value object.
4. **Test.** If the comment states a behaviour or a rule, the test name states it. The test is the documentation and it cannot go stale.
5. **Commit.** If the comment explains what changed or why this change was made, that sentence is the commit message.
6. **Decision record.** If the comment paraphrases or cites an ADR, spec, ticket, issue, PR, or review, write no comment. The record already holds the reasoning. The link lives in the commit trailer (`Implements: ADR-0009`, `Refs: #94`) and in the ADR's own "Implemented by" list, never in source.

Only when all six fail, write one short comment that states a non-obvious **why**: a hidden constraint, a surprising consequence, a workaround for a specific defect in a dependency, a trade-off the code's shape does not reveal. State the fact; do not name the document it came from.

## Never write

- A comment that restates the code or the name: `/** Epoch ms. */ type EpochMs`
- A comment that cites a document: `// per ADR 0008`, `// as required by spec 3.2`, `// (#94)`
- Narration or a changelog: `// Now validate the input`, `// Added to support retries`
- A section banner: `// ---- Helpers ----`
- Commented-out code
- A doc comment that repeats the signature. TSDoc or a docstring on an export is for what the type cannot say: units, invariants, error modes, one line each.
- A comment in a test file that duplicates the test name or the source file's comment.

## Examples from a real diff

| Written | Policy |
|---|---|
| `/** A generated Short code is always exactly 7 base62 characters (ADR 0002). */ export const GENERATED_LENGTH = 7;` | Delete. The ADR holds the rule; the test "a generated Short code is 7 base62 characters" proves it. |
| `/** How many generated Short codes a create draws before giving up (ADR 0002's small, bounded retry budget). */ const MAX_DRAWS = 8;` | Delete. It also mis-cites: the number comes from another ADR. The name `MAX_DRAWS` carries it. |
| `// The reserved list is rejected case-insensitively (ADRs 0002, 0018).` above an `it.each` | Delete. Put it in the test name: `refuses a reserved word in any case`. |
| `// 248 is the largest multiple of 62 a byte holds; a higher byte would skew the draw.` | Keep. A non-obvious why that no name or type can carry. |
| `// A delete outranks a live record; of two deletes, the later wins, so the result doesn't depend on arrival order.` | Keep, or make it the test name for `outranks`. |

## Where traceability lives instead

- **Commit message trailers:** `Implements: ADR-0009` and `Refs: #94` on the commit that does the work. `git log --grep=ADR-0009` finds every implementing commit.
- **Test names:** describe the rule in words. A test that asserts an ADR's constraint is the executable link to it.
- **The ADR itself:** an "Implemented by" section naming the modules and tests that satisfy it. Links point from the decision to the code, not from the code to the decision.
- **Architecture rules:** a structural decision becomes a named dependency-cruiser or ESLint rule, so a violation fails the build and the rule's name cites the ADR.

## In the TDD loop

The refactor step of each red-green-refactor cycle includes deleting the comments the green step left behind. Rename or extract instead. A commit that adds a restating or document-citing comment is a defect in the diff, not a style preference.
