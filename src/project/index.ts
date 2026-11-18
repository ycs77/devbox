import { lstat, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, parse, relative, sep } from 'node:path'
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
import type { ConfigurationPrompter, ConfirmationHandler } from '../configuration/prompter.js'
import { currentHostEnvironment, type HostEnvironment, validateSupportedHost } from '../host.js'
import { failure, InterruptedError, success, type Result } from '../result.js'
import { withStateLocks, type StateLockContext } from '../state-lock/index.js'
import {
  prepareSandboxDefinition,
  publishProjectState,
  readOptionalFile,
  writeAtomically,
  type FileState,
} from './publication.js'
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
  readonly globalConfigurationCreated: boolean
  readonly confirmed: boolean
}

export interface DevboxPaths {
  readonly home: string
  readonly globalConfiguration: string
  readonly projectRegistry: string
  readonly projects: string
  readonly buildContext: string
  readonly claudeHostConfiguration: string
}

export interface InitializeProjectInput {
  readonly root?: string
  readonly initialGlobalConfiguration?: GlobalConfiguration
  readonly initialLocalConfiguration?: LocalConfiguration
}

export interface InitializeProjectDependencies {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
  readonly validateHost?: () => Promise<Result<void>>
}

export interface ConfigureLocalInput {
  readonly root?: string
  readonly nextConfiguration?: LocalConfiguration
}

export interface ConfigureLocalDependencies {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
}

export interface ConfigureGlobalInput {
  readonly nextConfiguration?: GlobalConfiguration
  readonly nextLocalConfigurations?: Readonly<Record<string, LocalConfiguration>>
}

export interface ConfigureGlobalDependencies {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly prompt?: ConfigurationPrompter
}

export interface RemoveProjectInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly confirm?: ConfirmationHandler
  readonly yes?: boolean
  readonly environment?: HostEnvironment
}

export type SandboxLifecycleCommand = 'up' | 'down' | 'stop'

type SandboxCommand = SandboxLifecycleCommand | 'sh'

export interface SandboxCommandInput {
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

export type SandboxCommandResult = Result<void>

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
  dependencies: InitializeProjectDependencies = {},
): Promise<Result<RegisteredProject>> {
  return withStateLocks(
    {
      devboxHome: dependencies.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [input.root ?? process.cwd()],
      signal: dependencies.signal,
    },
    () => initializeProjectUnlocked(input, dependencies),
  )
}

async function initializeProjectUnlocked(
  input: InitializeProjectInput,
  dependencies: InitializeProjectDependencies,
): Promise<Result<RegisteredProject>> {
  const projectRoot = input.root ?? process.cwd()
  const rootCheck = await validateProjectRoot(projectRoot)
  if (!rootCheck.ok) {
    return rootCheck
  }
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }

  const hostCheck = await (dependencies.validateHost ?? validateSupportedHost)()
  if (!hostCheck.ok) {
    return hostCheck
  }
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }

  const catalogCheck = normalizeCatalog(dependencies.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(dependencies.devboxHome)
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
  if (registration !== undefined) {
    return success({
      root: projectRoot,
      stateDirectory: projectStateDirectory(registration.identity, paths.home),
      sandboxName: registration.name,
      created: false,
      globalConfigurationCreated: false,
      confirmed: true,
    })
  }

  const allocatedIdentity = await allocateSandboxIdentity(projectRoot, paths, registry)
  if (!allocatedIdentity.ok) {
    return allocatedIdentity
  }
  const allocatedName = allocateSandboxName(projectRoot, registry)
  if (!allocatedName.ok) {
    return allocatedName
  }
  const identity = allocatedIdentity.value
  const name = allocatedName.value
  const stateDirectory = projectStateDirectory(identity, paths.home)

  const globalState = await readOptionalFile(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
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
    if (dependencies.prompt) {
      const editedGlobal = await dependencies.prompt.editGlobal(globalConfiguration, catalog)
      const checkedGlobal = validateGlobalObject(editedGlobal, catalog)
      if (!checkedGlobal.ok) {
        return checkedGlobal
      }
      globalConfiguration = checkedGlobal.value
    }
    globalChanged = true
  }

  let localConfiguration: LocalConfiguration
  if (input.initialLocalConfiguration !== undefined) {
    const initialLocal = validateLocalObject(
      input.initialLocalConfiguration,
      globalConfiguration,
      catalog,
    )
    if (!initialLocal.ok) {
      return initialLocal
    }
    localConfiguration = initialLocal.value
  } else {
    localConfiguration = defaultLocalConfiguration(globalConfiguration)
    if (dependencies.prompt) {
      const editedLocal = await dependencies.prompt.editLocal(
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
  }

  const definition = await prepareSandboxDefinition(paths.home, globalConfiguration, {
    root: projectRoot,
    name,
    stateDirectory,
    localConfiguration,
  })
  if (!definition.ok) {
    return definition
  }

  if (dependencies.prompt && !(await dependencies.prompt.confirm('Save configuration?'))) {
    return success({
      root: projectRoot,
      stateDirectory,
      sandboxName: name,
      created: false,
      globalConfigurationCreated: false,
      confirmed: false,
    })
  }

  const nextRegistry: ProjectRegistry = {
    version: 1,
    projects: { ...registry.projects, [projectRoot]: { identity, name } },
  }
  const written = await publishProjectState({
    devboxHome: paths.home,
    globalConfiguration,
    globalPrevious: globalChanged ? globalState.value : undefined,
    registry: { value: nextRegistry, previous: registryState.value },
    projects: [
      {
        root: projectRoot,
        name,
        stateDirectory,
        localConfiguration,
        localPrevious: { exists: false, content: '' },
        preparedDefinition: definition.value,
      },
    ],
  })
  if (!written.ok) {
    return written
  }

  return success({
    root: projectRoot,
    stateDirectory,
    sandboxName: name,
    created: true,
    globalConfigurationCreated: globalChanged,
    confirmed: true,
  })
}

export async function configureLocalProject(
  input: ConfigureLocalInput = {},
  dependencies: ConfigureLocalDependencies = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: dependencies.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [input.root ?? process.cwd()],
      signal: dependencies.signal,
    },
    () => configureLocalProjectUnlocked(input, dependencies),
  )
}

async function configureLocalProjectUnlocked(
  input: ConfigureLocalInput,
  dependencies: ConfigureLocalDependencies,
): Promise<Result<ConfigurationOperation>> {
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog(dependencies.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const projectRoot = input.root ?? process.cwd()
  const paths = devboxPaths(dependencies.devboxHome)
  const registryCheck = await readRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registration = registryCheck.value.projects[projectRoot]
  if (registration === undefined) {
    return notRegistered(projectRoot)
  }

  const globalState = await readOptionalGlobalConfiguration(paths.globalConfiguration, catalog)
  if (!globalState.ok) {
    return globalState
  }
  const globalConfiguration = globalState.value.configuration
  if (globalConfiguration === undefined) {
    return missingConfiguration('global', paths.globalConfiguration)
  }

  const stateDirectory = projectStateDirectory(registration.identity, paths.home)
  const localPath = join(stateDirectory, 'config.yaml')
  const localState = await readLocalConfiguration(localPath, globalConfiguration, catalog)
  if (!localState.ok) {
    return localState
  }
  const currentConfiguration = localState.value.configuration

  let nextConfiguration = input.nextConfiguration ?? currentConfiguration
  if (input.nextConfiguration === undefined && dependencies.prompt) {
    nextConfiguration = await dependencies.prompt.editLocal(
      currentConfiguration,
      catalog,
      globalConfiguration,
    )
  }
  const nextCheck = validateLocalObject(nextConfiguration, globalConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }
  const localChanged = !configurationsEqual(currentConfiguration, nextCheck.value)

  const confirm = dependencies.prompt?.confirm ?? (async () => true)
  if (
    !(await confirm('Save Project configuration?', {
      title: 'Review configuration',
      sections: [
        {
          title: `Project: ${projectRoot}`,
          current: serializeLocalConfiguration(currentConfiguration).trim(),
          next: serializeLocalConfiguration(nextCheck.value).trim(),
        },
      ],
    }))
  ) {
    return success({ scope: 'local', root: projectRoot, changed: false })
  }
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await publishProjectState({
    devboxHome: paths.home,
    globalConfiguration,
    projects: [
      {
        root: projectRoot,
        name: registration.name,
        stateDirectory,
        localConfiguration: nextCheck.value,
        localPrevious: localChanged ? localState.value.state : undefined,
      },
    ],
  })
  if (!written.ok) {
    return written
  }
  return success({ scope: 'local', root: projectRoot, changed: written.value })
}

export async function configureGlobal(
  input: ConfigureGlobalInput = {},
  dependencies: ConfigureGlobalDependencies = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: dependencies.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [],
      signal: dependencies.signal,
    },
    context => configureGlobalUnlocked(input, dependencies, context),
  )
}

async function configureGlobalUnlocked(
  input: ConfigureGlobalInput,
  dependencies: ConfigureGlobalDependencies,
  locks: StateLockContext,
): Promise<Result<ConfigurationOperation>> {
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog(dependencies.catalog)
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(dependencies.devboxHome)
  const globalState = await readOptionalGlobalConfiguration(paths.globalConfiguration, catalog)
  if (!globalState.ok) {
    return globalState
  }
  const currentConfiguration =
    globalState.value.configuration ?? defaultGlobalConfiguration(catalog)

  const registryCheck = await readOptionalRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registry: ProjectRegistry = registryCheck.value ?? { version: 1, projects: {} }

  await locks.acquireProjectScopes(Object.keys(registry.projects))

  let nextConfiguration = input.nextConfiguration ?? currentConfiguration
  if (input.nextConfiguration === undefined && dependencies.prompt) {
    nextConfiguration = await dependencies.prompt.editGlobal(currentConfiguration, catalog)
  }
  const nextCheck = validateGlobalObject(nextConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }

  const localConfigurations = new Map<string, LocalConfiguration>()
  const localConfigurationSources = new Map<string, string>()
  for (const [root, registration] of Object.entries(registry.projects)) {
    const localPath = join(paths.projects, registration.identity, 'config.yaml')
    const localState = await readLocalConfiguration(localPath, currentConfiguration, catalog)
    if (!localState.ok) {
      return localState
    }
    localConfigurations.set(root, localState.value.configuration)
    localConfigurationSources.set(root, localState.value.state.content)
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
    if (replacement === undefined && dependencies.prompt) {
      replacement = await dependencies.prompt.selectNodeReplacement(
        localConfiguration,
        nextCheck.value,
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
    !globalState.value.state.exists || !configurationsEqual(currentConfiguration, nextCheck.value)

  const confirm = dependencies.prompt?.confirm ?? (async () => true)
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
  if (dependencies.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await publishProjectState({
    devboxHome: paths.home,
    globalConfiguration: nextCheck.value,
    globalPrevious: globalChanged ? globalState.value.state : undefined,
    projects: Object.entries(registry.projects).map(([root, registration]) => ({
      root,
      name: registration.name,
      stateDirectory: projectStateDirectory(registration.identity, paths.home),
      localConfiguration: replacementConfigurations.get(root) ?? localConfigurations.get(root)!,
      localPrevious: replacementConfigurations.has(root)
        ? { exists: true, content: localConfigurationSources.get(root)! }
        : undefined,
    })),
  })
  if (!written.ok) {
    return written
  }
  return success({ scope: 'global', changed: written.value })
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
    if (!(await confirm(`Remove Project ${projectRoot}, its Sandbox, and Devbox state?`))) {
      return success({ root: projectRoot, removed: false })
    }
  }

  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const stateDirectory = projectStateDirectory(registration.identity, paths.home)
  const environment = input.environment ?? currentHostEnvironment()
  await (environment.runDirect ?? environment.run)('docker', [
    'compose',
    '--file',
    join(stateDirectory, 'compose.yaml'),
    'down',
  ])
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

export async function runSandboxLifecycle(
  command: SandboxLifecycleCommand,
  input: SandboxCommandInput = {},
): Promise<SandboxCommandResult> {
  const projectRoot = input.root ?? process.cwd()
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: false,
      projectRoots: [projectRoot],
      signal: input.signal,
    },
    () => runSandboxCommandUnlocked(command, input, projectRoot),
  )
}

export async function runSandboxShell(
  input: SandboxCommandInput = {},
): Promise<SandboxCommandResult> {
  return runSandboxCommandUnlocked('sh', input, input.root ?? process.cwd())
}

async function runSandboxCommandUnlocked(
  command: SandboxCommand,
  input: SandboxCommandInput,
  projectRoot: string,
): Promise<SandboxCommandResult> {
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
  const composePath = join(projectStateDirectory(registration.identity, paths.home), 'compose.yaml')
  if (command === 'up') {
    const composeState = await readOptionalFile(composePath)
    if (!composeState.ok) {
      return composeState
    }
    if (!composeState.value.exists) {
      return failure({
        kind: 'operational',
        code: 'missing-project-compose',
        observed: `Sandbox definition is missing: ${composePath}.`,
        nextAction: 'Run devbox config to publish the Sandbox definition, then retry devbox up.',
      })
    }
    const volumes = await ensureSharedAgentVolumes(composeState.value.content, environment)
    if (!volumes.ok) {
      return volumes
    }
  }
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
  const registry = await readOptionalRegistry(path)
  if (!registry.ok) {
    return registry
  }
  if (registry.value === undefined) {
    return failure({
      kind: 'validation',
      code: 'project-not-registered',
      observed: 'No Project registry exists for this Devbox installation.',
      nextAction: 'Run devbox init from the exact Project directory first.',
    })
  }
  return success(registry.value)
}

async function readOptionalRegistry(path: string): Promise<Result<ProjectRegistry | undefined>> {
  const state = await readOptionalFile(path)
  if (!state.ok) {
    return state
  }
  return state.value.exists ? parseProjectRegistry(state.value.content) : success(undefined)
}

async function readOptionalGlobalConfiguration(
  path: string,
  catalog: RuntimeCatalog,
): Promise<
  Result<{
    readonly configuration: GlobalConfiguration | undefined
    readonly state: FileState
  }>
> {
  const state = await readOptionalFile(path)
  if (!state.ok) {
    return state
  }
  if (!state.value.exists) {
    return success({ configuration: undefined, state: state.value })
  }
  const configuration = parseGlobalConfiguration(state.value.content, catalog)
  if (!configuration.ok) {
    return configuration
  }
  return success({ configuration: configuration.value, state: state.value })
}

async function readLocalConfiguration(
  path: string,
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog,
): Promise<
  Result<{
    readonly configuration: LocalConfiguration
    readonly state: FileState
  }>
> {
  const state = await readOptionalFile(path)
  if (!state.ok) {
    return state
  }
  if (!state.value.exists) {
    return missingConfiguration('local', path)
  }
  const configuration = parseLocalConfiguration(state.value.content, globalConfiguration, catalog)
  if (!configuration.ok) {
    return configuration
  }
  return success({ configuration: configuration.value, state: state.value })
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

