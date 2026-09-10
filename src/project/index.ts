import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path'
import { ensureSharedAgentVolumes } from '../agent/volumes.js'
import {
  configurationsEqual,
  defaultGlobalConfiguration,
  defaultLocalConfiguration,
  normalizeCatalog,
  parseGlobalConfiguration,
  parseLocalConfiguration,
  serializeGlobalConfiguration,
  serializeLocalConfiguration,
  type GlobalConfiguration,
  type LocalConfiguration,
  type RuntimeCatalog,
} from '../configuration/index.js'
import { currentHostEnvironment, type HostEnvironment, validateSupportedHost } from '../host.js'
import { failure, success, type Result } from '../result.js'
import { withStateLocks, type StateLockContext } from '../state-lock/index.js'
import { renderProjectCompose } from './compose.js'
import {
  isSafeSandboxName,
  isSafeStateDirectoryName,
  parseProjectRegistry,
  serializeProjectRegistry,
  type ProjectRegistry,
} from './registry.js'

export interface RegisteredProject {
  readonly root: string
  readonly stateDirectory: string
  readonly sandboxName: string
  readonly created: boolean
  readonly confirmed?: boolean
}

export interface DevboxPaths {
  readonly home: string
  readonly globalConfiguration: string
  readonly projectRegistry: string
  readonly projects: string
  readonly buildContext: string
  readonly claudeHostConfiguration: string
}

export interface ConfirmationSection {
  readonly title: string
  readonly current: string
  readonly next: string
}

export interface ConfirmationDetails {
  readonly title: string
  readonly sections: readonly ConfirmationSection[]
}

export type ConfirmationHandler = (
  message: string,
  details?: ConfirmationDetails,
) => Promise<boolean>

export interface ConfigurationPrompter {
  readonly confirm: ConfirmationHandler
  readonly editGlobal?: (
    configuration: GlobalConfiguration,
    catalog: RuntimeCatalog,
  ) => Promise<GlobalConfiguration>
  readonly editLocal?: (
    configuration: LocalConfiguration,
    catalog: RuntimeCatalog,
    globalConfiguration: GlobalConfiguration,
    editPorts?: boolean,
  ) => Promise<LocalConfiguration>
}

export interface InitializeProjectInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly validateHost?: () => Promise<Result<void>>
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
  readonly confirm?: ConfirmationHandler
  readonly initialGlobalConfiguration?: GlobalConfiguration
  readonly initialLocalConfiguration?: LocalConfiguration
}

export interface ConfigureLocalInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
  readonly confirm?: ConfirmationHandler
  readonly nextConfiguration?: LocalConfiguration
}

export interface ConfigureGlobalInput {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
  readonly confirm?: ConfirmationHandler
  readonly nextConfiguration?: GlobalConfiguration
  readonly nextLocalConfigurations?: Readonly<Record<string, LocalConfiguration>>
}

export interface RemoveProjectInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly confirm?: ConfirmationHandler
  readonly yes?: boolean
}

export interface CleanupMissingProjectsInput {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly confirm?: ConfirmationHandler
  readonly yes?: boolean
}

export type SandboxLifecycleCommand = 'up' | 'down' | 'stop' | 'sh'

export interface SandboxLifecycleInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly environment?: HostEnvironment
}

export interface ConfigurationOperation {
  readonly scope: 'global' | 'local'
  readonly root?: string
  readonly changed: boolean
}

export interface ProjectRemoval {
  readonly root: string
  readonly removed: boolean
}

export interface MissingProjectsCleanup {
  readonly roots: readonly string[]
  readonly removed: boolean
}
export type InitializeProjectResult = Result<RegisteredProject>
export type ConfigureLocalResult = Result<ConfigurationOperation>
export type ConfigureGlobalResult = Result<ConfigurationOperation>
export type RemoveProjectResult = Result<ProjectRemoval>
export type CleanupMissingProjectsResult = Result<MissingProjectsCleanup>
export type SandboxLifecycleResult = Result<void>

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

export async function initializeProject(
  input: InitializeProjectInput = {},
): Promise<Result<RegisteredProject>> {
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [input.root ?? process.cwd()],
      signal: input.signal,
    },
    () => initializeProjectUnlocked(input),
  )
}

async function initializeProjectUnlocked(
  input: InitializeProjectInput = {},
): Promise<Result<RegisteredProject>> {
  const projectRoot = input.root ?? process.cwd()
  const rootCheck = await validateProjectRoot(projectRoot)
  if (!rootCheck.ok) {
    return rootCheck
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const hostCheck = await (input.validateHost ?? validateSupportedHost)()
  if (!hostCheck.ok) {
    return hostCheck
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const catalogCheck = normalizeCatalog(input.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(input.devboxHome)
  const registryState = await readOptionalFile(paths.projectRegistry)
  if (!registryState.ok) {
    return registryState
  }

  const registryCheck = registryState.value.exists
    ? parseProjectRegistry(registryState.value.content)
    : success<ProjectRegistry>({ version: 1, projects: {} })
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registry = registryCheck.value
  const registration = registry.projects[projectRoot]
  let identity: string
  let name: string
  if (registration !== undefined) {
    identity = registration.identity
    name = registration.name
  } else {
    const allocatedIdentity = await allocateSandboxIdentity(projectRoot, paths, registry)
    if (!allocatedIdentity.ok) {
      return allocatedIdentity
    }
    const allocatedName = allocateSandboxName(projectRoot, registry)
    if (!allocatedName.ok) {
      return allocatedName
    }
    identity = allocatedIdentity.value
    name = allocatedName.value
  }
  const stateDirectory = projectStateDirectory(identity, paths.home)
  const registered = registration !== undefined

  const globalState = await readOptionalFile(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
  }
  if (registered && !globalState.value.exists) {
    return missingConfiguration('global', paths.globalConfiguration)
  }

  let globalConfiguration: GlobalConfiguration
  let globalChanged = false
  if (globalState.value.exists) {
    const parsedGlobal = parseGlobalConfiguration(globalState.value.content, catalog)
    if (!parsedGlobal.ok) {
      return parsedGlobal
    }
    globalConfiguration = parsedGlobal.value
  } else if (input.initialGlobalConfiguration !== undefined) {
    const initialGlobal = validateGlobalObject(input.initialGlobalConfiguration, catalog)
    if (!initialGlobal.ok) {
      return initialGlobal
    }
    globalConfiguration = initialGlobal.value
    globalChanged = true
  } else {
    globalConfiguration = defaultGlobalConfiguration(catalog)
    if (input.prompt?.editGlobal) {
      const editedGlobal = await input.prompt.editGlobal(globalConfiguration, catalog)
      const checkedGlobal = validateGlobalObject(editedGlobal, catalog)
      if (!checkedGlobal.ok) {
        return checkedGlobal
      }
      globalConfiguration = checkedGlobal.value
    }
    globalChanged = true
  }

  const localPath = join(stateDirectory, 'config.yaml')
  const localState = registered
    ? await readOptionalFile(localPath)
    : success<{ readonly exists: boolean; readonly content: string }>({
        exists: false,
        content: '',
      })
  if (!localState.ok) {
    return localState
  }
  if (registered && !localState.value.exists) {
    return missingConfiguration('local', localPath)
  }

  let localConfiguration: LocalConfiguration
  let localChanged = false
  if (localState.value.exists) {
    const parsedLocal = parseLocalConfiguration(
      localState.value.content,
      globalConfiguration,
      catalog,
    )
    if (!parsedLocal.ok) {
      return parsedLocal
    }
    localConfiguration = parsedLocal.value
  } else if (input.initialLocalConfiguration !== undefined) {
    const initialLocal = validateLocalObject(
      input.initialLocalConfiguration,
      globalConfiguration,
      catalog,
    )
    if (!initialLocal.ok) {
      return initialLocal
    }
    localConfiguration = initialLocal.value
    localChanged = true
  } else {
    localConfiguration = defaultLocalConfiguration(globalConfiguration)
    if (input.prompt?.editLocal) {
      const editedLocal = await input.prompt.editLocal(
        localConfiguration,
        catalog,
        globalConfiguration,
      )
      const checkedLocal = validateLocalObject(editedLocal, globalConfiguration, catalog)
      if (!checkedLocal.ok) {
        return checkedLocal
      }
      localConfiguration = checkedLocal.value
    }
    localChanged = true
  }

  const composeWrite = await composeStateWrite({
    projectRoot,
    sandboxName: name,
    stateDirectory,
    devboxHome: paths.home,
    globalConfiguration,
    localConfiguration,
  })
  if (!composeWrite.ok) {
    return composeWrite
  }

  if (registered) {
    if (
      !composeWrite.value.previous.exists ||
      composeWrite.value.content !== composeWrite.value.previous.content
    ) {
      const written = await writeStateTransaction([composeWrite.value])
      if (!written.ok) {
        return written
      }
    }
    return success({
      root: projectRoot,
      stateDirectory,
      sandboxName: name,
      created: false,
      confirmed: true,
    })
  }

  const confirm = input.confirm ?? input.prompt?.confirm ?? (async () => true)
  if (!(await confirm('Save configuration?'))) {
    return success({
      root: projectRoot,
      stateDirectory,
      sandboxName: name,
      created: false,
      confirmed: false,
    })
  }

  const nextRegistry: ProjectRegistry = {
    version: 1,
    projects: { ...registry.projects, [projectRoot]: { identity, name } },
  }
  const writes: StateWrite[] = [
    ...(globalChanged
      ? [
          {
            path: paths.globalConfiguration,
            content: serializeGlobalConfiguration(globalConfiguration),
            previous: globalState.value,
          },
        ]
      : []),
    ...(localChanged
      ? [
          {
            path: localPath,
            content: serializeLocalConfiguration(localConfiguration),
            previous: localState.value,
          },
        ]
      : []),
    {
      path: paths.projectRegistry,
      content: serializeProjectRegistry(nextRegistry),
      previous: registryState.value,
    },
    composeWrite.value,
  ]
  const written = await writeStateTransaction(writes)
  if (!written.ok) {
    return written
  }

  return success({
    root: projectRoot,
    stateDirectory,
    sandboxName: name,
    created: true,
    confirmed: true,
  })
}

export async function configureLocalProject(
  input: ConfigureLocalInput = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [input.root ?? process.cwd()],
      signal: input.signal,
    },
    () => configureLocalProjectUnlocked(input),
  )
}

async function configureLocalProjectUnlocked(
  input: ConfigureLocalInput = {},
): Promise<Result<ConfigurationOperation>> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog(input.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const projectRoot = input.root ?? process.cwd()
  const paths = devboxPaths(input.devboxHome)
  const registryCheck = await readRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registration = registryCheck.value.projects[projectRoot]
  if (registration === undefined) {
    return notRegistered(projectRoot)
  }

  const globalState = await readOptionalFile(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
  }
  if (!globalState.value.exists) {
    return missingConfiguration('global', paths.globalConfiguration)
  }
  const globalCheck = parseGlobalConfiguration(globalState.value.content, catalog)
  if (!globalCheck.ok) {
    return globalCheck
  }

  const stateDirectory = projectStateDirectory(registration.identity, paths.home)
  const localPath = join(stateDirectory, 'config.yaml')
  const localState = await readOptionalFile(localPath)
  if (!localState.ok) {
    return localState
  }
  if (!localState.value.exists) {
    return missingConfiguration('local', localPath)
  }
  const localCheck = parseLocalConfiguration(localState.value.content, globalCheck.value, catalog)
  if (!localCheck.ok) {
    return localCheck
  }

  let nextConfiguration = input.nextConfiguration ?? localCheck.value
  if (input.nextConfiguration === undefined && input.prompt?.editLocal) {
    nextConfiguration = await input.prompt.editLocal(localCheck.value, catalog, globalCheck.value)
  }
  const nextCheck = validateLocalObject(nextConfiguration, globalCheck.value, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }
  if (configurationsEqual(localCheck.value, nextCheck.value)) {
    return success({ scope: 'local', root: projectRoot, changed: false })
  }

  const confirm = input.confirm ?? input.prompt?.confirm ?? (async () => true)
  if (
    !(await confirm('Save Project configuration?', {
      title: 'Review configuration',
      sections: [
        {
          title: `Project: ${projectRoot}`,
          current: serializeLocalConfiguration(localCheck.value).trim(),
          next: serializeLocalConfiguration(nextCheck.value).trim(),
        },
      ],
    }))
  ) {
    return success({ scope: 'local', root: projectRoot, changed: false })
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const composeWrite = await composeStateWrite({
    projectRoot,
    sandboxName: registration.name,
    stateDirectory,
    devboxHome: paths.home,
    globalConfiguration: globalCheck.value,
    localConfiguration: nextCheck.value,
  })
  if (!composeWrite.ok) {
    return composeWrite
  }
  const written = await writeStateTransaction([
    {
      path: localPath,
      content: serializeLocalConfiguration(nextCheck.value),
      previous: localState.value,
    },
    composeWrite.value,
  ])
  if (!written.ok) {
    return written
  }
  return success({ scope: 'local', root: projectRoot, changed: true })
}

export async function configureGlobal(
  input: ConfigureGlobalInput = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [],
      signal: input.signal,
    },
    context => configureGlobalUnlocked(input, context),
  )
}

async function configureGlobalUnlocked(
  input: ConfigureGlobalInput = {},
  locks: StateLockContext,
): Promise<Result<ConfigurationOperation>> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog(input.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(input.devboxHome)
  const globalState = await readOptionalFile(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
  }

  let currentConfiguration: GlobalConfiguration
  if (globalState.value.exists) {
    const currentCheck = parseGlobalConfiguration(globalState.value.content, catalog)
    if (!currentCheck.ok) {
      return currentCheck
    }
    currentConfiguration = currentCheck.value
  } else {
    currentConfiguration = defaultGlobalConfiguration(catalog)
  }

  const registryState = await readOptionalFile(paths.projectRegistry)
  if (!registryState.ok) {
    return registryState
  }
  const registryCheck = registryState.value.exists
    ? parseProjectRegistry(registryState.value.content)
    : success<ProjectRegistry>({ version: 1, projects: {} })
  if (!registryCheck.ok) {
    return registryCheck
  }

  await locks.acquireProjectScopes(Object.keys(registryCheck.value.projects))

  let nextConfiguration = input.nextConfiguration ?? currentConfiguration
  if (input.nextConfiguration === undefined && input.prompt?.editGlobal) {
    nextConfiguration = await input.prompt.editGlobal(currentConfiguration, catalog)
  }
  const nextCheck = validateGlobalObject(nextConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }

  const localConfigurations = new Map<string, LocalConfiguration>()
  const localConfigurationSources = new Map<string, string>()
  for (const [root, registration] of Object.entries(registryCheck.value.projects)) {
    const localPath = join(paths.projects, registration.identity, 'config.yaml')
    const localState = await readOptionalFile(localPath)
    if (!localState.ok) {
      return localState
    }
    if (!localState.value.exists) {
      return missingConfiguration('local', localPath)
    }
    const localCheck = parseLocalConfiguration(
      localState.value.content,
      currentConfiguration,
      catalog,
    )
    if (!localCheck.ok) {
      return localCheck
    }
    localConfigurations.set(root, localCheck.value)
    localConfigurationSources.set(root, localState.value.content)
  }

  const removedNode = new Set(
    currentConfiguration.node.filter(entry => !nextCheck.value.node.includes(entry)),
  )
  const replacementConfigurations = new Map<string, LocalConfiguration>()
  for (const [root, localConfiguration] of localConfigurations) {
    if (localConfiguration.node === null || !removedNode.has(localConfiguration.node)) {
      continue
    }

    let replacement = input.nextLocalConfigurations?.[root]
    if (replacement === undefined && input.prompt?.editLocal) {
      replacement = await input.prompt.editLocal(
        localConfiguration,
        catalog,
        nextCheck.value,
        false,
      )
    }
    if (replacement === undefined) {
      return failure({
        kind: 'validation',
        code: 'node-replacement-required',
        observed: `Global Node Runtime ${localConfiguration.node} is selected by Project ${root}.`,
        nextAction: `Select a replacement Node Runtime or none for Project ${root}.`,
      })
    }
    const replacementCheck = validateLocalObject(replacement, nextCheck.value, catalog)
    if (!replacementCheck.ok) {
      return replacementCheck
    }
    replacementConfigurations.set(root, replacementCheck.value)
  }

  const globalChanged =
    !globalState.value.exists || !configurationsEqual(currentConfiguration, nextCheck.value)
  if (!globalChanged && replacementConfigurations.size === 0) {
    return success({ scope: 'global', changed: false })
  }

  const confirm = input.confirm ?? input.prompt?.confirm ?? (async () => true)
  if (
    !(await confirm('Save Global configuration?', {
      title: 'Review configuration',
      sections: [
        {
          title: 'Global configuration',
          current: serializeGlobalConfiguration(currentConfiguration).trim(),
          next: serializeGlobalConfiguration(nextCheck.value).trim(),
        },
        ...[...replacementConfigurations].map(([root, configuration]) => ({
          title: `Project: ${root}`,
          current: serializeLocalConfiguration(localConfigurations.get(root)!).trim(),
          next: serializeLocalConfiguration(configuration).trim(),
        })),
      ],
    }))
  ) {
    return success({ scope: 'global', changed: false })
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const composeWrites: StateWrite[] = []
  for (const [root, registration] of Object.entries(registryCheck.value.projects)) {
    const composeWrite = await composeStateWrite({
      projectRoot: root,
      sandboxName: registration.name,
      stateDirectory: projectStateDirectory(registration.identity, paths.home),
      devboxHome: paths.home,
      globalConfiguration: nextCheck.value,
      localConfiguration: replacementConfigurations.get(root) ?? localConfigurations.get(root)!,
    })
    if (!composeWrite.ok) {
      return composeWrite
    }
    if (
      !composeWrite.value.previous.exists ||
      composeWrite.value.content !== composeWrite.value.previous.content
    ) {
      composeWrites.push(composeWrite.value)
    }
  }

  const written = await writeStateTransaction([
    {
      path: paths.globalConfiguration,
      content: serializeGlobalConfiguration(nextCheck.value),
      previous: globalState.value,
    },
    ...[...replacementConfigurations].map(([root, configuration]) => ({
      path: join(paths.projects, registryCheck.value.projects[root]!.identity, 'config.yaml'),
      content: serializeLocalConfiguration(configuration),
      previous: { exists: true, content: localConfigurationSources.get(root)! },
    })),
    ...composeWrites,
  ])
  if (!written.ok) {
    return written
  }
  return success({ scope: 'global', changed: true })
}
export async function removeProject(
  input: RemoveProjectInput = {},
): Promise<Result<ProjectRemoval>> {
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [input.root ?? process.cwd()],
      signal: input.signal,
    },
    () => removeProjectUnlocked(input),
  )
}

async function removeProjectUnlocked(
  input: RemoveProjectInput = {},
): Promise<Result<ProjectRemoval>> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const projectRoot = input.root ?? process.cwd()
  const rootCheck = await validateProjectRoot(projectRoot)
  if (!rootCheck.ok) {
    return rootCheck
  }

  const paths = devboxPaths(input.devboxHome)
  const registryCheck = await readRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registration = registryCheck.value.projects[projectRoot]
  if (registration === undefined) {
    return notRegistered(projectRoot)
  }
  if (!input.yes) {
    const confirm = input.confirm ?? (async () => false)
    if (!(await confirm(`Remove Project ${projectRoot} and its Devbox state?`))) {
      return success({ root: projectRoot, removed: false })
    }
  }

  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const stateDirectory = projectStateDirectory(registration.identity, paths.home)
  try {
    await rm(stateDirectory, { recursive: true, force: true })
  } catch {
    return failure({
      kind: 'operational',
      code: 'project-state-removal-failed',
      observed: `Devbox could not remove Project state: ${stateDirectory}.`,
      nextAction: 'Check write access to ~/.devbox and run devbox rm --yes again.',
    })
  }

  const projects = { ...registryCheck.value.projects }
  delete projects[projectRoot]
  const written = await writeAtomically(
    paths.projectRegistry,
    serializeProjectRegistry({ version: 1, projects }),
  )
  if (!written.ok) {
    return written
  }
  return success({ root: projectRoot, removed: true })
}

export async function cleanupMissingProjects(
  input: CleanupMissingProjectsInput = {},
): Promise<Result<MissingProjectsCleanup>> {
  const devboxHome = input.devboxHome ?? join(homedir(), '.devbox')
  return withStateLocks(
    { devboxHome, global: true, projectRoots: [], signal: input.signal },
    async locks => {
      const discovery = await discoverMissingProjects(input)
      if (!discovery.ok) {
        return discovery
      }
      await locks.acquireProjectScopes(discovery.value.missingRoots)
      return cleanupMissingProjectsUnlocked(input, discovery.value)
    },
  )
}

interface MissingProjectsDiscovery {
  readonly paths: DevboxPaths
  readonly registry: ProjectRegistry
  readonly missingRoots: readonly string[]
}

async function discoverMissingProjects(
  input: CleanupMissingProjectsInput,
): Promise<Result<MissingProjectsDiscovery>> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const paths = devboxPaths(input.devboxHome)
  const registryState = await readOptionalFile(paths.projectRegistry)
  if (!registryState.ok) {
    return registryState
  }
  if (!registryState.value.exists) {
    return success({
      paths,
      registry: { version: 1, projects: {} },
      missingRoots: [],
    })
  }
  const registryCheck = parseProjectRegistry(registryState.value.content)
  if (!registryCheck.ok) {
    return registryCheck
  }

  const missingRoots: string[] = []
  for (const root of Object.keys(registryCheck.value.projects)) {
    if (input.signal?.aborted) {
      throw new InterruptedError()
    }
    const exists = await projectRootExists(root)
    if (exists === undefined) {
      return failure({
        kind: 'operational',
        code: 'project-root-observation-failed',
        observed: `Devbox could not inspect Project root: ${root}.`,
        nextAction: 'Check access to the registered Project root and try cleanup again.',
      })
    }
    if (!exists) {
      missingRoots.push(root)
    }
  }
  return success({ paths, registry: registryCheck.value, missingRoots })
}

async function cleanupMissingProjectsUnlocked(
  input: CleanupMissingProjectsInput,
  discovery: MissingProjectsDiscovery,
): Promise<Result<MissingProjectsCleanup>> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  if (discovery.missingRoots.length === 0) {
    return success({ roots: [], removed: false })
  }

  if (!input.yes) {
    const confirm = input.confirm ?? (async () => false)
    if (
      !(await confirm(
        `Remove Missing-root Project registrations?\n${discovery.missingRoots.map(root => `- ${root}`).join('\n')}`,
      ))
    ) {
      return success({ roots: [], removed: false })
    }
  }

  const removedRoots: string[] = []
  const projects = { ...discovery.registry.projects }
  for (const root of discovery.missingRoots) {
    const rootExists = await projectRootExists(root)
    if (rootExists === undefined) {
      return failure({
        kind: 'operational',
        code: 'project-root-observation-failed',
        observed: `Devbox could not recheck Project root: ${root}.`,
        nextAction: 'Check access to the registered Project root and try cleanup again.',
      })
    }
    if (rootExists) {
      continue
    }
    const registration = projects[root]
    if (registration === undefined) {
      continue
    }
    try {
      await rm(projectStateDirectory(registration.identity, discovery.paths.home), {
        recursive: true,
        force: true,
      })
    } catch {
      return failure({
        kind: 'operational',
        code: 'missing-project-state-removal-failed',
        observed: `Devbox could not remove Missing-root Project state for ${root}.`,
        nextAction: 'Check write access to ~/.devbox and try cleanup again.',
      })
    }
    delete projects[root]
    removedRoots.push(root)
  }

  if (removedRoots.length === 0) {
    return success({ roots: [], removed: false })
  }
  const written = await writeAtomically(
    discovery.paths.projectRegistry,
    serializeProjectRegistry({ version: 1, projects }),
  )
  if (!written.ok) {
    return written
  }
  return success({ roots: removedRoots, removed: true })
}

export async function runSandboxLifecycle(
  command: SandboxLifecycleCommand,
  input: SandboxLifecycleInput = {},
): Promise<SandboxLifecycleResult> {
  const projectRoot = input.root ?? process.cwd()
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: false,
      projectRoots: [projectRoot],
      signal: input.signal,
    },
    () => runSandboxLifecycleUnlocked(command, input, projectRoot),
  )
}

async function runSandboxLifecycleUnlocked(
  command: SandboxLifecycleCommand,
  input: SandboxLifecycleInput,
  projectRoot: string,
): Promise<SandboxLifecycleResult> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const rootCheck = await validateProjectRoot(projectRoot)
  if (!rootCheck.ok) {
    return rootCheck
  }

  const paths = devboxPaths(input.devboxHome)
  const registryCheck = await readRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registration = registryCheck.value.projects[projectRoot]
  if (registration === undefined) {
    return notRegistered(projectRoot)
  }

  const environment = input.environment ?? currentHostEnvironment()
  if (command === 'up') {
    const globalState = await readOptionalFile(paths.globalConfiguration)
    if (!globalState.ok) {
      return globalState
    }
    if (!globalState.value.exists) {
      return missingConfiguration('global', paths.globalConfiguration)
    }
    const globalCheck = parseGlobalConfiguration(globalState.value.content)
    if (!globalCheck.ok) {
      return globalCheck
    }
    await ensureSharedAgentVolumes(globalCheck.value.agent, environment)
  }

  const composePath = join(projectStateDirectory(registration.identity, paths.home), 'compose.yaml')
  const operation =
    command === 'up'
      ? ['up', '-d']
      : command === 'sh'
        ? ['exec', '--user', 'devbox', 'devbox', 'bash']
        : [command]
  await (environment.runDirect ?? environment.run)('docker', [
    'compose',
    '--file',
    composePath,
    ...operation,
  ])
  return success(undefined)
}

async function validateProjectRoot(projectRoot: string): Promise<Result<void>> {
  if (!isAbsolute(projectRoot)) {
    return failure({
      kind: 'validation',
      code: 'invalid-project-root',
      observed: `The current Project directory is not absolute: ${projectRoot}.`,
      nextAction: 'Run the command from an existing directory.',
    })
  }

  try {
    const metadata = await lstat(projectRoot)
    if (!metadata.isDirectory()) {
      return failure({
        kind: 'validation',
        code: 'invalid-project-root',
        observed: `The current Project path is not a directory: ${projectRoot}.`,
        nextAction: 'Run the command from an existing directory.',
      })
    }
  } catch {
    return failure({
      kind: 'validation',
      code: 'missing-project-root',
      observed: `The current Project directory does not exist: ${projectRoot}.`,
      nextAction: 'Change to an existing directory and run the command again.',
    })
  }

  return success(undefined)
}

async function readRegistry(path: string): Promise<Result<ProjectRegistry>> {
  const state = await readOptionalFile(path)
  if (!state.ok) {
    return state
  }
  if (!state.value.exists) {
    return failure({
      kind: 'validation',
      code: 'project-not-registered',
      observed: 'No Project registry exists for this Devbox installation.',
      nextAction: 'Run devbox init from the exact Project directory first.',
    })
  }
  return parseProjectRegistry(state.value.content)
}

async function allocateSandboxIdentity(
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

function allocateSandboxName(projectRoot: string, registry: ProjectRegistry): Result<string> {
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

async function projectRootExists(projectRoot: string): Promise<boolean | undefined> {
  try {
    return (await lstat(projectRoot)).isDirectory()
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    return undefined
  }
}

async function readOptionalFile(
  path: string,
): Promise<Result<{ readonly exists: boolean; readonly content: string }>> {
  try {
    return success({ exists: true, content: await readFile(path, 'utf8') })
  } catch (error) {
    if (isMissingFileError(error)) {
      return success({ exists: false, content: '' })
    }
    return failure({
      kind: 'operational',
      code: 'state-read-failed',
      observed: `Devbox could not read state file: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and try again.',
    })
  }
}

async function writeAtomically(path: string, content: string): Promise<Result<void>> {
  const staged = await stageStateWrite(path, content, 'tmp')
  if (!staged.ok) {
    return staged
  }
  try {
    await rename(staged.value, path)
    return success(undefined)
  } catch {
    await rm(staged.value, { force: true }).catch(() => undefined)
    return failure({
      kind: 'operational',
      code: 'state-write-failed',
      observed: `Devbox could not atomically write state file: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and run the command again.',
    })
  }
}

async function stageStateWrite(
  path: string,
  content: string,
  suffix: string,
): Promise<Result<string>> {
  const directory = dirname(path)
  const temporaryPath = join(
    directory,
    `.${basename(path)}-${process.pid}-${randomUUID()}.${suffix}`,
  )
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return success(temporaryPath)
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    return failure({
      kind: 'operational',
      code: 'state-write-failed',
      observed: `Devbox could not atomically write state file: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and run the command again.',
    })
  }
}

async function composeStateWrite(input: {
  readonly projectRoot: string
  readonly sandboxName: string
  readonly stateDirectory: string
  readonly devboxHome: string
  readonly globalConfiguration: GlobalConfiguration
  readonly localConfiguration: LocalConfiguration
}): Promise<Result<StateWrite>> {
  const claudeHostConfiguration = await ensureClaudeHostConfiguration(
    input.devboxHome,
    input.globalConfiguration,
  )
  if (!claudeHostConfiguration.ok) {
    return claudeHostConfiguration
  }

  const rendered = renderProjectCompose({
    projectRoot: input.projectRoot,
    sandboxName: input.sandboxName,
    selectedNode: input.localConfiguration.node,
    configuredAgents: input.globalConfiguration.agent,
    agentNotifications: input.globalConfiguration.agent_notifications,
    claudeHostConfiguration: claudeHostConfiguration.value,
    ports: input.localConfiguration.ports,
  })
  if (!rendered.ok) {
    return rendered
  }
  const path = join(input.stateDirectory, 'compose.yaml')
  const previous = await readOptionalFile(path)
  if (!previous.ok) {
    return previous
  }
  return success({ path, content: rendered.value, previous: previous.value })
}

async function ensureClaudeHostConfiguration(
  devboxHome: string,
  globalConfiguration: GlobalConfiguration,
): Promise<Result<string | undefined>> {
  if (!globalConfiguration.agent.includes('claude-code')) {
    return success(undefined)
  }

  const path = devboxPaths(devboxHome).claudeHostConfiguration
  try {
    const metadata = await lstat(path)
    if (metadata.isFile()) {
      return success(path)
    }
    return failure({
      kind: 'operational',
      code: 'claude-host-configuration-invalid',
      observed: `Claude host configuration is not a regular file: ${path}.`,
      nextAction: 'Replace it with a regular file, then run the command again.',
    })
  } catch (error) {
    if (!isMissingFileError(error)) {
      return failure({
        kind: 'operational',
        code: 'claude-host-configuration-unreadable',
        observed: `Devbox could not inspect Claude host configuration: ${path}.`,
        nextAction: 'Check access to ~/.devbox and run the command again.',
      })
    }
  }

  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, '{}\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return success(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return ensureClaudeHostConfiguration(devboxHome, globalConfiguration)
    }
    return failure({
      kind: 'operational',
      code: 'claude-host-configuration-write-failed',
      observed: `Devbox could not create Claude host configuration: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and run the command again.',
    })
  }
}

interface StateWrite {
  readonly path: string
  readonly content: string
  readonly previous: { readonly exists: boolean; readonly content: string }
}

async function writeStateTransaction(writes: readonly StateWrite[]): Promise<Result<void>> {
  const staged: Array<{ readonly write: StateWrite; readonly path: string }> = []
  for (const write of writes) {
    const stagedWrite = await stageStateWrite(write.path, write.content, 'transaction.tmp')
    if (!stagedWrite.ok) {
      await Promise.all(staged.map(stage => rm(stage.path, { force: true }).catch(() => undefined)))
      return stagedWrite
    }
    staged.push({ write, path: stagedWrite.value })
  }

  const published: StateWrite[] = []
  try {
    for (const stage of staged) {
      await rename(stage.path, stage.write.path)
      published.push(stage.write)
    }
    return success(undefined)
  } catch {
    let restored = true
    for (const write of published.reverse()) {
      if (write.previous.exists) {
        const restoredWrite = await writeAtomically(write.path, write.previous.content)
        restored &&= restoredWrite.ok
      } else {
        try {
          await rm(write.path, { force: true })
        } catch {
          restored = false
        }
      }
    }
    await Promise.all(staged.map(stage => rm(stage.path, { force: true }).catch(() => undefined)))
    return failure({
      kind: 'operational',
      code: 'state-write-failed',
      observed: restored
        ? 'Devbox could not publish Project state; the previous state was restored.'
        : 'Devbox could not publish Project state or restore the previous state.',
      nextAction: 'Check write access to ~/.devbox and run the command again.',
    })
  }
}

function validateGlobalObject(
  configuration: GlobalConfiguration,
  catalog: RuntimeCatalog,
): Result<GlobalConfiguration> {
  try {
    return parseGlobalConfiguration(serializeGlobalConfiguration(configuration), catalog)
  } catch {
    return failure({
      kind: 'validation',
      code: 'invalid-global-configuration',
      observed: 'Global configuration has invalid values.',
      nextAction: 'Edit the supported version-1 Global YAML configuration and try again.',
    })
  }
}

function validateLocalObject(
  configuration: LocalConfiguration,
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog,
): Result<LocalConfiguration> {
  try {
    return parseLocalConfiguration(
      serializeLocalConfiguration(configuration),
      globalConfiguration,
      catalog,
    )
  } catch {
    return failure({
      kind: 'validation',
      code: 'invalid-local-configuration',
      observed: 'Local configuration has invalid values.',
      nextAction: 'Edit the supported version-1 Local YAML configuration and try again.',
    })
  }
}

function notRegistered(projectRoot: string): Result<never> {
  return failure({
    kind: 'validation',
    code: 'project-not-registered',
    observed: `The exact Project directory is not registered: ${projectRoot}.`,
    nextAction: 'Run devbox init from this exact existing directory first.',
  })
}

function missingConfiguration(scope: 'global' | 'local', path: string): Result<never> {
  return failure({
    kind: 'validation',
    code: `missing-${scope}-configuration`,
    observed: `Devbox could not find the ${scope} configuration: ${path}.`,
    nextAction: `Restore the supported version-1 ${scope} YAML configuration and try again.`,
  })
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export class InterruptedError extends Error {
  public constructor() {
    super('Devbox command interrupted.')
  }
}
