import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StateLockInput {
  readonly devboxHome: string
  readonly projectRoot?: string
  readonly signal?: AbortSignal
}

export class StateLockInterruptedError extends Error {
  public constructor() {
    super('State lock acquisition interrupted.')
    this.name = 'StateLockInterruptedError'
  }
}

export async function withStateLocks<T>(
  input: StateLockInput,
  operation: () => Promise<T>,
): Promise<T> {
  const lockRoot = join(tmpdir(), 'devbox-state-locks')
  const key = createHash('sha256').update(input.devboxHome).digest('hex')
  const names = ['lifecycle']
  if (input.projectRoot !== undefined) {
    names.push(`project-${createHash('sha256').update(input.projectRoot).digest('hex')}`)
  }

  const acquired: string[] = []
  try {
    for (const name of names) {
      const lockPath = join(lockRoot, `${key}-${name}`)
      await acquireLock(lockPath, input.signal)
      acquired.push(lockPath)
    }
    return await operation()
  } finally {
    for (const lockPath of acquired.reverse()) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function acquireLock(lockPath: string, signal?: AbortSignal): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  while (true) {
    if (signal?.aborted) {
      throw new StateLockInterruptedError()
    }
    try {
      await mkdir(lockPath, { mode: 0o700 })
      await writeFile(
        join(lockPath, 'owner'),
        JSON.stringify({ pid: process.pid, token: randomUUID() }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      return
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }
    }

    let ownerPid: number | undefined
    try {
      const owner = JSON.parse(await readFile(join(lockPath, 'owner'), 'utf8')) as {
        readonly pid?: unknown
      }
      if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0) {
        ownerPid = owner.pid
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        try {
          const lockMetadata = await stat(lockPath)
          if (Date.now() - lockMetadata.mtimeMs > 30_000) {
            await rm(lockPath, { recursive: true, force: true })
          }
        } catch (metadataError) {
          if (!isMissingFileError(metadataError)) {
            throw metadataError
          }
        }
      } else {
        throw error
      }
    }

    if (ownerPid !== undefined) {
      try {
        process.kill(ownerPid, 0)
      } catch (error) {
        if (isNoSuchProcessError(error)) {
          await rm(lockPath, { recursive: true, force: true })
          continue
        }
        throw error
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function isNoSuchProcessError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ESRCH'
  )
}
