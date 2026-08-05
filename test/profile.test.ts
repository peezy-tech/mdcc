import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { defaultConfigRoot, listProfiles, listSnippets, loadProfile } from "../src/profile.js"

test("profiles resolve ordered snippets and list valid entries", async () => {
  await withRoot(async root => {
    await mkdir(path.join(root, "profiles"), { recursive: true })
    await mkdir(path.join(root, "snippets"), { recursive: true })
    await writeFile(path.join(root, "profiles", "default.toml"), 'version = 1\nname = "default"\nsnippets = ["common", "jaeger"]\n')
    await writeFile(path.join(root, "profiles", "invalid name.toml"), "snippets = []\n")
    await writeFile(path.join(root, "snippets", "common.md"), "# Common\n")
    await writeFile(path.join(root, "snippets", "jaeger.md"), "# Jaeger\n")
    assert.deepEqual(await listProfiles(root), ["default"])
    assert.deepEqual(await listSnippets(root), ["common", "jaeger"])
    const profile = await loadProfile(root, "default")
    assert.equal(profile.profilePath, path.join(root, "profiles", "default.toml"))
    assert.deepEqual(profile.snippetPaths, [
      await realpath(path.join(root, "snippets", "common.md")),
      await realpath(path.join(root, "snippets", "jaeger.md")),
    ])
  })
})

test("profiles reject traversal, duplicates, and escaping symlinks", {
  skip: process.platform === "win32" ? "file symlink creation requires elevated Windows privileges" : false,
}, async () => {
  await withRoot(async root => {
    await mkdir(path.join(root, "profiles"), { recursive: true })
    await mkdir(path.join(root, "snippets"), { recursive: true })
    const outside = path.join(root, "outside.md")
    await writeFile(outside, "# Outside\n")
    await symlink(outside, path.join(root, "snippets", "escape.md"))
    await writeFile(path.join(root, "profiles", "escape.toml"), 'snippets = ["escape"]\n')
    await assert.rejects(loadProfile(root, "escape"), /outside the snippet directory/)

    await writeFile(path.join(root, "profiles", "duplicate.toml"), 'snippets = ["same", "same"]\n')
    await assert.rejects(loadProfile(root, "duplicate"), /duplicate snippet/)

    await writeFile(path.join(root, "profiles", "traversal.toml"), 'snippets = ["../outside"]\n')
    await assert.rejects(loadProfile(root, "traversal"), /Invalid snippet name/)
  })
})

test("defaultConfigRoot honors MDCSP_HOME before XDG_CONFIG_HOME", () => {
  assert.equal(
    defaultConfigRoot({ MDCSP_HOME: path.join(os.tmpdir(), "custom"), XDG_CONFIG_HOME: path.join(os.tmpdir(), "xdg") }),
    path.resolve(os.tmpdir(), "custom"),
  )
  assert.equal(
    defaultConfigRoot({ XDG_CONFIG_HOME: path.join(os.tmpdir(), "xdg") }),
    path.resolve(os.tmpdir(), "xdg", "mdcsp"),
  )
})

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdcsp-profile-"))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
