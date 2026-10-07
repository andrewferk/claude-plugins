# claude-plugins

A multi-plugin Claude Code marketplace. Each plugin is its own directory under `plugins/` and installs on its own; the marketplace is the only thing shared.

## Layout

- `.claude-plugin/marketplace.json` lists every plugin. A plugin that lives here uses a relative source (`./plugins/<name>`); a plugin kept in its own repository uses a `github` source.
- `plugins/<name>/.claude-plugin/plugin.json` is that plugin's manifest; its components (`hooks/`, `skills/`, `agents/`, `commands/`) sit beside it at the plugin root, never inside `.claude-plugin/`.
- `plugins/<name>/README.md` is that plugin's user-facing page. The root `README.md` only lists plugins and links to them.
- `plugins/<name>/test/` holds its tests, run by `npm test` inside the plugin directory. A plugin with a `test` script is picked up by CI automatically.

## Rules

- Run `claude plugin validate . --strict` at the root after touching any manifest. It checks the marketplace and every listed plugin.
- Each plugin keeps its own `version` in its `plugin.json`. Tag releases as `<plugin>-v<version>`.
- This repository runs under comment-guard's own scanner in CI. Code here follows that policy: names, types, tests, and commit messages carry the facts; a comment is the last resort for a non-obvious why.
- Commits are small, written in the imperative, and carry trailers (`Refs: #NN`) rather than inline citations.
- Hooks live only in a plugin's `hooks/hooks.json`. Nothing here edits a user's `settings.json`.
