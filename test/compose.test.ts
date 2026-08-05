import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { commandAvailableOnPath, compose, composeFiles, parseSnippet } from "../src/compose.js"

test("compose selects snippets, preserves order, and reports decisions", () => {
  const result = compose({
    snippets: [
      { source: "always.md", content: "# Always\n" },
      {
        source: "selected.md",
        content: `+++
description = "Available capability"
requires = ["present"]
+++
# Selected
`,
      },
      {
        source: "missing.md",
        content: `+++
requires = ["missing"]
+++
# Missing
`,
      },
      {
        source: "excluded.md",
        content: `+++
excludes = ["present"]
+++
# Excluded
`,
      },
    ],
    commandAvailable: command => command === "present",
    header: ({ digest }) => `<!-- ${digest.slice(0, 12)} -->`,
  })

  assert.match(result.content, /^<!-- [a-f0-9]{12} -->\n\n# Always\n\n# Selected\n$/)
  assert.equal(result.digest.length, 64)
  assert.deepEqual(
    result.decisions.map(({ source, selected, reason, description }) => ({ source, selected, reason, description })),
    [
      { source: "always.md", selected: true, reason: "selected", description: undefined },
      { source: "selected.md", selected: true, reason: "selected", description: "Available capability" },
      { source: "missing.md", selected: false, reason: "missing commands: missing", description: undefined },
      { source: "excluded.md", selected: false, reason: "excluded commands present: present", description: undefined },
    ],
  )
})

test("compose is deterministic and supports empty selections", () => {
  const options = {
    snippets: [{ source: "empty.md", content: "\n" }],
    header: ({ digest }: { readonly digest: string }) => `<!-- ${digest} -->`,
  }
  assert.deepEqual(compose(options), compose(options))
  assert.match(compose(options).content, /^<!-- [a-f0-9]{64} -->\n$/)
})

test("parseSnippet accepts CRLF front matter", () => {
  const parsed = parseSnippet({
    source: "windows.md",
    content: "+++\r\ndescription = \"Windows\"\r\nrequires = [\"cmd\"]\r\n+++\r\n# Body\r\n",
  })
  assert.equal(parsed.description, "Windows")
  assert.deepEqual(parsed.requires, ["cmd"])
  assert.equal(parsed.body, "# Body")
})

test("parseSnippet rejects malformed and unknown metadata", () => {
  assert.throws(
    () => parseSnippet({ source: "open.md", content: "+++\nrequires = []\n" }),
    /Unterminated TOML front matter/,
  )
  assert.throws(
    () => parseSnippet({ source: "unknown.md", content: "+++\npriority = 1\n+++\n# Body\n" }),
    /Unknown front matter.*field: priority/,
  )
  assert.throws(
    () => parseSnippet({ source: "command.md", content: "+++\nrequires = [\"bad command\"]\n+++\n" }),
    /Invalid command name/,
  )
})

test("composeFiles reads source files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdcsp-compose-"))
  try {
    const first = path.join(root, "first.md")
    const second = path.join(root, "second.md")
    await Promise.all([
      writeFile(first, "# First\n"),
      writeFile(second, "# Second\n"),
    ])
    const result = await composeFiles({ paths: [first, second] })
    assert.equal(result.content, "# First\n\n# Second\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("commandAvailableOnPath checks executable regular files without a shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdcsp-path-"))
  try {
    await mkdir(path.join(root, "directory-command"))
    const executable = path.join(root, process.platform === "win32" ? "available.cmd" : "available")
    await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 })
    assert.equal(commandAvailableOnPath("available", { PATH: root, PATHEXT: ".COM;.EXE;.BAT;.CMD" }), true)
    assert.equal(commandAvailableOnPath("directory-command", { PATH: root }), false)
    assert.equal(commandAvailableOnPath("missing", { PATH: root }), false)
    assert.throws(() => commandAvailableOnPath("bad command", { PATH: root }), /Invalid command name/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
