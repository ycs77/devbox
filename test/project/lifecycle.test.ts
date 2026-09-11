import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProject, runSandboxLifecycle, runSandboxShell } from '../../src/project/index.js'
import { success } from '../../src/result.js'
import { withStateLocks } from '../../src/state-lock/index.js'

const temporaryDirectories: string[] = []

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(completion => {
    resolve = completion
  })
  return { promise, resolve }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-lifecycle-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createProjectState(
  root: string,
  devboxHome: string,
): Promise<{ readonly stateDirectory: string }> {
  const result = await initializeProject({
    root,
    devboxHome,
    validateHost: async () => success(undefined),
    confirm: async () => true,
    initialGlobalConfiguration: {
      version: 1,
      node: ['24'],
      agent: ['claude-code'],
      agent_notifications: true,
    },
    initialLocalConfiguration: { version: 1, node: '24', ports: [] },
  })
  expect(result).toMatchObject({ ok: true, value: { root, created: true } })
  if (!result.ok) {
    throw new Error(result.error.observed)
  }
  return { stateDirectory: result.value.stateDirectory }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('Sandbox shell sessions', () => {
  it('allows concurrent shell sessions for one Sandbox', async () => {
    const sandbox = await temporaryDirectory()
    const root = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(root)
    const { stateDirectory } = await createProjectState(root, devboxHome)
    const composePath = join(stateDirectory, 'compose.yaml')

    const firstEntered = deferred()
    const releaseFirst = deferred()
    const invocations: Array<{ readonly file: string; readonly args: readonly string[] }> = []
    const environment = {
      run: async (file: string, args: readonly string[]) => {
        invocations.push({ file, args })
      },
      runDirect: async (file: string, args: readonly string[]) => {
        invocations.push({ file, args })
        if (invocations.length === 1) {
          firstEntered.resolve()
          await releaseFirst.promise
        }
      },
    }

    const first = runSandboxShell({ root, devboxHome, environment })
    await firstEntered.promise
    const second = await runSandboxShell({ root, devboxHome, environment })

    expect(second).toEqual(success(undefined))
    releaseFirst.resolve()
    await expect(first).resolves.toEqual(success(undefined))
    expect(invocations).toEqual([
      {
        file: 'docker',
        args: ['compose', '--file', composePath, 'exec', '--user', 'devbox', 'devbox', 'bash'],
      },
      {
        file: 'docker',
        args: ['compose', '--file', composePath, 'exec', '--user', 'devbox', 'devbox', 'bash'],
      },
    ])
  })

  it('starts a shell session while a Project command marker is occupied', async () => {
    const sandbox = await temporaryDirectory()
    const root = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(root)
    await createProjectState(root, devboxHome)

    const markerEntered = deferred()
    const releaseMarker = deferred()
    const marker = withStateLocks({ devboxHome, global: false, projectRoots: [root] }, async () => {
      markerEntered.resolve()
      await releaseMarker.promise
      return success(undefined)
    })
    await markerEntered.promise

    const result = await runSandboxShell({
      root,
      devboxHome,
      environment: {
        run: async () => undefined,
        runDirect: async () => undefined,
      },
    })

    expect(result).toEqual(success(undefined))
    releaseMarker.resolve()
    await expect(marker).resolves.toEqual(success(undefined))
  })
})

describe('Sandbox lifecycle commands', () => {
  it('uses retained Compose and provisions its configured Agent volumes before up', async () => {
    const sandbox = await temporaryDirectory()
    const root = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(root)
    const { stateDirectory } = await createProjectState(root, devboxHome)
    const composePath = join(stateDirectory, 'compose.yaml')
    const retainedCompose = `${await readFile(composePath, 'utf8')}# retained lifecycle definition\n`
    await writeFile(composePath, retainedCompose)
    const invocations: Array<{ readonly file: string; readonly args: readonly string[] }> = []

    const result = await runSandboxLifecycle('up', {
      root,
      devboxHome,
      environment: {
        run: async (file, args) => {
          invocations.push({ file, args })
        },
        runDirect: async (file, args) => {
          invocations.push({ file, args })
        },
      },
    })

    expect(result).toEqual(success(undefined))
    await expect(readFile(composePath, 'utf8')).resolves.toBe(retainedCompose)
    expect(invocations).toEqual([
      { file: 'docker', args: ['volume', 'create', '--driver', 'local', 'devbox-claude'] },
      { file: 'docker', args: ['compose', '--file', composePath, 'up', '-d'] },
    ])
  })

  it('returns Docker’s missing image failure without starting a Workspace build', async () => {
    const sandbox = await temporaryDirectory()
    const root = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(root)
    const { stateDirectory } = await createProjectState(root, devboxHome)
    const composePath = join(stateDirectory, 'compose.yaml')
    const missingImage = new Error('pull access denied for devbox-workspace')
    const invocations: Array<{ readonly file: string; readonly args: readonly string[] }> = []

    await expect(
      runSandboxLifecycle('up', {
        root,
        devboxHome,
        environment: {
          run: async (file, args) => {
            invocations.push({ file, args })
          },
          runDirect: async (file, args) => {
            invocations.push({ file, args })
            throw missingImage
          },
        },
      }),
    ).rejects.toBe(missingImage)
    expect(invocations).toEqual([
      { file: 'docker', args: ['volume', 'create', '--driver', 'local', 'devbox-claude'] },
      { file: 'docker', args: ['compose', '--file', composePath, 'up', '-d'] },
    ])
  })

  it.each([
    ['down', ['down']],
    ['stop', ['stop']],
  ] as const)(
    '%s uses retained Compose without provisioning volumes',
    async (command, operation) => {
      const sandbox = await temporaryDirectory()
      const root = join(sandbox, 'project')
      const devboxHome = join(sandbox, 'user-state', '.devbox')
      await mkdir(root)
      const { stateDirectory } = await createProjectState(root, devboxHome)
      const composePath = join(stateDirectory, 'compose.yaml')
      const retainedCompose = `${await readFile(composePath, 'utf8')}# retained lifecycle definition\n`
      await writeFile(composePath, retainedCompose)
      const invocations: Array<{ readonly file: string; readonly args: readonly string[] }> = []

      const result = await runSandboxLifecycle(command, {
        root,
        devboxHome,
        environment: {
          run: async (file, args) => {
            invocations.push({ file, args })
          },
          runDirect: async (file, args) => {
            invocations.push({ file, args })
          },
        },
      })

      expect(result).toEqual(success(undefined))
      await expect(readFile(composePath, 'utf8')).resolves.toBe(retainedCompose)
      expect(invocations).toEqual([
        { file: 'docker', args: ['compose', '--file', composePath, ...operation] },
      ])
    },
  )
})
