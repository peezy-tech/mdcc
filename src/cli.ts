#!/usr/bin/env node
import os from "node:os"
import path from "node:path"
import { composeFiles } from "./compose.js"
import { outputIsCurrent, writeOutput } from "./output.js"
import {
  defaultConfigRoot,
  listProfiles,
  listSnippets,
  loadProfile,
  loadProfileDocument,
  resolveSnippetPaths,
  serializeProfile,
  validateSnippetName,
  type LoadedProfile,
  type ProfileDefinition,
} from "./profile.js"

const HELP = `mdcsp — compose Markdown context files

Usage:
  mdcsp render [profile] [--root DIR] [--file FILE] [--target FILE] [--stdout] [--json]
  mdcsp check [profile] [--root DIR] [--file FILE] [--target FILE] [--json]
  mdcsp explain [profile] [--root DIR] [--file FILE] [--json]
  mdcsp list <profiles|snippets> [--root DIR] [--json]
  mdcsp profile show [profile] [--root DIR] [--file FILE] [--json]
  mdcsp profile add [profile] <snippet> [--root DIR] [--file FILE] [--target FILE] [--json]
  mdcsp profile remove [profile] <snippet> [--root DIR] [--file FILE] [--target FILE] [--json]
  mdcsp --help
  mdcsp --version

Profiles default to "default" under $MDCSP_HOME/profiles or
$XDG_CONFIG_HOME/mdcsp/profiles. The default output target is
~/.codex/AGENTS.md.
`

interface CommandArgs {
  readonly profile: string
  readonly root: string
  readonly file?: string
  readonly target: string
  readonly targetProvided: boolean
  readonly stdout: boolean
  readonly json: boolean
  readonly remaining: readonly string[]
}

async function main(argv: readonly string[]): Promise<void> {
  const command = argv[0]
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP)
    return
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write("0.1.1\n")
    return
  }
  if (!["render", "check", "explain", "list", "profile"].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  const parsed = parseArgs(argv.slice(1))
  if (command === "list") {
    if (parsed.remaining.length !== 1 || !["profiles", "snippets"].includes(parsed.remaining[0] ?? "")) {
      throw new Error("list requires profiles or snippets")
    }
    if (parsed.file || parsed.stdout) throw new Error("list does not accept --file or --stdout")
    const values = parsed.remaining[0] === "profiles"
      ? await listProfiles(parsed.root)
      : await listSnippets(parsed.root)
    if (parsed.json) writeJson(values)
    else for (const value of values) process.stdout.write(`${value}\n`)
    return
  }
  if (command === "profile") {
    await handleProfileCommand(parsed)
    return
  }
  if (parsed.remaining.length > 1) throw new Error(`${command} accepts at most one profile name`)
  const profileName = parsed.remaining[0] ?? parsed.profile
  const profile = await loadProfile(parsed.root, profileName, parsed.file)
  const result = await composeProfile(profileName, profile)
  if (command === "explain") {
    if (parsed.stdout) throw new Error("explain does not accept --stdout")
    if (parsed.json) writeJson(result.decisions)
    else printDecisions(result.decisions)
    return
  }
  if (command === "check") {
    if (parsed.stdout) throw new Error("check does not accept --stdout")
    const current = await outputIsCurrent(parsed.target, result.content)
    if (parsed.json) writeJson({ current, target: path.resolve(parsed.target), digest: result.digest, decisions: result.decisions })
    else process.stdout.write(`${current ? "current" : "different"}\t${path.resolve(parsed.target)}\n`)
    if (!current) process.exitCode = 1
    return
  }
  if (parsed.stdout) {
    if (parsed.json) throw new Error("render cannot combine --stdout and --json")
    process.stdout.write(result.content)
    return
  }
  await writeOutput(parsed.target, result.content)
  if (parsed.json) {
    writeJson({ target: path.resolve(parsed.target), digest: result.digest, decisions: result.decisions })
  } else {
    process.stdout.write(`rendered ${result.decisions.filter((decision) => decision.selected).length} snippet(s) to ${path.resolve(parsed.target)}\n`)
  }
}

function parseArgs(argv: readonly string[]): CommandArgs {
  let profile = "default"
  let root = defaultConfigRoot()
  let file: string | undefined
  let target = path.join(os.homedir(), ".codex", "AGENTS.md")
  let targetProvided = false
  let stdout = false
  let json = false
  const remaining: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (option === "--stdout") stdout = true
    else if (option === "--json") json = true
    else if (["--root", "--file", "--target", "--profile"].includes(option ?? "")) {
      const value = argv[++index]
      if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`)
      if (option === "--root") root = path.resolve(value)
      else if (option === "--file") file = path.resolve(value)
      else if (option === "--target") {
        target = path.resolve(expandHome(value))
        targetProvided = true
      }
      else profile = value
    } else if (option?.startsWith("-")) throw new Error(`Unknown option: ${option}`)
    else if (option) remaining.push(option)
  }
  return {
    profile,
    root,
    ...(file ? { file } : {}),
    target,
    targetProvided,
    stdout,
    json,
    remaining,
  }
}

async function handleProfileCommand(parsed: CommandArgs): Promise<void> {
  if (parsed.stdout) throw new Error("profile does not accept --stdout")
  const action = parsed.remaining[0]
  if (!action || !["show", "add", "remove"].includes(action)) {
    throw new Error("profile requires show, add, or remove")
  }
  if (action === "show") {
    if (parsed.targetProvided) throw new Error("profile show does not accept --target")
    if (parsed.remaining.length > 2) throw new Error("profile show accepts at most one profile name")
    const profileName = parsed.remaining[1] ?? parsed.profile
    const profile = await loadProfileDocument(parsed.root, profileName, parsed.file)
    const value = {
      profile: profileName,
      profilePath: profile.profilePath,
      snippets: [...profile.definition.snippets],
    }
    if (parsed.json) writeJson(value)
    else printProfile(value)
    return
  }

  if (parsed.remaining.length < 2 || parsed.remaining.length > 3) {
    throw new Error(`profile ${action} requires a snippet and optionally a profile name`)
  }
  const profileName = parsed.remaining.length === 2 ? parsed.profile : parsed.remaining[1]!
  const snippetName = parsed.remaining.length === 2 ? parsed.remaining[1]! : parsed.remaining[2]!
  validateSnippetName(snippetName)
  const profile = await loadProfileDocument(parsed.root, profileName, parsed.file)
  const currentSnippets = [...profile.definition.snippets]
  const currentIndex = currentSnippets.indexOf(snippetName)
  if (action === "add" && currentIndex !== -1) {
    throw new Error(`Profile already contains snippet: ${snippetName}`)
  }
  if (action === "remove" && currentIndex === -1) {
    throw new Error(`Profile does not contain snippet: ${snippetName}`)
  }
  const nextSnippets = action === "add"
    ? [...currentSnippets, snippetName]
    : currentSnippets.filter((snippet) => snippet !== snippetName)
  const nextDefinition: ProfileDefinition = { ...profile.definition, snippets: nextSnippets }
  const target = path.resolve(parsed.target)
  if (target === profile.profilePath) {
    throw new Error("Profile mutation target must not be the profile file")
  }
  const snippetPaths = await resolveSnippetPaths(profile.root, nextSnippets)
  const result = await composeProfile(profileName, { ...profile, snippetPaths })
  await writeProfileAndTarget(profile, nextDefinition, target, result.content)
  const value = {
    action: action === "add" ? "added" : "removed",
    profile: profileName,
    profilePath: profile.profilePath,
    snippet: snippetName,
    snippets: nextSnippets,
    target,
    digest: result.digest,
    decisions: result.decisions,
  }
  if (parsed.json) writeJson(value)
  else process.stdout.write(`${value.action} ${snippetName} ${profileName}; rendered ${result.decisions.filter((decision) => decision.selected).length} snippet(s) to ${target}\n`)
}

async function composeProfile(
  profileName: string,
  profile: Pick<LoadedProfile, "profilePath" | "snippetPaths">,
) {
  return await composeFiles({
    paths: profile.snippetPaths,
    header: ({ digest }) =>
      `<!-- Generated by mdcsp. Edit snippets, not this file.\n` +
      `     Profile: ${profileName} (${profile.profilePath})\n` +
      `     Content: sha256:${digest.slice(0, 12)} -->`,
  })
}

async function writeProfileAndTarget(
  profile: LoadedProfile,
  definition: ProfileDefinition,
  target: string,
  content: string,
): Promise<void> {
  await writeOutput(profile.profilePath, serializeProfile(definition))
  try {
    await writeOutput(target, content)
  } catch (error) {
    try {
      await writeOutput(profile.profilePath, profile.source)
    } catch (rollbackError) {
      const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      throw new Error(`Could not render ${target}; profile rollback failed: ${detail}`, { cause: error })
    }
    throw error
  }
}

function printProfile(value: { readonly profile: string; readonly profilePath: string; readonly snippets: readonly string[] }): void {
  process.stdout.write(`profile ${value.profile}\n`)
  process.stdout.write(`file ${value.profilePath}\n`)
  process.stdout.write("snippets:\n")
  if (value.snippets.length === 0) process.stdout.write("  (none)\n")
  else for (const [index, snippet] of value.snippets.entries()) process.stdout.write(`  ${index + 1}. ${snippet}\n`)
}

function printDecisions(decisions: readonly { readonly source: string; readonly selected: boolean; readonly reason: string; readonly description?: string }[]): void {
  for (const decision of decisions) {
    process.stdout.write(
      `${decision.selected ? "+" : "-"} ${decision.source}: ${decision.reason}${decision.description ? ` — ${decision.description}` : ""}\n`,
    )
  }
}

function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? os.homedir() + value.slice(1) : value
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`mdcsp: ${message}\n`)
  process.exitCode = 2
})
