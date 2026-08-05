import assert from "node:assert/strict"
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { outputIsCurrent, writeOutput } from "../src/output.js"

test("writeOutput writes atomically and preserves an existing mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdcc-output-"))
  try {
    const target = path.join(root, "nested", "AGENTS.md")
    assert.equal(await outputIsCurrent(target, "first\n"), false)
    await writeOutput(target, "first\n")
    assert.equal(await outputIsCurrent(target, "first\n"), true)
    await chmod(target, 0o640)
    await writeOutput(target, "second\n")
    assert.equal(await readFile(target, "utf8"), "second\n")
    if (process.platform !== "win32") assert.equal((await lstat(target)).mode & 0o777, 0o640)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("writeOutput refuses a symlink target", {
  skip: process.platform === "win32" ? "file symlink creation requires elevated Windows privileges" : false,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdcc-output-link-"))
  try {
    const actual = path.join(root, "actual.md")
    const target = path.join(root, "target.md")
    await writeFile(actual, "original\n")
    await symlink(actual, target)
    await assert.rejects(writeOutput(target, "replacement\n"), /regular file/)
    assert.equal(await readFile(actual, "utf8"), "original\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
