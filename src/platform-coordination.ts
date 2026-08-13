import { lstat, mkdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { failure, type Result } from './result.js'

export interface PlatformLockInput {
  readonly devboxHome: string
  readonly signal?: AbortSignal
}

export class PlatformLockInterruptedError extends Error {
  public constructor() {
    super('Platform lock acquisition interrupted.')
    this.name = 'PlatformLockInterruptedError'
  }
}

/**
 * Coordinates only mutations of the shared Platform lock and its exact plan.
 * It intentionally does not acquire Global or Project command markers.
 */
export async function withPlatformLock<T>(
  input: PlatformLockInput,
  operation: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const lockRoot = join(input.devboxHome, 'locks')
  const marker = join(lockRoot, 'platform')
  let devboxHomeExisted = true
  let lockRootCreated = false
  let markerAcquired = false

  try {
    try {
      await lstat(input.devboxHome)
    } catch (error) {
      if (isMissingFileError(error)) {
        devboxHomeExisted = false
      } else {
        return platformLockUnavailable(input.devboxHome)
      }
    }

    if (input.signal?.aborted) {
      throw new PlatformLockInterruptedError()
    }
    try {
      await mkdir(lockRoot, { recursive: true, mode: 0o700 })
      lockRootCreated = true
    } catch {
      return platformLockUnavailable(lockRoot)
    }

    try {
      await mkdir(marker, { mode: 0o700 })
      markerAcquired = true
    } catch (error) {
      if (isFileExistsError(error)) {
        return failure({
          kind: 'operational',
          code: 'platform-lock-busy',
          observed: 'The shared Platform lock is already being updated.',
          nextAction: `Wait for the other Platform operation to finish and try again. If no Devbox process is running, remove the residual marker at ${marker} and run devbox update again.`,
        })
      }
      return platformLockUnavailable(marker)
    }

    if (input.signal?.aborted) {
      throw new PlatformLockInterruptedError()
    }
    return await operation()
  } finally {
    if (markerAcquired) {
      await rm(marker, { recursive: true, force: true }).catch(() => undefined)
    }
    if (lockRootCreated) {
      await rmdir(lockRoot).catch(() => undefined)
    }
    if (!devboxHomeExisted) {
      await rmdir(input.devboxHome).catch(() => undefined)
    }
  }
}

function platformLockUnavailable(path: string): Result<never> {
  return failure({
    kind: 'operational',
    code: 'platform-lock-unavailable',
    observed: `Devbox could not prepare the Platform coordination marker: ${path}.`,
    nextAction: 'Check write access to ~/.devbox and run devbox update again.',
  })
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
