import { parseDocument, stringify } from 'yaml'
import { PACKAGED_RUNTIME_CATALOG } from './packaged-catalog.js'
import { failure, success, type Result } from './result.js'

export interface RuntimeCatalog {
  readonly runtimes: Readonly<Record<string, readonly string[]>>
  readonly agents: readonly string[]
}

export interface GlobalConfiguration {
  readonly version: 1
  readonly node: readonly string[]
  readonly agent: readonly string[]
  readonly agent_notifications: boolean
}

export interface LocalConfiguration {
  readonly version: 1
  readonly node: string | null
}

export function normalizeCatalog(
  catalog: RuntimeCatalog = PACKAGED_RUNTIME_CATALOG,
): Result<RuntimeCatalog> {
  if (!isRecord(catalog.runtimes) || !Array.isArray(catalog.agents)) {
    return invalid('invalid-runtime-catalog', 'The packaged Runtime catalog is invalid.')
  }

  const runtimes: Record<string, readonly string[]> = {}
  for (const [family, entries] of Object.entries(catalog.runtimes)) {
    if (!isCatalogName(family) || !Array.isArray(entries) || entries.length === 0) {
      return invalid('invalid-runtime-catalog', 'The packaged Runtime catalog is invalid.')
    }

    const normalizedEntries: string[] = []
    for (const entry of entries) {
      if (typeof entry !== 'string' || entry.length === 0 || normalizedEntries.includes(entry)) {
        return invalid('invalid-runtime-catalog', 'The packaged Runtime catalog is invalid.')
      }
      normalizedEntries.push(entry)
    }
    runtimes[family] = normalizedEntries
  }

  const agents: string[] = []
  for (const agent of catalog.agents) {
    if (typeof agent !== 'string' || !isCatalogName(agent) || agents.includes(agent)) {
      return invalid('invalid-runtime-catalog', 'The packaged Agent catalog is invalid.')
    }
    agents.push(agent)
  }

  return success({ runtimes, agents })
}

export function defaultGlobalConfiguration(
  catalog: RuntimeCatalog = PACKAGED_RUNTIME_CATALOG,
): GlobalConfiguration {
  return {
    version: 1,
    node: catalog.runtimes.node?.[0] === undefined ? [] : [catalog.runtimes.node[0]],
    agent: [],
    agent_notifications: true,
  }
}

export function defaultLocalConfiguration(
  globalConfiguration: GlobalConfiguration,
): LocalConfiguration {
  return { version: 1, node: globalConfiguration.node[0] ?? null }
}

export function parseGlobalConfiguration(
  source: string,
  catalog: RuntimeCatalog = PACKAGED_RUNTIME_CATALOG,
): Result<GlobalConfiguration> {
  const parsed = parseYaml(source)
  if (!parsed.ok) {
    return invalid('invalid-global-configuration', parsed.observed)
  }

  const document = parsed.value
  if (
    !isRecord(document) ||
    !hasExactKeys(document, ['version', 'node', 'agent', 'agent_notifications'])
  ) {
    return invalid(
      'invalid-global-configuration',
      'Global configuration contains unknown or missing fields.',
    )
  }
  if (document.version !== 1) {
    return invalid('invalid-global-configuration', 'Global configuration must use version: 1.')
  }
  if (!Array.isArray(document.node) || !Array.isArray(document.agent)) {
    return invalid('invalid-global-configuration', 'Global configuration has invalid values.')
  }
  if (typeof document.agent_notifications !== 'boolean') {
    return invalid(
      'invalid-global-configuration',
      'Global configuration agent_notifications must be true or false.',
    )
  }

  const node: string[] = []
  for (const rawEntry of document.node) {
    const entry = runtimeLine(rawEntry)
    if (entry === undefined || !catalog.runtimes.node?.includes(entry)) {
      return invalid(
        'invalid-global-configuration',
        `Node Runtime is not in the packaged catalog: ${String(rawEntry)}.`,
      )
    }
    if (node.includes(entry)) {
      return invalid('invalid-global-configuration', `Node Runtime is duplicated: ${entry}.`)
    }
    node.push(entry)
  }

  const agent: string[] = []
  for (const rawAgent of document.agent) {
    if (typeof rawAgent !== 'string' || !catalog.agents.includes(rawAgent)) {
      return invalid(
        'invalid-global-configuration',
        `Agent is not in the packaged catalog: ${String(rawAgent)}.`,
      )
    }
    if (agent.includes(rawAgent)) {
      return invalid('invalid-global-configuration', `Agent is duplicated: ${rawAgent}.`)
    }
    agent.push(rawAgent)
  }

  return success({ version: 1, node, agent, agent_notifications: document.agent_notifications })
}

export function parseLocalConfiguration(
  source: string,
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog = PACKAGED_RUNTIME_CATALOG,
): Result<LocalConfiguration> {
  const parsed = parseYaml(source)
  if (!parsed.ok) {
    return invalid('invalid-local-configuration', parsed.observed)
  }

  const document = parsed.value
  if (!isRecord(document) || !hasExactKeys(document, ['version', 'node'])) {
    return invalid(
      'invalid-local-configuration',
      'Local configuration contains unknown or missing fields.',
    )
  }
  if (document.version !== 1) {
    return invalid('invalid-local-configuration', 'Local configuration must use version: 1.')
  }

  const node = runtimeLineOrNull(document.node)
  if (node === undefined) {
    return invalid(
      'invalid-local-configuration',
      `Node Runtime is invalid: ${String(document.node)}.`,
    )
  }
  if (node !== null && !catalog.runtimes.node?.includes(node)) {
    return invalid(
      'invalid-local-configuration',
      `Node Runtime is not in the packaged catalog: ${String(document.node)}.`,
    )
  }
  if (node !== null && !globalConfiguration.node.includes(node)) {
    return invalid(
      'unconfigured-runtime-selection',
      `Local configuration selects a Node Runtime that is not configured globally: ${node}.`,
    )
  }

  return success({ version: 1, node })
}

export function serializeGlobalConfiguration(configuration: GlobalConfiguration): string {
  return stringify({
    version: 1,
    node: [...configuration.node],
    agent: [...configuration.agent],
    agent_notifications: configuration.agent_notifications,
  })
}

export function serializeLocalConfiguration(configuration: LocalConfiguration): string {
  return stringify({ version: 1, node: configuration.node })
}

export function configurationsEqual(
  left: GlobalConfiguration | LocalConfiguration,
  right: GlobalConfiguration | LocalConfiguration,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

type ParsedYaml =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly observed: string }

function parseYaml(source: string): ParsedYaml {
  try {
    const document = parseDocument(source, { strict: true, uniqueKeys: true, version: '1.2' })
    if (document.errors.length > 0) {
      return { ok: false, observed: document.errors[0]?.message ?? 'YAML is invalid.' }
    }
    return { ok: true, value: document.toJS() }
  } catch (error) {
    return {
      ok: false,
      observed: error instanceof Error ? error.message : 'YAML is invalid.',
    }
  }
}

function runtimeLine(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value)
  }
  return undefined
}

function runtimeLineOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  return runtimeLine(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === expected.size && actual.every(key => expected.has(key))
}

function isCatalogName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value)
}

function invalid(code: string, observed: string): Result<never> {
  return failure({
    kind: 'validation',
    code,
    observed,
    nextAction: 'Edit the supported version-1 YAML configuration and try again.',
  })
}
