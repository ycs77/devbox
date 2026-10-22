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
import { currentHostEnvironment, type HostEnvironment, validateSupportedHost } from '../host.js'
import { failure, success, type Result } from '../result.js'
import { withStateLocks, type StateLockContext } from '../state-lock/index.js'
import {
  prepareSandboxDefinition,
  publishProjectState,
  readOptionalFile,
  writeAtomically,
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

  const definition = await prepareSandboxDefinition(paths.home, globalConfiguration, {
    root: projectRoot,
    name,
    stateDirectory,
    localConfiguration,
  })
  if (!definition.ok) {
    return definition
  }

  if (registered) {
    const written = await publishProjectState({
      devboxHome: paths.home,
      globalConfiguration,
      projects: [
        {
          root: projectRoot,
          name,
          stateDirectory,
          localConfiguration,
          preparedDefinition: definition.value,
          skipUnchangedDefinition: true,
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
      created: false,
      globalConfigurationCreated: false,
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
        localPrevious: localChanged ? localState.value : undefined,
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
  const written = await publishProjectState({
    devboxHome: paths.home,
    globalConfiguration: globalCheck.value,
    projects: [
      {
        root: projectRoot,
        name: registration.name,
        stateDirectory,
        localConfiguration: nextCheck.value,
        localPrevious: localState.value,
      },
    ],
  })
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
  const written = await publishProjectState({
    devboxHome: paths.home,
    globalConfiguration: nextCheck.value,
    globalPrevious: globalState.value,
    projects: Object.entries(registryCheck.value.projects).map(([root, registration]) => ({
      root,
      name: registration.name,
      stateDirectory: projectStateDirectory(registration.identity, paths.home),
      localConfiguration: replacementConfigurations.get(root) ?? localConfigurations.get(root)!,
      localPrevious: replacementConfigurations.has(root)
        ? { exists: true, content: localConfigurationSources.get(root)! }
        : undefined,
      skipUnchangedDefinition: true,
    })),
  })
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
