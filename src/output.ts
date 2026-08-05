import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

export async function outputIsCurrent(target: string, content: string): Promise<boolean> {
  try {
    return (await readFile(target, "utf8")) === content
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false
    throw error
  }
}

export async function writeOutput(target: string, content: string): Promise<void> {
  const resolved = path.resolve(target)
  await mkdir(path.dirname(resolved), { recursive: true })
  let mode = 0o600
  try {
    const existing = await lstat(resolved)
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`Output target must be a regular file: ${resolved}`)
    }
    mode = existing.mode & 0o777
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error
  }
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.mdcc-${randomUUID()}`)
  const handle = await open(temporary, "wx", mode)
  try {
    await handle.writeFile(content, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(temporary, mode)
  await rename(temporary, resolved)
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}
