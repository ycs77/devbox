import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  serializeGlobalConfiguration,
  serializeLocalConfiguration,
  type GlobalConfiguration,
  type LocalConfiguration,
} from '../configuration/index.js'
import { failure, success, type Result } from '../result.js'
import { renderProjectCompose } from './compose.js'
import { serializeProjectRegistry, type ProjectRegistry } from './registry.js'

export interface FileState {
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

export interface PreparedSandboxDefinition extends StateWrite {}

export interface PublicationProject extends SandboxDefinitionInput {
  readonly localPrevious?: FileState
  readonly preparedDefinition?: PreparedSandboxDefinition
  readonly skipUnchangedDefinition?: boolean
}

export interface ProjectStatePublication {
  readonly devboxHome: string
  readonly globalConfiguration: GlobalConfiguration
  readonly globalPrevious?: FileState
  readonly registry?: { readonly value: ProjectRegistry; readonly previous: FileState }
  readonly projects: readonly PublicationProject[]
}

export async function publishProjectState(input: ProjectStatePublication): Promise<Result<void>> {
  const definitions: StateWrite[] = []
  for (const project of input.projects) {
    const prepared =
      project.preparedDefinition === undefined
        ? await prepareSandboxDefinition(input.devboxHome, input.globalConfiguration, project)
        : success(project.preparedDefinition)
    if (!prepared.ok) {
      return prepared
    }
    if (
      !project.skipUnchangedDefinition ||
      !prepared.value.previous.exists ||
      prepared.value.content !== prepared.value.previous.content
    ) {
      definitions.push(prepared.value)
    }
  }

  const writes: StateWrite[] = [
    ...(input.globalPrevious === undefined
      ? []
      : [
          {
            path: join(input.devboxHome, 'config.yaml'),
            content: serializeGlobalConfiguration(input.globalConfiguration),
            previous: input.globalPrevious,
          },
        ]),
    ...input.projects.flatMap(project =>
      project.localPrevious === undefined
        ? []
        : [
            {
              path: join(project.stateDirectory, 'config.yaml'),
              content: serializeLocalConfiguration(project.localConfiguration),
              previous: project.localPrevious,
            },
          ],
    ),
    ...(input.registry === undefined
      ? []
      : [
          {
            path: join(input.devboxHome, 'projects.yaml'),
            content: serializeProjectRegistry(input.registry.value),
            previous: input.registry.previous,
          },
        ]),
    ...definitions,
  ]
  return writeStateTransaction(writes)
}

export async function prepareSandboxDefinition(
  devboxHome: string,
  globalConfiguration: GlobalConfiguration,
  project: SandboxDefinitionInput,
): Promise<Result<PreparedSandboxDefinition>> {
  const claudeHostConfiguration = await ensureClaudeHostConfiguration(
    devboxHome,
    globalConfiguration,
  )
  if (!claudeHostConfiguration.ok) {
    return claudeHostConfiguration
  }

  const rendered = renderProjectCompose({
    projectRoot: project.root,
    sandboxName: project.name,
    selectedNode: project.localConfiguration.node,
    configuredAgents: globalConfiguration.agent,
    agentNotifications: globalConfiguration.agent_notifications,
    claudeHostConfiguration: claudeHostConfiguration.value,
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

export async function readOptionalFile(path: string): Promise<Result<FileState>> {
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
