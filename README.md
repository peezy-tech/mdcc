# mdcsp

`mdcsp` composes Markdown context files from reusable snippets. It can generate
`AGENTS.md`, `CLAUDE.md`, or any other Markdown file, and it is available as both
a JavaScript library and a command-line tool.

Snippets may include TOML front matter that selects them according to commands
available on `PATH`:

```markdown
+++
description = "Use Jaeger when its CLI is installed"
requires = ["jaeger"]
excludes = ["incompatible-runner"]
+++
## Jaeger

Use Jaeger for durable workflow execution.
```

`requires` selects the snippet only when every named command is available.
`excludes` omits it when any named command is available. Snippet bodies are
joined in profile order with one blank line between them.

## Library

```js
import { composeFiles } from "mdcsp"

const result = await composeFiles({
  paths: ["./snippets/common.md", "./snippets/jaeger.md"],
  header: ({ digest }) =>
    `<!-- Generated context. Content: sha256:${digest.slice(0, 12)} -->`,
})

process.stdout.write(result.content)
console.log(result.decisions)
```

For callers that already hold snippet content, use `compose`:

```js
import { compose } from "mdcsp"

const result = compose({
  snippets: [
    { source: "common", content: "# Common instructions\n" },
  ],
  commandAvailable: command => command === "codex",
})
```

The library also exports `parseSnippet`, `commandAvailableOnPath`, profile
loading helpers, and atomic output helpers. Composition itself does not write
files or assume a particular harness.

## CLI

Install the package, then create this layout:

```text
~/.config/mdcsp/
├── profiles/
│   └── default.toml
└── snippets/
    ├── common.md
    └── jaeger.md
```

`profiles/default.toml` contains an ordered list of snippet names:

```toml
version = 1
name = "default"
snippets = ["common", "jaeger"]
```

Render, inspect, or check the result:

```bash
mdcsp list profiles
mdcsp list snippets
mdcsp explain default
mdcsp profile show default
mdcsp profile add default jaeger
mdcsp profile remove default jaeger
mdcsp render default --stdout
mdcsp render default --target ~/.codex/AGENTS.md
mdcsp check default --target ~/.codex/AGENTS.md
```

`profile add` and `profile remove` update the profile atomically and immediately
regenerate the default `~/.codex/AGENTS.md` target. Pass `--target FILE` to
choose another generated file. The profile name may be omitted to use `default`:

```bash
mdcsp profile add jaeger --target ~/.codex/AGENTS.md
mdcsp profile remove jaeger --target ~/.codex/AGENTS.md
```

`profile show` reports the ordered snippet membership without changing either
file. Use `--json` with profile commands for machine-readable output.

The default root is `$MDCSP_HOME`, then `$XDG_CONFIG_HOME/mdcsp`, then
`~/.config/mdcsp`. The default profile is `default`, and the default output is
`~/.codex/AGENTS.md`. Use `--root`, `--file`, or `--target` for explicit paths.
`render` writes atomically and preserves an existing target's file mode.

## Security boundary

`mdcsp` treats Markdown as data and never executes snippet bodies. Command
conditions perform direct executable-file checks against `PATH`; they do not
invoke a shell. Named CLI profiles can reference only simple snippet names
inside the configured `snippets/` directory, and resolved paths cannot escape
that directory.

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
```

The verifier type-checks and tests the source, builds it, packs the npm artifact,
installs that artifact into a temporary project, and exercises both the library
and the installed `mdcsp` command.
