import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path'
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
} from './configuration.js'
import { validateSupportedHost } from './host.js'
import {
  isSafeStateDirectoryName,
  parseProjectRegistry,
  serializeProjectRegistry,
  type ProjectRegistry,
} from './registry.js'
import { failure, success, type Result } from './result.js'
import { withStateLocks } from './state-lock.js'

export interface RegisteredProject {
  readonly root: string
  readonly stateDirectory: string
  readonly created: boolean
  readonly confirmed?: boolean
}

export interface DevboxPaths {
  readonly home: string
  readonly globalConfiguration: string
  readonly projectRegistry: string
  readonly projects: string
}

export interface ConfirmationDetails {
  readonly title: string
  readonly content: string
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

export function devboxPaths(devboxHome = join(homedir(), '.devbox')): DevboxPaths {
  return {
    home: devboxHome,
    globalConfiguration: join(devboxHome, 'config.yaml'),
    projectRegistry: join(devboxHome, 'projects.yaml'),
    projects: join(devboxHome, 'projects'),
  }
}

export function projectStateDirectory(projectRoot: string, devboxHome: string): string {
  const root = parse(projectRoot).root
  const pathWithinRoot = relative(root, projectRoot)

  if (
    !isAbsolute(projectRoot) ||
    pathWithinRoot === '..' ||
    pathWithinRoot.startsWith(`..${sep}`)
  ) {
    throw new TypeError('Project root must be an absolute path.')
  }

  const mirrorName =
    pathWithinRoot === '' ? 'root' : pathWithinRoot.split(sep).map(escapePathSegment).join('-')
  return join(devboxHome, 'projects', mirrorName)
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
  const assignedName = registry.projects[projectRoot]
  let stateDirectoryName: string
  if (assignedName !== undefined) {
    stateDirectoryName = assignedName
  } else {
    const allocatedName = await allocateStateDirectoryName(projectRoot, paths, registry)
    if (!allocatedName.ok) {
      return allocatedName
    }
    stateDirectoryName = allocatedName.value
  }
  const stateDirectory = join(paths.projects, stateDirectoryName)
  const registered = assignedName !== undefined

  const globalState = await readOptionalFile(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
  }
  if (registered && !globalState.value.exists) {
    return missingConfiguration('global', paths.globalConfiguration)
  }

  let globalConfiguration: GlobalConfiguration
  let globalChanged = false
  if (input.initialGlobalConfiguration !== undefined) {
    const initialGlobal = validateGlobalObject(input.initialGlobalConfiguration, catalog)
    if (!initialGlobal.ok) {
      return initialGlobal
    }
    globalConfiguration = initialGlobal.value
    globalChanged = !globalState.value.exists
  } else if (globalState.value.exists) {
    const parsedGlobal = parseGlobalConfiguration(globalState.value.content, catalog)
    if (!parsedGlobal.ok) {
      return parsedGlobal
    }
    globalConfiguration = parsedGlobal.value
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
    localChanged = !localState.value.exists
  } else if (localState.value.exists) {
    const parsedLocal = parseLocalConfiguration(
      localState.value.content,
      globalConfiguration,
      catalog,
    )
    if (!parsedLocal.ok) {
      return parsedLocal
    }
    localConfiguration = parsedLocal.value
  } else {
    localConfiguration = defaultLocalConfiguration(globalConfiguration, catalog)
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

  if (registered) {
    return success({
      root: projectRoot,
      stateDirectory,
      created: false,
      confirmed: true,
    })
  }

  const confirm = input.confirm ?? input.prompt?.confirm ?? (async () => true)
  if (!(await confirm(`Register Project ${projectRoot} and write its configuration?`))) {
    return success({
      root: projectRoot,
      stateDirectory,
      created: false,
      confirmed: false,
    })
  }

  if (globalChanged) {
    const writtenGlobal = await writeAtomically(
      paths.globalConfiguration,
      serializeGlobalConfiguration(globalConfiguration),
    )
    if (!writtenGlobal.ok) {
      return writtenGlobal
    }
  }
  if (localChanged) {
    try {
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    } catch {
      return stateDirectoryFailure(stateDirectory)
    }
    const writtenLocal = await writeAtomically(
      localPath,
      serializeLocalConfiguration(localConfiguration),
    )
    if (!writtenLocal.ok) {
      return writtenLocal
    }
  }

  const nextRegistry: ProjectRegistry = {
    version: 1,
    projects: { ...registry.projects, [projectRoot]: stateDirectoryName },
  }
  const writtenRegistry = await writeAtomically(
    paths.projectRegistry,
    serializeProjectRegistry(nextRegistry),
  )
  if (!writtenRegistry.ok) {
    return writtenRegistry
  }

  return success({
    root: projectRoot,
    stateDirectory,
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
  const stateDirectoryName = registryCheck.value.projects[projectRoot]
  if (stateDirectoryName === undefined) {
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

  const stateDirectory = join(paths.projects, stateDirectoryName)
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
  const changeSummary = `Current: ${serializeLocalConfiguration(localCheck.value).trim()}\nNext: ${serializeLocalConfiguration(nextCheck.value).trim()}`
  if (
    !(await confirm(`Save Local configuration for ${projectRoot}?`, {
      title: 'Local configuration changes',
      content: changeSummary,
    }))
  ) {
    return success({ scope: 'local', root: projectRoot, changed: false })
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await writeAtomically(localPath, serializeLocalConfiguration(nextCheck.value))
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
    () => configureGlobalUnlocked(input),
  )
}

async function configureGlobalUnlocked(
  input: ConfigureGlobalInput = {},
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

  let nextConfiguration = input.nextConfiguration ?? currentConfiguration
  if (input.nextConfiguration === undefined && input.prompt?.editGlobal) {
    nextConfiguration = await input.prompt.editGlobal(currentConfiguration, catalog)
  }
  const nextCheck = validateGlobalObject(nextConfiguration, catalog)
  if (!nextCheck.ok) {
    return nextCheck
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

  const localConfigurations = new Map<string, LocalConfiguration>()
  for (const [root, stateDirectoryName] of Object.entries(registryCheck.value.projects)) {
    const localPath = join(paths.projects, stateDirectoryName, 'config.yaml')
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
  }

  const removedRuntime = new Set<string>()
  for (const [family, entries] of Object.entries(currentConfiguration.runtimes)) {
    for (const entry of entries) {
      if (!nextCheck.value.runtimes[family]?.includes(entry)) {
        removedRuntime.add(`${family}/${entry}`)
      }
    }
  }
  if (removedRuntime.size > 0) {
    for (const [root, localConfiguration] of localConfigurations) {
      for (const [family, entry] of Object.entries(localConfiguration.toolchain)) {
        if (entry !== null && removedRuntime.has(`${family}/${entry}`)) {
          return failure({
            kind: 'validation',
            code: 'runtime-still-selected',
            observed: `Global Runtime ${family}/${entry} is still selected by Project ${root}.`,
            nextAction: `Run devbox config in ${root} and remove that Local Runtime selection first.`,
          })
        }
      }
    }
  }

  if (globalState.value.exists && configurationsEqual(currentConfiguration, nextCheck.value)) {
    return success({ scope: 'global', changed: false })
  }

  const confirm = input.confirm ?? input.prompt?.confirm ?? (async () => true)
  const changeSummary = `Current: ${serializeGlobalConfiguration(currentConfiguration).trim()}\nNext: ${serializeGlobalConfiguration(nextCheck.value).trim()}`
  if (
    !(await confirm('Save Global configuration?', {
      title: 'Global configuration changes',
      content: changeSummary,
    }))
  ) {
    return success({ scope: 'global', changed: false })
  }
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }
  const written = await writeAtomically(
    paths.globalConfiguration,
    serializeGlobalConfiguration(nextCheck.value),
  )
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
  const stateDirectoryName = registryCheck.value.projects[projectRoot]
  if (stateDirectoryName === undefined) {
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
  const stateDirectory = join(paths.projects, stateDirectoryName)
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
    const stateDirectoryName = projects[root]
    if (stateDirectoryName === undefined) {
      continue
    }
    try {
      await rm(join(discovery.paths.projects, stateDirectoryName), { recursive: true, force: true })
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

async function allocateStateDirectoryName(
  projectRoot: string,
  paths: DevboxPaths,
  registry: ProjectRegistry,
): Promise<Result<string>> {
  const baseName = basename(projectStateDirectory(projectRoot, paths.home))
  for (let suffix = 1; suffix < 1000000; suffix += 1) {
    const candidate = suffix === 1 ? baseName : `${baseName}-${suffix}`
    if (
      !isSafeStateDirectoryName(candidate) ||
      Object.values(registry.projects).includes(candidate)
    ) {
      continue
    }
    try {
      await lstat(join(paths.projects, candidate))
    } catch (error) {
      if (isMissingFileError(error)) {
        return success(candidate)
      }
      return failure({
        kind: 'operational',
        code: 'state-directory-observation-failed',
        observed: `Devbox could not inspect Project state directory: ${join(paths.projects, candidate)}.`,
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
  const directory = dirname(path)
  const temporaryPath = join(directory, `.${basename(path)}-${process.pid}-${randomUUID()}.tmp`)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, path)
    return success(undefined)
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

function stateDirectoryFailure(path: string): Result<never> {
  return failure({
    kind: 'operational',
    code: 'state-directory-unavailable',
    observed: `Devbox could not create its Project state directory: ${path}.`,
    nextAction: 'Check write access to ~/.devbox and run the command again.',
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
