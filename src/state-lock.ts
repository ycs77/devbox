import { createHash } from 'node:crypto'
import { lstat, mkdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { failure, type Result } from './result.js'

export interface StateLockInput {
  readonly devboxHome: string
  readonly global: boolean
  readonly projectRoots: readonly string[]
  readonly signal?: AbortSignal
}

export class StateLockInterruptedError extends Error {
  public constructor() {
    super('State lock acquisition interrupted.')
    this.name = 'StateLockInterruptedError'
  }
}

class StateLockBusyError extends Error {
  readonly scope: 'global' | 'project'
  readonly projectRoot?: string

  public constructor(scope: 'global' | 'project', projectRoot?: string) {
    super('A required Devbox command marker is already present.')
    this.name = 'StateLockBusyError'
    this.scope = scope
    this.projectRoot = projectRoot
  }
}

export interface StateLockContext {
  readonly acquireProjectScopes: (projectRoots: readonly string[]) => Promise<void>
}

interface LockTarget {
  readonly path: string
  readonly scope: 'global' | 'project'
  readonly projectRoot?: string
}

export async function withStateLocks<T>(
  input: StateLockInput,
  operation: (context: StateLockContext) => Promise<Result<T>>,
): Promise<Result<T>> {
  const lockRoot = join(input.devboxHome, 'locks')
  const targets: LockTarget[] = input.global
    ? [{ path: join(lockRoot, 'global'), scope: 'global' }]
    : []
  targets.push(...projectLockTargets(lockRoot, input.projectRoots))

  let devboxHomeExisted = true
  try {
    await lstat(input.devboxHome)
  } catch (error) {
    if (isMissingFileError(error)) {
      devboxHomeExisted = false
    } else {
      throw error
    }
  }
  const acquired: string[] = []
  const acquireTargets = async (targetsToAcquire: readonly LockTarget[]): Promise<void> => {
    for (const target of targetsToAcquire) {
      if (input.signal?.aborted) {
        throw new StateLockInterruptedError()
      }
      await acquireLock(target)
      acquired.push(target.path)
    }
  }

  try {
    if (input.signal?.aborted) {
      throw new StateLockInterruptedError()
    }
    await mkdir(lockRoot, { recursive: true, mode: 0o700 })
    await acquireTargets(targets)
    if (input.signal?.aborted) {
      throw new StateLockInterruptedError()
    }
    return await operation({
      acquireProjectScopes: async projectRoots => {
        await acquireTargets(projectLockTargets(lockRoot, projectRoots))
      },
    })
  } catch (error) {
    if (error instanceof StateLockBusyError) {
      return failure({
        kind: 'operational',
        code: 'command-lock-busy',
        observed:
          error.scope === 'global'
            ? 'The Global command marker is already occupied.'
            : `The Project command marker is already occupied for ${error.projectRoot}.`,
        nextAction: `Wait for the other Devbox command to finish and try again. If no Devbox process is running, remove the residual marker under ${input.devboxHome}/locks/ and try again.`,
      })
    }
    throw error
  } finally {
    for (const lockPath of acquired.reverse()) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
    }
    await rmdir(lockRoot).catch(() => undefined)
    if (!devboxHomeExisted) {
      await rmdir(input.devboxHome).catch(() => undefined)
    }
  }
}

function projectLockTargets(lockRoot: string, projectRoots: readonly string[]): LockTarget[] {
  const targets: LockTarget[] = []
  const sortedRoots = [...new Set(projectRoots)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  for (const projectRoot of sortedRoots) {
    const hash = createHash('sha256').update(projectRoot).digest('hex')
    targets.push({
      path: join(lockRoot, `project-${hash}`),
      scope: 'project',
      projectRoot,
    })
  }
  return targets
}

async function acquireLock(target: LockTarget): Promise<void> {
  try {
    await mkdir(target.path, { mode: 0o700 })
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new StateLockBusyError(target.scope, target.projectRoot)
    }
    throw error
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
