import { randomUUID } from 'node:crypto'
import { lstat, link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, sep } from 'node:path'
import { validateSupportedHost } from './host.js'
import { failure, success, type Result } from './result.js'

export interface RegisteredProject {
  readonly root: string
  readonly stateDirectory: string
  readonly created: boolean
}

export interface InitializeProjectInput {
  readonly root?: string
  readonly devboxHome?: string
  readonly validateHost?: () => Promise<Result<void>>
  readonly signal?: AbortSignal
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

  const segments = pathWithinRoot === '' ? [] : pathWithinRoot.split(sep)
  return join(devboxHome, 'projects', ...segments.map(escapePathSegment))
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

  const stateDirectory = projectStateDirectory(
    projectRoot,
    input.devboxHome ?? join(homedir(), '.devbox'),
  )
  const configurationPath = join(stateDirectory, 'config.yaml')

  try {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  } catch {
    return failure({
      kind: 'operational',
      code: 'state-directory-unavailable',
      observed: `Devbox could not create its Project state directory: ${stateDirectory}.`,
      nextAction: 'Check write access to ~/.devbox and run devbox init again.',
    })
  }

  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const temporaryPath = join(stateDirectory, `.config-${process.pid}-${randomUUID()}.tmp`)
  const content = `version: 1\nprojectRoot: ${JSON.stringify(projectRoot)}\n`

  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await link(temporaryPath, configurationPath)
    await unlink(temporaryPath)
    return success({ root: projectRoot, stateDirectory, created: true })
  } catch (cause) {
    await unlink(temporaryPath).catch(() => undefined)

    if (isFileExistsError(cause)) {
      return success({ root: projectRoot, stateDirectory, created: false })
    }

    return failure({
      kind: 'operational',
      code: 'registration-write-failed',
      observed: `Devbox could not register this Project in ${stateDirectory}.`,
      nextAction: 'Check write access to ~/.devbox and run devbox init again.',
    })
  }
}

async function validateProjectRoot(projectRoot: string): Promise<Result<void>> {
  if (!isAbsolute(projectRoot)) {
    return failure({
      kind: 'validation',
      code: 'invalid-project-root',
      observed: `The current Project directory is not absolute: ${projectRoot}.`,
      nextAction: 'Run devbox init from an existing directory.',
    })
  }

  try {
    const metadata = await lstat(projectRoot)
    if (!metadata.isDirectory()) {
      return failure({
        kind: 'validation',
        code: 'invalid-project-root',
        observed: `The current Project path is not a directory: ${projectRoot}.`,
        nextAction: 'Run devbox init from an existing directory.',
      })
    }
  } catch {
    return failure({
      kind: 'validation',
      code: 'missing-project-root',
      observed: `The current Project directory does not exist: ${projectRoot}.`,
      nextAction: 'Change to an existing directory and run devbox init again.',
    })
  }

  return success(undefined)
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  )
}

export class InterruptedError extends Error {
  public constructor() {
    super('Devbox command interrupted.')
  }
}
