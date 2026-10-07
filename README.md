# claude-plugins

Claude Code plugins for agentic TDD: guardrails that keep generated code honest, and review loops that make a second model argue with the first.

## Install

Add the marketplace once, then install only the plugins you want:

```
/plugin marketplace add andrewferk/claude-plugins
/plugin install comment-guard@andrewferk
/plugin install adversarial-code-review@andrewferk
```

## Plugins

| Plugin | What it does | Where it lives |
|---|---|---|
| [comment-guard](./plugins/comment-guard) | Stops LLM-written code from filling up with comments that restate the code, narrate steps, or cite ADRs and tickets. The policy arrives by hook the first time a session touches a source file, tightens when a [mattpocock skill](https://github.com/mattpocock/skills) starts, and is enforced on every edit and before the agent stops. | this repository |
| [adversarial-code-review](https://github.com/andrewferk/adversarial-code-review) | After `/implement`, a reviewer on a different model challenges the draft PR through the Cursor CLI, the implementer argues back in PR comments, and the PR is marked ready only once both agree. | its own repository, listed here |

Every plugin is independent. Installing one never installs or configures another.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for the layout and the rules a change has to meet. Each plugin's README documents its own behaviour and tuning.

## Licence

MIT. Test fixtures copied from other projects keep their own licence, noted beside them.
