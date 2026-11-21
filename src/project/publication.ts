import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  parseGlobalConfiguration,
  parseLocalConfiguration,
  serializeGlobalConfiguration,
  serializeLocalConfiguration,
  type GlobalConfiguration,
  type LocalConfiguration,
  type RuntimeCatalog,
} from '../configuration/index.js'
import { failure, success, type Result } from '../result.js'
import { renderProjectCompose } from './compose.js'
import {
  devboxPaths,
  parseProjectRegistry,
  serializeProjectRegistry,
  type DevboxPaths,
  type ProjectRegistry,
} from './registry.js'

interface FileState {
  readonly exists: boolean
  readonly content: string
}

interface StateWrite {
  readonly path: string
  readonly content: string
  readonly previous: FileState
}

export interface SandboxDefinitionInput {
  readonly root: string
  readonly name: string
  readonly stateDirectory: string
  readonly localConfiguration: LocalConfiguration
}

export interface PublicationProject extends SandboxDefinitionInput {
  readonly configurationChange: 'create' | 'update' | 'none'
}

export interface ProjectStatePublication {
  readonly globalConfiguration: GlobalConfiguration
  readonly globalConfigurationChanged?: boolean
  readonly registry?: ProjectRegistry
  readonly projects: readonly PublicationProject[]
}

export class ProjectPublication {
  readonly #paths: DevboxPaths
  readonly #files = new Map<string, FileState>()
  readonly #definitions = new Map<string, StateWrite>()

  constructor(devboxHome: string) {
    this.#paths = devboxPaths(devboxHome)
  }

  async readRegistry(): Promise<Result<ProjectRegistry | undefined>> {
    const state = await this.#read(this.#paths.projectRegistry)
    if (!state.ok) return state
    return state.value.exists ? parseProjectRegistry(state.value.content) : success(undefined)
  }

  async readGlobal(catalog: RuntimeCatalog): Promise<Result<GlobalConfiguration | undefined>> {
    const state = await this.#read(this.#paths.globalConfiguration)
    if (!state.ok) return state
    return state.value.exists
      ? parseGlobalConfiguration(state.value.content, catalog)
      : success(undefined)
  }

  async readLocal(
    stateDirectory: string,
    globalConfiguration: GlobalConfiguration,
    catalog: RuntimeCatalog,
  ): Promise<Result<LocalConfiguration>> {
    const path = join(stateDirectory, 'config.yaml')
    const state = await this.#read(path)
    if (!state.ok) return state
    if (!state.value.exists) {
      return failure({
        kind: 'validation',
        code: 'missing-local-configuration',
        observed: `Devbox could not find the local configuration: ${path}.`,
        nextAction: 'Restore the supported version-1 local YAML configuration and try again.',
      })
    }
    return parseLocalConfiguration(state.value.content, globalConfiguration, catalog)
  }

  async prepareDefinition(
    globalConfiguration: GlobalConfiguration,
    project: SandboxDefinitionInput,
  ): Promise<Result<void>> {
    const prepared = await prepareSandboxDefinition(this.#paths.home, globalConfiguration, project)
    if (!prepared.ok) return prepared
    this.#definitions.set(project.stateDirectory, prepared.value)
    return success(undefined)
  }

  async publish(input: ProjectStatePublication): Promise<Result<boolean>> {
    const definitions: StateWrite[] = []
    for (const project of input.projects) {
      if (!this.#definitions.has(project.stateDirectory)) {
        const prepared = await this.prepareDefinition(input.globalConfiguration, project)
        if (!prepared.ok) return prepared
      }
      definitions.push(this.#definitions.get(project.stateDirectory)!)
    }

    const claudeHostConfiguration = await ensureClaudeHostConfiguration(
      this.#paths.home,
      input.globalConfiguration,
    )
    if (!claudeHostConfiguration.ok) return claudeHostConfiguration

    const writes: StateWrite[] = [
      ...(input.globalConfigurationChanged
        ? [
            this.#write(
              this.#paths.globalConfiguration,
              serializeGlobalConfiguration(input.globalConfiguration),
            ),
          ]
        : []),
      ...input.projects.flatMap(project =>
        project.configurationChange === 'none'
          ? []
          : [
              this.#write(
                join(project.stateDirectory, 'config.yaml'),
                serializeLocalConfiguration(project.localConfiguration),
                project.configurationChange === 'create',
              ),
            ],
      ),
      ...(input.registry === undefined
        ? []
        : [this.#write(this.#paths.projectRegistry, serializeProjectRegistry(input.registry))]),
      ...definitions,
    ].filter(write => !write.previous.exists || write.content !== write.previous.content)
    const written = await writeStateTransaction(writes)
    return written.ok ? success(writes.length > 0) : written
  }

  async #read(path: string): Promise<Result<FileState>> {
    const observed = this.#files.get(path)
    if (observed !== undefined) return success(observed)
    const state = await readOptionalFile(path)
    if (state.ok) this.#files.set(path, state.value)
    return state
  }

  #write(path: string, content: string, created = false): StateWrite {
    // Existing files were observed before interaction; a new Project's Local file is known absent.
    return {
      path,
      content,
      previous: created ? { exists: false, content: '' } : this.#files.get(path)!,
    }
  }
}

async function prepareSandboxDefinition(
  devboxHome: string,
  globalConfiguration: GlobalConfiguration,
  project: SandboxDefinitionInput,
): Promise<Result<StateWrite>> {
  const claudeHostConfiguration = globalConfiguration.agent.includes('claude-code')
    ? join(devboxHome, 'agents', 'claude', '.claude.json')
    : undefined

  const rendered = renderProjectCompose({
    projectRoot: project.root,
    sandboxName: project.name,
    selectedNode: project.localConfiguration.node,
    configuredAgents: globalConfiguration.agent,
    agentNotifications: globalConfiguration.agent_notifications,
    claudeHostConfiguration,
    ports: project.localConfiguration.ports,
  })

  if (!rendered.ok) {
    return rendered
  }
  const path = join(project.stateDirectory, 'compose.yaml')
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

  const path = join(devboxHome, 'agents', 'claude', '.claude.json')
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

export async function readOptionalText(path: string): Promise<Result<string | undefined>> {
  const state = await readOptionalFile(path)
  return state.ok ? success(state.value.exists ? state.value.content : undefined) : state
}

async function readOptionalFile(path: string): Promise<Result<FileState>> {
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

export async function writeAtomically(path: string, content: string): Promise<Result<void>> {
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

async function writeStateTransaction(writes: readonly StateWrite[]): Promise<Result<void>> {
  const staged: { readonly write: StateWrite; readonly path: string }[] = []
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
