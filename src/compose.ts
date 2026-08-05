import { createHash } from "node:crypto"
import { accessSync, constants, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse as parseToml } from "smol-toml"

const COMMAND_NAME = /^[A-Za-z0-9._+-]+$/

export interface MarkdownSnippetInput {
  readonly source: string
  readonly content: string
}

export interface ParsedMarkdownSnippet {
  readonly source: string
  readonly body: string
  readonly description?: string
  readonly requires: readonly string[]
  readonly excludes: readonly string[]
}

export interface SnippetDecision {
  readonly source: string
  readonly selected: boolean
  readonly reason: string
  readonly description?: string
}

export interface CompositionSummary {
  readonly body: string
  readonly digest: string
  readonly decisions: readonly SnippetDecision[]
}

export interface CompositionResult extends CompositionSummary {
  readonly content: string
}

export type HeaderFactory = (summary: CompositionSummary) => string | undefined
export type CommandAvailability = (command: string) => boolean

export interface ComposeOptions {
  readonly snippets: readonly MarkdownSnippetInput[]
  readonly commandAvailable?: CommandAvailability
  readonly header?: string | HeaderFactory
}

export interface ComposeFilesOptions {
  readonly paths: readonly string[]
  readonly commandAvailable?: CommandAvailability
  readonly header?: string | HeaderFactory
}

export function parseSnippet(input: MarkdownSnippetInput): ParsedMarkdownSnippet {
  let body = input.content
  let metadata: Record<string, unknown> = {}
  const opening = /^\+\+\+\r?\n/.exec(body)
  if (opening) {
    const rest = body.slice(opening[0].length)
    const closing = /(?:^|\r?\n)\+\+\+\r?\n/.exec(rest)
    if (!closing) throw new Error(`Unterminated TOML front matter in ${input.source}`)
    const metadataEnd = closing.index
    try {
      metadata = objectValue(parseToml(rest.slice(0, metadataEnd)), `front matter in ${input.source}`)
    } catch (error) {
      throw new Error(`Invalid TOML front matter in ${input.source}`, { cause: error })
    }
    const bodyStart = metadataEnd + closing[0].length
    body = rest.slice(bodyStart)
  }
  rejectUnknown(metadata, ["description", "requires", "excludes"], `front matter in ${input.source}`)
  const description = metadata.description
  if (description !== undefined && (typeof description !== "string" || description.trim() === "")) {
    throw new Error(`Snippet description must be a non-empty string: ${input.source}`)
  }
  const requires = commandArray(metadata.requires, `${input.source} requires`)
  const excludes = commandArray(metadata.excludes, `${input.source} excludes`)
  return {
    source: input.source,
    body: body.trim(),
    ...(typeof description === "string" ? { description } : {}),
    requires,
    excludes,
  }
}

export function compose(options: ComposeOptions): CompositionResult {
  const commandAvailable = options.commandAvailable ?? defaultCommandAvailable
  const bodies: string[] = []
  const decisions: SnippetDecision[] = []
  for (const input of options.snippets) {
    const snippet = parseSnippet(input)
    const missing = snippet.requires.filter((command) => !commandAvailable(command))
    const excluded = snippet.excludes.filter((command) => commandAvailable(command))
    const selected = missing.length === 0 && excluded.length === 0
    const reason =
      missing.length > 0
        ? `missing commands: ${missing.join(", ")}`
        : excluded.length > 0
          ? `excluded commands present: ${excluded.join(", ")}`
          : "selected"
    decisions.push({
      source: snippet.source,
      selected,
      reason,
      ...(snippet.description ? { description: snippet.description } : {}),
    })
    if (selected && snippet.body) bodies.push(snippet.body)
  }
  const body = bodies.join("\n\n")
  const summary: CompositionSummary = {
    body,
    digest: hashText(body),
    decisions,
  }
  const header =
    typeof options.header === "function"
      ? options.header(summary)
      : options.header
  const sections = [header?.trim(), body].filter((value): value is string => Boolean(value))
  return {
    ...summary,
    content: sections.length > 0 ? `${sections.join("\n\n")}\n` : "",
  }
}

export async function composeFiles(options: ComposeFilesOptions): Promise<CompositionResult> {
  const snippets = await Promise.all(
    options.paths.map(async (source) => ({ source, content: await readFile(source, "utf8") })),
  )
  return compose({
    snippets,
    ...(options.commandAvailable ? { commandAvailable: options.commandAvailable } : {}),
    ...(options.header ? { header: options.header } : {}),
  })
}

export function commandAvailableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  validateCommand(command)
  const pathValue = env.PATH ?? ""
  return pathValue.split(path.delimiter).some((directory) => {
    if (!directory) return false
    try {
      const candidate = path.join(directory, command)
      accessSync(candidate, constants.X_OK)
      const value = statSync(candidate)
      return value.isFile() && (value.mode & 0o111) !== 0
    } catch {
      return false
    }
  })
}

function defaultCommandAvailable(command: string): boolean {
  return commandAvailableOnPath(command)
}

function commandArray(value: unknown, label: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of command names`)
  }
  const commands = value as string[]
  for (const command of commands) validateCommand(command)
  if (new Set(commands).size !== commands.length) {
    throw new Error(`${label} contains a duplicate command`)
  }
  return commands
}

function validateCommand(command: string): void {
  if (!COMMAND_NAME.test(command)) throw new Error(`Invalid command name: ${command}`)
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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
