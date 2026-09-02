import { isAbsolute } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { failure, success, type Result } from '../result.js'

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
