import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"

const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/
const SNIPPET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface ProfilePaths {
  readonly root: string
  readonly profilePath: string
  readonly snippetPaths: readonly string[]
}

export interface ProfileDefinition {
  readonly version?: 1
  readonly name?: string
  readonly snippets: readonly string[]
}

export interface LoadedProfile extends ProfilePaths {
  readonly source: string
  readonly definition: ProfileDefinition
}

export function defaultConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MDCSP_HOME) return path.resolve(expandHome(env.MDCSP_HOME))
  const config = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.resolve(config, "mdcsp")
}

export async function listProfiles(root: string): Promise<readonly string[]> {
  return await listStems(path.join(root, "profiles"), ".toml", PROFILE_NAME)
}

export async function listSnippets(root: string): Promise<readonly string[]> {
  return await listStems(path.join(root, "snippets"), ".md", SNIPPET_NAME)
}

export async function loadProfile(
  root: string,
  name: string,
  explicitProfile?: string,
): Promise<ProfilePaths> {
  const profile = await loadProfileDocument(root, name, explicitProfile)
  return {
    root: profile.root,
    profilePath: profile.profilePath,
    snippetPaths: profile.snippetPaths,
  }
}

export async function loadProfileDocument(
  root: string,
  name: string,
  explicitProfile?: string,
): Promise<LoadedProfile> {
  validateProfileName(name)
  const resolvedRoot = path.resolve(root)
  const profilePath = path.resolve(
    explicitProfile ?? path.join(resolvedRoot, "profiles", `${name}.toml`),
  )
  let value: unknown
  let source: string
  try {
    source = await readFile(profilePath, "utf8")
    value = parseToml(source)
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw new Error(`Profile not found: ${profilePath}`)
    throw new Error(`Could not parse profile ${profilePath}`, { cause: error })
  }
  const profile = objectValue(value, `profile ${profilePath}`)
  rejectUnknown(profile, ["version", "name", "snippets"], `profile ${profilePath}`)
  if (profile.version !== undefined && profile.version !== 1) {
    throw new Error(`Profile version must be 1: ${profilePath}`)
  }
  if (profile.name !== undefined && typeof profile.name !== "string") {
    throw new Error(`Profile name must be a string: ${profilePath}`)
  }
  if (profile.name !== undefined && profile.name !== name) {
    throw new Error(`Profile name must be ${name}: ${profilePath}`)
  }
  if (!Array.isArray(profile.snippets) || profile.snippets.some((entry) => typeof entry !== "string")) {
    throw new Error(`Profile snippets must be an array of names: ${profilePath}`)
  }
  const names = profile.snippets as string[]
  validateSnippetNames(names, `profile ${profilePath}`)
  const definition: ProfileDefinition = {
    ...(profile.version === undefined ? {} : { version: 1 as const }),
    ...(profile.name === undefined ? {} : { name: profile.name }),
    snippets: names,
  }
  const snippetPaths = await resolveSnippetPaths(resolvedRoot, names)
  return { root: resolvedRoot, profilePath, snippetPaths, source, definition }
}

export async function resolveSnippetPaths(root: string, snippets: readonly string[]): Promise<readonly string[]> {
  const resolvedRoot = path.resolve(root)
  validateSnippetNames(snippets, "profile snippets")
  const snippetRoot = path.join(resolvedRoot, "snippets")
  const snippetPaths: string[] = []
  let realRoot: string | undefined
  for (const snippet of snippets) {
    const candidate = path.join(snippetRoot, `${snippet}.md`)
    let resolved: string
    try {
      resolved = await realpath(candidate)
      const value = await lstat(resolved)
      if (!value.isFile()) throw new Error(`Snippet must be a regular file: ${candidate}`)
    } catch (error) {
      if (hasCode(error, "ENOENT")) throw new Error(`Snippet not found: ${candidate}`)
      throw error
    }
    realRoot ??= await realpath(snippetRoot)
    const relation = path.relative(realRoot, resolved)
    if (relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new Error(`Snippet resolves outside the snippet directory: ${snippet}`)
    }
    snippetPaths.push(resolved)
  }
  return snippetPaths
}

export function serializeProfile(definition: ProfileDefinition): string {
  return stringifyToml({
    ...(definition.version === undefined ? {} : { version: definition.version }),
    ...(definition.name === undefined ? {} : { name: definition.name }),
    snippets: [...definition.snippets],
  })
}

export function validateProfileName(name: string): void {
  if (!PROFILE_NAME.test(name)) {
    throw new Error("Profile name must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, or underscores")
  }
}

export function validateSnippetName(name: string): void {
  if (!SNIPPET_NAME.test(name) || name.endsWith(".md")) {
    throw new Error(`Invalid snippet name: ${name}`)
  }
}

function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? os.homedir() + value.slice(1) : value
}

async function listStems(
  directory: string,
  suffix: string,
  pattern: RegExp,
): Promise<readonly string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name.slice(0, -suffix.length))
      .filter((name) => pattern.test(name))
      .sort()
  } catch (error) {
    if (hasCode(error, "ENOENT")) return []
    throw error
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a table`)
  }
  return value as Record<string, unknown>
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`Unknown ${label} field: ${unknown[0]}`)
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

function validateSnippetNames(snippets: readonly string[], label: string): void {
  if (new Set(snippets).size !== snippets.length) throw new Error(`${label} contains a duplicate snippet`)
  for (const snippet of snippets) validateSnippetName(snippet)
}
