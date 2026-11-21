import type { ConfirmationHandler } from '../configuration/prompter.js'
import { lstat, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
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
import { confirm, editGlobal, editLocal, selectNodeReplacement } from '../configuration/prompter.js'
import { currentHostEnvironment, type HostEnvironment, validateSupportedHost } from '../host.js'
import { failure, InterruptedError, success, type Result } from '../result.js'
import { withStateLocks, type StateLockContext } from '../state-lock/index.js'
import { ProjectPublication, readOptionalText, writeAtomically } from './publication.js'
import {
  allocateSandboxIdentity,
  allocateSandboxName,
  devboxPaths,
  projectStateDirectory,
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

export interface InitializeProjectOptions {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
}

export interface ConfigureLocalOptions {
  readonly root?: string
  readonly devboxHome?: string
  readonly signal?: AbortSignal
}

export interface ConfigureGlobalOptions {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
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

export async function initializeProject(
  options: InitializeProjectOptions = {},
): Promise<Result<RegisteredProject>> {
  return withStateLocks(
    {
      devboxHome: options.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [options.root ?? process.cwd()],
      signal: options.signal,
    },
    () => initializeProjectUnlocked(options),
  )
}

async function initializeProjectUnlocked(
  options: InitializeProjectOptions,
): Promise<Result<RegisteredProject>> {
  const projectRoot = options.root ?? process.cwd()
  const rootCheck = await validateProjectRoot(projectRoot)
  if (!rootCheck.ok) {
    return rootCheck
  }
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }

  const hostCheck = await validateSupportedHost()
  if (!hostCheck.ok) {
    return hostCheck
  }
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }

  const catalogCheck = normalizeCatalog()
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(options.devboxHome)
  const publication = new ProjectPublication(paths.home)
  const registryCheck = await publication.readRegistry()
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registry = registryCheck.value ?? { version: 1, projects: {} }
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

  const globalCheck = await publication.readGlobal(catalog)
  if (!globalCheck.ok) {
    return globalCheck
  }

  let globalConfiguration: GlobalConfiguration
  let globalChanged = false
  if (globalCheck.value !== undefined) {
    globalConfiguration = globalCheck.value
  } else {
    const editedGlobal = await editGlobal(defaultGlobalConfiguration(catalog), catalog, {
      signal: options.signal,
    })
    const checkedGlobal = validateGlobalObject(editedGlobal, catalog)
    if (!checkedGlobal.ok) {
      return checkedGlobal
    }
    globalConfiguration = checkedGlobal.value
    globalChanged = true
  }

  const editedLocal = await editLocal(
    defaultLocalConfiguration(globalConfiguration),
    globalConfiguration,
    { signal: options.signal },
  )
  const checkedLocal = validateLocalObject(editedLocal, globalConfiguration, catalog)
  if (!checkedLocal.ok) {
    return checkedLocal
  }
  const localConfiguration = checkedLocal.value

  const definition = await publication.prepareDefinition(globalConfiguration, {
    root: projectRoot,
    name,
    stateDirectory,
    localConfiguration,
  })
  if (!definition.ok) {
    return definition
  }

  if (!(await confirm('Save configuration?', undefined, { signal: options.signal }))) {
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
  const written = await publication.publish({
    globalConfiguration,
    globalConfigurationChanged: globalChanged,
    registry: nextRegistry,
    projects: [
      {
        root: projectRoot,
        name,
        stateDirectory,
        localConfiguration,
        configurationChange: 'create',
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
  options: ConfigureLocalOptions = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: options.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [options.root ?? process.cwd()],
      signal: options.signal,
    },
    () => configureLocalProjectUnlocked(options),
  )
}

async function configureLocalProjectUnlocked(
  options: ConfigureLocalOptions,
): Promise<Result<ConfigurationOperation>> {
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog()
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const projectRoot = options.root ?? process.cwd()
  const paths = devboxPaths(options.devboxHome)
  const publication = new ProjectPublication(paths.home)
  const registryCheck = await readRegistry(paths.projectRegistry)
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registration = registryCheck.value.projects[projectRoot]
  if (registration === undefined) {
    return notRegistered(projectRoot)
  }

  const globalCheck = await publication.readGlobal(catalog)
  if (!globalCheck.ok) {
    return globalCheck
  }
  const globalConfiguration = globalCheck.value
  if (globalConfiguration === undefined) {
    return failure({
      kind: 'validation',
      code: 'missing-global-configuration',
      observed: `Devbox could not find the global configuration: ${paths.globalConfiguration}.`,
      nextAction: 'Restore the supported version-1 global YAML configuration and try again.',
    })
  }

  const stateDirectory = projectStateDirectory(registration.identity, paths.home)
  const localCheck = await publication.readLocal(stateDirectory, globalConfiguration, catalog)
  if (!localCheck.ok) {
    return localCheck
  }
  const currentConfiguration = localCheck.value

  const nextConfiguration = await editLocal(currentConfiguration, globalConfiguration, {
    signal: options.signal,
  })
  const nextCheck = validateLocalObject(nextConfiguration, globalConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }
  const localChanged = !configurationsEqual(currentConfiguration, nextCheck.value)

  if (
    !(await confirm(
      'Save Project configuration?',
      {
        title: 'Review configuration',
        sections: [
          {
            title: `Project: ${projectRoot}`,
            current: serializeLocalConfiguration(currentConfiguration).trim(),
            next: serializeLocalConfiguration(nextCheck.value).trim(),
          },
        ],
      },
      { signal: options.signal },
    ))
  ) {
    return success({ scope: 'local', root: projectRoot, changed: false })
  }
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await publication.publish({
    globalConfiguration,
    projects: [
      {
        root: projectRoot,
        name: registration.name,
        stateDirectory,
        localConfiguration: nextCheck.value,
        configurationChange: localChanged ? 'update' : 'none',
      },
    ],
  })
  if (!written.ok) {
    return written
  }
  return success({ scope: 'local', root: projectRoot, changed: written.value })
}

export async function configureGlobal(
  options: ConfigureGlobalOptions = {},
): Promise<Result<ConfigurationOperation>> {
  return withStateLocks(
    {
      devboxHome: options.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [],
      signal: options.signal,
    },
    context => configureGlobalUnlocked(options, context),
  )
}

async function configureGlobalUnlocked(
  options: ConfigureGlobalOptions,
  locks: StateLockContext,
): Promise<Result<ConfigurationOperation>> {
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }
  const catalogCheck = normalizeCatalog()
  if (!catalogCheck.ok) {
    return catalogCheck
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(options.devboxHome)
  const publication = new ProjectPublication(paths.home)
  const globalCheck = await publication.readGlobal(catalog)
  if (!globalCheck.ok) {
    return globalCheck
  }
  const currentConfiguration = globalCheck.value ?? defaultGlobalConfiguration(catalog)

  const registryCheck = await publication.readRegistry()
  if (!registryCheck.ok) {
    return registryCheck
  }
  const registry: ProjectRegistry = registryCheck.value ?? { version: 1, projects: {} }

  await locks.acquireProjectScopes(Object.keys(registry.projects))

  const nextConfiguration = await editGlobal(currentConfiguration, catalog, {
    signal: options.signal,
  })
  const nextCheck = validateGlobalObject(nextConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
  }

  const localConfigurations = new Map<string, LocalConfiguration>()
  for (const [root, registration] of Object.entries(registry.projects)) {
    const localCheck = await publication.readLocal(
      join(paths.projects, registration.identity),
      currentConfiguration,
      catalog,
    )
    if (!localCheck.ok) {
      return localCheck
    }
    localConfigurations.set(root, localCheck.value)
  }

  const removedNode = new Set(
    currentConfiguration.node.filter(entry => !nextCheck.value.node.includes(entry)),
  )
  const replacementConfigurations = new Map<string, LocalConfiguration>()
  for (const [root, localConfiguration] of localConfigurations) {
    if (localConfiguration.node === null || !removedNode.has(localConfiguration.node)) {
      continue
    }

    const replacement = await selectNodeReplacement(localConfiguration, nextCheck.value, {
      signal: options.signal,
    })
    const replacementCheck = validateLocalObject(replacement, nextCheck.value, catalog)
    if (!replacementCheck.ok) {
      return replacementCheck
    }
    replacementConfigurations.set(root, replacementCheck.value)
  }

  const globalChanged =
    globalCheck.value === undefined || !configurationsEqual(currentConfiguration, nextCheck.value)

  if (
    !(await confirm(
      'Save Global configuration?',
      {
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
      },
      { signal: options.signal },
    ))
  ) {
    return success({ scope: 'global', changed: false })
  }
  if (options.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await publication.publish({
    globalConfiguration: nextCheck.value,
    globalConfigurationChanged: globalChanged,
    projects: Object.entries(registry.projects).map(([root, registration]) => ({
      root,
      name: registration.name,
      stateDirectory: projectStateDirectory(registration.identity, paths.home),
      localConfiguration: replacementConfigurations.get(root) ?? localConfigurations.get(root)!,
      configurationChange: replacementConfigurations.has(root) ? 'update' : 'none',
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
    const composeState = await readOptionalText(composePath)
    if (!composeState.ok) {
      return composeState
    }
    if (composeState.value === undefined) {
      return failure({
        kind: 'operational',
        code: 'missing-project-compose',
        observed: `Sandbox definition is missing: ${composePath}.`,
        nextAction: 'Run devbox config to publish the Sandbox definition, then retry devbox up.',
      })
    }
    const volumes = await ensureSharedAgentVolumes(composeState.value, environment)
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
  const state = await readOptionalText(path)
  if (!state.ok) {
    return state
  }
  return state.value === undefined ? success(undefined) : parseProjectRegistry(state.value)
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
