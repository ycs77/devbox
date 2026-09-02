import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const childScriptPath = fileURLToPath(
  new URL('./fixtures/state-lock-process-child.ts', import.meta.url),
)
const coordinationTimeoutMs = 5_000
const pollIntervalMs = 25
const temporaryDirectories: string[] = []

interface LockProcess {
  readonly child: ChildProcess
  readonly completion: Promise<[number | null, NodeJS.Signals | null]>
  readonly stderr: () => string
}

interface LockHolder {
  readonly process: LockProcess
  readonly releasePath: string
}

interface LockContender {
  readonly process: LockProcess
  readonly releasePath: string
  readonly resultPath: string
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-lock-process-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + coordinationTimeoutMs
  while (true) {
    try {
      await access(path)
      return
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${coordinationTimeoutMs}ms waiting for ${path}.`)
      }
      await delay(pollIntervalMs)
    }
  }
}

function startWorker(environment: NodeJS.ProcessEnv): LockProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', childScriptPath], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const stderr: string[] = []
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => {
    stderr.push(chunk)
  })
  return {
    child,
    completion: once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>,
    stderr: () => stderr.join(''),
  }
}

async function expectCleanExit(process: LockProcess): Promise<void> {
  const [code, signal] = await process.completion
  if (code !== 0 || signal !== null) {
    throw new Error(
      `The lock worker exited with code ${code} and signal ${signal}.\n${process.stderr()}`,
    )
  }
}

async function terminate(worker: LockProcess | undefined): Promise<void> {
  if (worker !== undefined && worker.child.exitCode === null && worker.child.signalCode === null) {
    process.kill(-worker.child.pid!, 'SIGTERM')
    await worker.completion
  }
}

async function startHolder(devboxHome: string, projectRoot: string): Promise<LockHolder> {
  const readyPath = join(devboxHome, 'holder-ready.txt')
  const releasePath = join(devboxHome, 'holder-release.txt')
  const process = startWorker({
    DEVBOX_LOCK_PROCESS_MODE: 'hold',
    DEVBOX_LOCK_HOME: devboxHome,
    DEVBOX_LOCK_FIRST_PROJECT: projectRoot,
    DEVBOX_LOCK_READY: readyPath,
    DEVBOX_LOCK_RELEASE: releasePath,
  })

  try {
    await waitForFile(readyPath)
    return { process, releasePath }
  } catch (error) {
    await terminate(process)
    throw error
  }
}

function startContender(
  devboxHome: string,
  firstProject: string,
  secondProject: string,
): LockContender {
  const readyPath = join(devboxHome, 'contender-ready.txt')
  const releasePath = join(devboxHome, 'contender-release.txt')
  const resultPath = join(devboxHome, 'results.json')
  return {
    process: startWorker({
      DEVBOX_LOCK_PROCESS_MODE: 'contend',
      DEVBOX_LOCK_HOME: devboxHome,
      DEVBOX_LOCK_FIRST_PROJECT: firstProject,
      DEVBOX_LOCK_SECOND_PROJECT: secondProject,
      DEVBOX_LOCK_READY: readyPath,
      DEVBOX_LOCK_RELEASE: releasePath,
      DEVBOX_LOCK_RESULT: resultPath,
    }),
    releasePath,
    resultPath,
  }
}

async function readContenderResults(contender: LockContender): Promise<unknown[]> {
  await expectCleanExit(contender.process)
  const results: unknown = JSON.parse(await readFile(contender.resultPath, 'utf8'))
  if (!Array.isArray(results)) {
    throw new Error('The lock contender process did not report a result array.')
  }
  return results
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('cross-process command markers', () => {
  it('fails busy scopes immediately, keeps unrelated scopes concurrent, rolls back, and releases', async () => {
    const devboxHome = await temporaryDirectory()
    const firstProject = join(devboxHome, 'first-project')
    const secondProject = join(devboxHome, 'second-project')
    const holder = await startHolder(devboxHome, firstProject)
    let contender: LockContender | undefined

    try {
      contender = startContender(devboxHome, firstProject, secondProject)
      await waitForFile(join(devboxHome, 'contender-ready.txt'))
      await writeFile(holder.releasePath, 'release\n')
      await expectCleanExit(holder.process)
      await writeFile(contender.releasePath, 'release\n')

      const results = await readContenderResults(contender)
      expect(results[0]).toMatchObject({
        ok: false,
        error: { kind: 'operational', code: 'command-lock-busy' },
      })
      expect(results[1]).toEqual({
        ok: true,
        value: 'competing operation ran',
      })
      expect(results[2]).toEqual({
        ok: true,
        value: 'competing operation ran',
      })
      expect(results[3]).toMatchObject({
        ok: false,
        error: { kind: 'operational', code: 'command-lock-busy' },
      })
      expect(results[4]).toEqual({
        ok: true,
        value: 'competing operation ran',
      })
      expect(results[5]).toEqual({
        ok: true,
        value: 'competing operation ran',
      })
    } finally {
      await Promise.all([terminate(holder.process), terminate(contender?.process)])
    }
  }, 15_000)

  it('leaves a residual marker after forced process termination', async () => {
    const devboxHome = await temporaryDirectory()
    const projectRoot = join(devboxHome, 'project')
    const holder = await startHolder(devboxHome, projectRoot)

    try {
      process.kill(-holder.process.child.pid!, 'SIGKILL')
      const [code, signal] = await holder.process.completion
      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')

      const markers = await readdir(join(devboxHome, 'locks'))
      expect(markers).toHaveLength(1)
      await rm(join(devboxHome, 'locks', markers[0]!), { recursive: true, force: true })
      await expect(readdir(join(devboxHome, 'locks'))).resolves.toEqual([])
    } finally {
      await terminate(holder.process)
    }
  })
})
