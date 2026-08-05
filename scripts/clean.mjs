import { rm } from "node:fs/promises"
import path from "node:path"

for (const value of process.argv.slice(2)) {
  const target = path.resolve(value)
  const relation = path.relative(process.cwd(), target)
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Refusing to clean outside the project: ${value}`)
  }
  await rm(target, { recursive: true, force: true })
}
