import { lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, parse, relative, sep } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { failure, success, type Result } from '../result.js'

export interface DevboxPaths {
  readonly home: string
  readonly globalConfiguration: string
  readonly projectRegistry: string
  readonly projects: string
  readonly buildContext: string
  readonly claudeHostConfiguration: string
}

export function devboxPaths(devboxHome = join(homedir(), '.devbox')): DevboxPaths {
  return {
    home: devboxHome,
    globalConfiguration: join(devboxHome, 'config.yaml'),
    projectRegistry: join(devboxHome, 'projects.yaml'),
    projects: join(devboxHome, 'projects'),
    buildContext: join(devboxHome, 'build'),
    claudeHostConfiguration: join(devboxHome, 'agents', 'claude', '.claude.json'),
  }
}

export function sandboxIdentity(projectRoot: string): string {
  const root = parse(projectRoot).root
  const pathWithinRoot = relative(root, projectRoot)

  if (
    !isAbsolute(projectRoot) ||
    pathWithinRoot === '..' ||
    pathWithinRoot.startsWith(`..${sep}`)
  ) {
    throw new TypeError('Project root must be an absolute path.')
  }

  return pathWithinRoot === '' ? 'root' : pathWithinRoot.split(sep).map(escapePathSegment).join('-')
}

export function projectStateDirectory(sandboxIdentity: string, devboxHome: string): string {
  if (!isSafeStateDirectoryName(sandboxIdentity)) {
    throw new TypeError('Sandbox identity must be a safe state directory name.')
  }

  return join(devboxHome, 'projects', sandboxIdentity)
}

export function sandboxName(projectRoot: string): string {
  const normalized = basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')

  return normalized.length < 2 ? `project-${normalized || 'root'}` : normalized
}

export function escapePathSegment(segment: string): string {
  const bytes = new TextEncoder().encode(segment)
  let escaped = ''

  for (const byte of bytes) {
    if (
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d ||
      byte === 0x5f
    ) {
      escaped += String.fromCharCode(byte)
    } else {
      escaped += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }

  return escaped
}

export function unescapePathSegment(segment: string): string {
  const bytes: number[] = []

  for (let index = 0; index < segment.length; index += 1) {
    if (segment[index] === '%') {
      const hex = segment.slice(index + 1, index + 3)
      if (!/^[0-9A-F]{2}$/i.test(hex)) {
        throw new TypeError(`Invalid escaped Project path segment: ${segment}`)
      }
      bytes.push(Number.parseInt(hex, 16))
      index += 2
      continue
    }

    const codePoint = segment.codePointAt(index)
    if (codePoint === undefined || codePoint > 0x7f) {
      throw new TypeError(`Invalid escaped Project path segment: ${segment}`)
    }
    bytes.push(codePoint)
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
}

export async function allocateSandboxIdentity(
  projectRoot: string,
  paths: DevboxPaths,
  registry: ProjectRegistry,
): Promise<Result<string>> {
  const identity = sandboxIdentity(projectRoot)
  for (let suffix = 1; suffix < 1000000; suffix += 1) {
    const candidate = suffix === 1 ? identity : `${identity}-${suffix}`
    if (
      !isSafeStateDirectoryName(candidate) ||
      Object.values(registry.projects).some(entry => entry.identity === candidate)
    ) {
      continue
    }
    try {
      await lstat(projectStateDirectory(candidate, paths.home))
    } catch (error) {
      if (isMissingFileError(error)) {
        return success(candidate)
      }
      return failure({
        kind: 'operational',
        code: 'state-directory-observation-failed',
        observed: `Devbox could not inspect Project state directory: ${projectStateDirectory(candidate, paths.home)}.`,
        nextAction: 'Check write access to ~/.devbox and run devbox init again.',
      })
    }
  }
  return failure({
    kind: 'operational',
    code: 'state-directory-allocation-failed',
    observed: `Devbox could not allocate a unique Project state directory for ${projectRoot}.`,
    nextAction: 'Remove stale Devbox state only through its supported command and try again.',
  })
}

export function allocateSandboxName(
  projectRoot: string,
  registry: ProjectRegistry,
): Result<string> {
  const name = sandboxName(projectRoot)
  for (let suffix = 1; suffix < 1000000; suffix += 1) {
    const candidate = suffix === 1 ? name : `${name}-${suffix}`
    if (
      isSafeSandboxName(candidate) &&
      !Object.values(registry.projects).some(entry => entry.name === candidate)
    ) {
      return success(candidate)
    }
  }
  return failure({
    kind: 'operational',
    code: 'sandbox-name-allocation-failed',
    observed: `Devbox could not allocate a unique Sandbox name for ${projectRoot}.`,
    nextAction: 'Remove stale Devbox state only through its supported command and try again.',
  })
}

export interface ProjectRegistration {
  readonly identity: string
  readonly name: string
}

export interface ProjectRegistry {
  readonly version: 1
  readonly projects: Readonly<Record<string, ProjectRegistration>>
}

export function parseProjectRegistry(source: string): Result<ProjectRegistry> {
  let document: unknown
  try {
    const parsed = parseDocument(source, { strict: true, uniqueKeys: true, version: '1.2' })
    if (parsed.errors.length > 0) {
      return invalid(parsed.errors[0]?.message ?? 'Project registry YAML is invalid.')
    }
    document = parsed.toJS()
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Project registry YAML is invalid.')
  }

  if (
    !isPlainObject(document) ||
    !hasExactKeys(document, ['version', 'projects']) ||
    document.version !== 1 ||
    !isPlainObject(document.projects)
  ) {
    return invalid('Project registry must contain only version: 1 and projects.')
  }

  const projects: Record<string, ProjectRegistration> = {}
  const assignedIdentities = new Set<string>()
  const assignedNames = new Set<string>()
  for (const [root, registration] of Object.entries(document.projects)) {
    if (!isAbsolute(root)) {
      return invalid(`Project root must be an exact absolute path: ${root}.`)
    }
    if (
      !isPlainObject(registration) ||
      !hasExactKeys(registration, ['identity', 'name']) ||
      typeof registration.identity !== 'string' ||
      !isSafeStateDirectoryName(registration.identity) ||
      assignedIdentities.has(registration.identity)
    ) {
      return invalid('Sandbox identity assignment is invalid.')
    }
    if (
      typeof registration.name !== 'string' ||
      !isSafeSandboxName(registration.name) ||
      assignedNames.has(registration.name)
    ) {
      return invalid('Sandbox name assignment is invalid.')
    }
    assignedIdentities.add(registration.identity)
    assignedNames.add(registration.name)
    projects[root] = { identity: registration.identity, name: registration.name }
  }

  return success({ version: 1, projects })
}
export function serializeProjectRegistry(registry: ProjectRegistry): string {
  const projects = Object.fromEntries(
    Object.entries(registry.projects).sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    }),
  )
  return stringify({ version: 1, projects })
}

export function isSafeStateDirectoryName(name: string): boolean {
  return /^(?:[A-Za-z0-9_%~-]+)(?:-[2-9][0-9]*)?$/.test(name) && name !== '.' && name !== '..'
}

export function isSafeSandboxName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]+$/.test(name)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === expected.size && actual.every(key => expected.has(key))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function invalid(observed: string): Result<never> {
  return failure({
    kind: 'validation',
    code: 'invalid-project-registry',
    observed,
    nextAction: 'Repair ~/.devbox/projects.yaml using the supported version-1 registry schema.',
  })
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
