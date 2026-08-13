import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, readdir, rm, watch, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { success } from '../src/result.js'
import { withStateLocks } from '../src/state-lock.js'

const processMode = process.env.DEVBOX_LOCK_PROCESS_MODE
const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-lock-process-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function waitForFile(path: string): Promise<void> {
  try {
    await access(path)
    return
  } catch {
    // The file may be created while the watcher is being installed.
  }

  const watcher = watch(dirname(path), { persistent: false })
  try {
    while (true) {
      try {
        await access(path)
        return
      } catch {
        const event = await watcher.next()
        if (event.done) {
          throw new Error(`Stopped waiting for ${path}.`)
        }
        if (event.value.filename?.toString() === basename(path)) {
          return
        }
      }
    }
  } finally {
    await watcher.return?.()
  }
}

if (processMode === 'hold') {
  it('holds the requested marker for a parent process', async () => {
    const devboxHome = process.env.DEVBOX_LOCK_HOME
    const readyPath = process.env.DEVBOX_LOCK_READY
    const releasePath = process.env.DEVBOX_LOCK_RELEASE
    if (devboxHome === undefined || readyPath === undefined || releasePath === undefined) {
      throw new Error('The lock holder process is missing its coordination paths.')
    }

    const result = await withStateLocks(
      {
        devboxHome,
        global: process.env.DEVBOX_LOCK_GLOBAL === 'true',
        projectRoots: process.env.DEVBOX_LOCK_PROJECT_ROOTS?.split('\n').filter(Boolean) ?? [],
      },
      async () => {
        await writeFile(readyPath, 'ready\n')
        await waitForFile(releasePath)
        return success(undefined)
      },
    )
    if (!result.ok) {
      throw new Error(result.error.observed)
    }
  })
} else if (processMode === 'contend') {
  it('reports the result of a competing process', async () => {
    const devboxHome = process.env.DEVBOX_LOCK_HOME
    const resultPath = process.env.DEVBOX_LOCK_RESULT
    if (devboxHome === undefined || resultPath === undefined) {
      throw new Error('The lock contender process is missing its coordination paths.')
    }

    const result = await withStateLocks(
      {
        devboxHome,
        global: process.env.DEVBOX_LOCK_GLOBAL === 'true',
        projectRoots: process.env.DEVBOX_LOCK_PROJECT_ROOTS?.split('\n').filter(Boolean) ?? [],
      },
      async () => success('competing operation ran'),
    )
    await writeFile(resultPath, JSON.stringify(result))
  })
} else {
  interface LockHolder {
    readonly child: ChildProcess
    readonly releasePath: string
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(directory => rm(directory, { recursive: true, force: true })),
    )
  })

  async function runContender(
    devboxHome: string,
    projectRoots: readonly string[],
    global: boolean,
  ): Promise<unknown> {
    const resultPath = join(devboxHome, 'result.json')
    const child = spawn('pnpm', ['exec', 'vitest', '--run', 'test/state-lock-process.test.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEVBOX_LOCK_PROCESS_MODE: 'contend',
        DEVBOX_LOCK_HOME: devboxHome,
        DEVBOX_LOCK_RESULT: resultPath,
        DEVBOX_LOCK_GLOBAL: String(global),
        DEVBOX_LOCK_PROJECT_ROOTS: projectRoots.join('\n'),
      },
      stdio: 'ignore',
    })
    const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null]
    expect(code).toBe(0)
    expect(signal).toBeNull()
    return JSON.parse(await readFile(resultPath, 'utf8')) as unknown
  }

  async function startHolder(
    devboxHome: string,
    projectRoots: readonly string[],
    global: boolean,
  ): Promise<LockHolder> {
    const readyPath = join(devboxHome, 'ready.txt')
    const releasePath = join(devboxHome, 'release.txt')
    const child = spawn('pnpm', ['exec', 'vitest', '--run', 'test/state-lock-process.test.ts'], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        DEVBOX_LOCK_PROCESS_MODE: 'hold',
        DEVBOX_LOCK_HOME: devboxHome,
        DEVBOX_LOCK_READY: readyPath,
        DEVBOX_LOCK_RELEASE: releasePath,
        DEVBOX_LOCK_GLOBAL: String(global),
        DEVBOX_LOCK_PROJECT_ROOTS: projectRoots.join('\n'),
      },
      stdio: 'ignore',
    })
    await waitForFile(readyPath)
    return { child, releasePath }
  }

  describe('cross-process command markers', () => {
    it('fails busy scopes immediately, keeps unrelated scopes concurrent, rolls back, and releases', async () => {
      const devboxHome = await temporaryDirectory()
      const firstProject = join(devboxHome, 'first-project')
      const secondProject = join(devboxHome, 'second-project')
      const holder = await startHolder(devboxHome, [firstProject], false)

      try {
        expect(await runContender(devboxHome, [firstProject], false)).toMatchObject({
          ok: false,
          error: { kind: 'operational', code: 'command-lock-busy' },
        })
        expect(await runContender(devboxHome, [secondProject], false)).toEqual({
          ok: true,
          value: 'competing operation ran',
        })
        expect(await runContender(devboxHome, [], true)).toEqual({
          ok: true,
          value: 'competing operation ran',
        })
        expect(await runContender(devboxHome, [firstProject], true)).toMatchObject({
          ok: false,
          error: { kind: 'operational', code: 'command-lock-busy' },
        })
        expect(await runContender(devboxHome, [], true)).toEqual({
          ok: true,
          value: 'competing operation ran',
        })

        await writeFile(holder.releasePath, 'release\n')
        const [code, signal] = (await once(holder.child, 'close')) as [
          number | null,
          NodeJS.Signals | null,
        ]
        expect(code).toBe(0)
        expect(signal).toBeNull()
        expect(await runContender(devboxHome, [firstProject], false)).toEqual({
          ok: true,
          value: 'competing operation ran',
        })
      } finally {
        if (holder.child.exitCode === null && holder.child.signalCode === null) {
          process.kill(-holder.child.pid!, 'SIGTERM')
          await once(holder.child, 'close')
        }
      }
    }, 15_000)

    it('leaves a residual marker after forced process termination', async () => {
      const devboxHome = await temporaryDirectory()
      const projectRoot = join(devboxHome, 'project')
      const holder = await startHolder(devboxHome, [projectRoot], false)

      process.kill(-holder.child.pid!, 'SIGKILL')
      const [code, signal] = (await once(holder.child, 'close')) as [
        number | null,
        NodeJS.Signals | null,
      ]
      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')

      const markers = await readdir(join(devboxHome, 'locks'))
      expect(markers).toHaveLength(1)
      await rm(join(devboxHome, 'locks', markers[0]!), { recursive: true, force: true })
      await expect(readdir(join(devboxHome, 'locks'))).resolves.toEqual([])
    })
  })
}
