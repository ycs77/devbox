import { parseDocument, stringify } from 'yaml'
import { failure, success, type Result } from './result.js'

export interface RuntimeCatalog {
  readonly runtimes: Readonly<Record<string, readonly string[]>>
  readonly agents: readonly string[]
}

export const DEFAULT_RUNTIME_CATALOG: RuntimeCatalog = {
  runtimes: { node: ['24', '22'] },
  agents: ['claude-code', 'codex'],
}

export interface GlobalConfiguration {
  readonly version: 1
  readonly runtimes: Readonly<Record<string, readonly string[]>>
  readonly agents: readonly string[]
}

export interface PortMapping {
  readonly host: number
  readonly container: number
}

export interface LocalConfiguration {
  readonly version: 1
  readonly toolchain: Readonly<Record<string, string | null>>
  readonly ports: readonly PortMapping[]
}

export function normalizeCatalog(
  catalog: RuntimeCatalog = DEFAULT_RUNTIME_CATALOG,
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
  catalog: RuntimeCatalog = DEFAULT_RUNTIME_CATALOG,
): GlobalConfiguration {
  const runtimes: Record<string, readonly string[]> = {}
  for (const [family, entries] of Object.entries(catalog.runtimes)) {
    if (entries[0] !== undefined) {
      runtimes[family] = [entries[0]]
    }
  }
  return { version: 1, runtimes, agents: [] }
}

export function defaultLocalConfiguration(
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog = DEFAULT_RUNTIME_CATALOG,
): LocalConfiguration {
  const toolchain: Record<string, string | null> = {}
  for (const family of Object.keys(catalog.runtimes)) {
    toolchain[family] = globalConfiguration.runtimes[family]?.[0] ?? null
  }

  const ports: PortMapping[] = []
  if (toolchain.php !== null && toolchain.php !== undefined) {
    ports.push({ host: 8000, container: 8000 })
  }
  if (toolchain.node !== null && toolchain.node !== undefined) {
    ports.push({ host: 5173, container: 5173 })
  }
  return { version: 1, toolchain, ports }
}

export function parseGlobalConfiguration(
  source: string,
  catalog: RuntimeCatalog = DEFAULT_RUNTIME_CATALOG,
): Result<GlobalConfiguration> {
  const parsed = parseYaml(source)
  if (!parsed.ok) {
    return invalid('invalid-global-configuration', parsed.observed)
  }

  const document = parsed.value
  if (!isRecord(document) || !hasExactKeys(document, ['version', 'runtimes', 'agents'])) {
    return invalid(
      'invalid-global-configuration',
      'Global configuration contains unknown or missing fields.',
    )
  }
  if (document.version !== 1) {
    return invalid('invalid-global-configuration', 'Global configuration must use version: 1.')
  }
  if (!isRecord(document.runtimes) || !Array.isArray(document.agents)) {
    return invalid('invalid-global-configuration', 'Global configuration has invalid values.')
  }

  const runtimes: Record<string, readonly string[]> = {}
  for (const [family, value] of Object.entries(document.runtimes)) {
    const catalogEntries = catalog.runtimes[family]
    if (catalogEntries === undefined || !Array.isArray(value)) {
      return invalid('invalid-global-configuration', `Runtime family is not supported: ${family}.`)
    }

    const entries: string[] = []
    for (const rawEntry of value) {
      const entry = runtimeLine(rawEntry)
      if (entry === undefined || !catalogEntries.includes(entry)) {
        return invalid(
          'invalid-global-configuration',
          `Runtime entry is not in the packaged catalog: ${family}/${String(rawEntry)}.`,
        )
      }
      if (entries.includes(entry)) {
        return invalid(
          'invalid-global-configuration',
          `Runtime entry is duplicated: ${family}/${entry}.`,
        )
      }
      entries.push(entry)
    }
    runtimes[family] = entries
  }

  const agents: string[] = []
  for (const rawAgent of document.agents) {
    if (typeof rawAgent !== 'string' || !catalog.agents.includes(rawAgent)) {
      return invalid(
        'invalid-global-configuration',
        `Agent is not in the packaged catalog: ${String(rawAgent)}.`,
      )
    }
    if (agents.includes(rawAgent)) {
      return invalid('invalid-global-configuration', `Agent is duplicated: ${rawAgent}.`)
    }
    agents.push(rawAgent)
  }

  return success({ version: 1, runtimes, agents })
}

export function parseLocalConfiguration(
  source: string,
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog = DEFAULT_RUNTIME_CATALOG,
): Result<LocalConfiguration> {
  const parsed = parseYaml(source)
  if (!parsed.ok) {
    return invalid('invalid-local-configuration', parsed.observed)
  }

  const document = parsed.value
  if (!isRecord(document) || !hasExactKeys(document, ['version', 'toolchain', 'ports'])) {
    return invalid(
      'invalid-local-configuration',
      'Local configuration contains unknown or missing fields.',
    )
  }
  if (document.version !== 1) {
    return invalid('invalid-local-configuration', 'Local configuration must use version: 1.')
  }
  if (!isRecord(document.toolchain) || !Array.isArray(document.ports)) {
    return invalid('invalid-local-configuration', 'Local configuration has invalid values.')
  }
  const catalogFamilies = Object.keys(catalog.runtimes)
  const configuredFamilies = Object.keys(document.toolchain)
  if (
    configuredFamilies.length !== catalogFamilies.length ||
    configuredFamilies.some(family => !catalogFamilies.includes(family))
  ) {
    return invalid(
      'invalid-local-configuration',
      'Local configuration must select every packaged Runtime family, using null for none.',
    )
  }

  const toolchain: Record<string, string | null> = {}
  for (const [family, rawEntry] of Object.entries(document.toolchain)) {
    const catalogEntries = catalog.runtimes[family]
    if (catalogEntries === undefined) {
      return invalid('invalid-local-configuration', `Runtime family is not supported: ${family}.`)
    }

    const entry = runtimeLineOrNull(rawEntry)
    if (entry === undefined) {
      return invalid(
        'invalid-local-configuration',
        `Runtime entry is invalid: ${family}/${String(rawEntry)}.`,
      )
    }
    if (entry !== null && !catalogEntries.includes(entry)) {
      return invalid(
        'invalid-local-configuration',
        `Runtime entry is not in the packaged catalog: ${family}/${String(rawEntry)}.`,
      )
    }
    if (entry !== null && !globalConfiguration.runtimes[family]?.includes(entry)) {
      return invalid(
        'unconfigured-runtime-selection',
        `Local configuration selects a Runtime that is not configured globally: ${family}/${entry}.`,
      )
    }
    toolchain[family] = entry
  }

  const ports: PortMapping[] = []
  const hosts = new Set<number>()
  const containers = new Set<number>()
  for (const rawPort of document.ports) {
    if (!isRecord(rawPort) || !hasExactKeys(rawPort, ['host', 'container'])) {
      return invalid(
        'invalid-local-configuration',
        'Each port must contain only host and container.',
      )
    }
    if (!isPort(rawPort.host) || !isPort(rawPort.container)) {
      return invalid(
        'invalid-local-configuration',
        'Project ports must be integers from 1 through 65535.',
      )
    }
    if (hosts.has(rawPort.host) || containers.has(rawPort.container)) {
      return invalid(
        'invalid-local-configuration',
        'Project ports must not repeat host or container ports.',
      )
    }
    hosts.add(rawPort.host)
    containers.add(rawPort.container)
    ports.push({ host: rawPort.host, container: rawPort.container })
  }

  return success({ version: 1, toolchain, ports })
}

export function serializeGlobalConfiguration(configuration: GlobalConfiguration): string {
  return stringify({
    version: 1,
    runtimes: Object.fromEntries(
      Object.entries(configuration.runtimes).map(([family, entries]) => [family, [...entries]]),
    ),
    agents: [...configuration.agents],
  })
}

export function serializeLocalConfiguration(configuration: LocalConfiguration): string {
  return stringify({
    version: 1,
    toolchain: Object.fromEntries(Object.entries(configuration.toolchain)),
    ports: configuration.ports.map(port => ({ host: port.host, container: port.container })),
  })
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
  if (value === null || value === undefined || value === '') {
    return null
  }
  return runtimeLine(value)
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
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
