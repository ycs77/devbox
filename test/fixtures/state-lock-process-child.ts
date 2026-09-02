import { access, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { success } from '../../src/result.js'
import { withStateLocks } from '../../src/state-lock.js'

const waitTimeoutMs = 5_000
const pollIntervalMs = 25

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`The lock worker is missing ${name}.`)
  }
  return value
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + waitTimeoutMs
  while (true) {
    try {
      await access(path)
      return
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${waitTimeoutMs}ms waiting for ${path}.`)
      }
      await delay(pollIntervalMs)
    }
  }
}

async function holdMarker(): Promise<void> {
  const devboxHome = requiredEnvironment('DEVBOX_LOCK_HOME')
  const projectRoot = requiredEnvironment('DEVBOX_LOCK_FIRST_PROJECT')
  const readyPath = requiredEnvironment('DEVBOX_LOCK_READY')
  const releasePath = requiredEnvironment('DEVBOX_LOCK_RELEASE')

  const result = await withStateLocks(
    { devboxHome, global: false, projectRoots: [projectRoot] },
    async () => {
      await writeFile(readyPath, 'ready\n')
      await waitForFile(releasePath)
      return success(undefined)
    },
  )
  if (!result.ok) {
    throw new Error(result.error.observed)
  }
}

async function runContender(): Promise<void> {
  const devboxHome = requiredEnvironment('DEVBOX_LOCK_HOME')
  const firstProject = requiredEnvironment('DEVBOX_LOCK_FIRST_PROJECT')
  const secondProject = requiredEnvironment('DEVBOX_LOCK_SECOND_PROJECT')
  const readyPath = requiredEnvironment('DEVBOX_LOCK_READY')
  const releasePath = requiredEnvironment('DEVBOX_LOCK_RELEASE')
  const resultPath = requiredEnvironment('DEVBOX_LOCK_RESULT')
  const results = []

  results.push(
    await withStateLocks({ devboxHome, global: false, projectRoots: [firstProject] }, async () =>
      success('competing operation ran'),
    ),
  )
  results.push(
    await withStateLocks({ devboxHome, global: false, projectRoots: [secondProject] }, async () =>
      success('competing operation ran'),
    ),
  )
  results.push(
    await withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () =>
      success('competing operation ran'),
    ),
  )
  results.push(
    await withStateLocks({ devboxHome, global: true, projectRoots: [firstProject] }, async () =>
      success('competing operation ran'),
    ),
  )
  results.push(
    await withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () =>
      success('competing operation ran'),
    ),
  )

  await writeFile(readyPath, 'ready\n')
  await waitForFile(releasePath)

  results.push(
    await withStateLocks({ devboxHome, global: false, projectRoots: [firstProject] }, async () =>
      success('competing operation ran'),
    ),
  )
  await writeFile(resultPath, JSON.stringify(results))
}

switch (requiredEnvironment('DEVBOX_LOCK_PROCESS_MODE')) {
  case 'hold':
    await holdMarker()
    break
  case 'contend':
    await runContender()
    break
  default:
    throw new Error('The lock worker received an unsupported mode.')
}
