import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { failure, success, type Result } from './result.js'

const execFile = promisify(execFileCallback)

export interface HostEnvironment {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly procVersion: () => Promise<string>
  readonly run: (file: string, args: readonly string[]) => Promise<void>
}

const supportedHostAction =
  'Run Devbox from 64-bit WSL2 with Docker Desktop and Docker Compose available.'

export function currentHostEnvironment(): HostEnvironment {
  return {
    platform: process.platform,
    arch: process.arch,
    procVersion: () => readFile('/proc/version', 'utf8'),
    run: async (file, args) => {
      await execFile(file, args)
    },
  }
}

export async function validateSupportedHost(
  environment: HostEnvironment = currentHostEnvironment(),
): Promise<Result<void>> {
  if (environment.platform !== 'linux' || environment.arch !== 'x64') {
    return failure({
      kind: 'validation',
      code: 'unsupported-host',
      observed: `Devbox supports only WSL2 linux/amd64; detected ${environment.platform}/${environment.arch}.`,
      nextAction: supportedHostAction,
    })
  }

  let procVersion: string
  try {
    procVersion = await environment.procVersion()
  } catch {
    return failure({
      kind: 'validation',
      code: 'unsupported-host',
      observed: 'Devbox could not verify that this Linux host is WSL2.',
      nextAction: supportedHostAction,
    })
  }

  if (!/microsoft|wsl/i.test(procVersion)) {
    return failure({
      kind: 'validation',
      code: 'unsupported-host',
      observed: 'Devbox supports WSL2, but this Linux host is not WSL2.',
      nextAction: supportedHostAction,
    })
  }

  for (const [file, args, description] of [
    ['docker', ['--version'], 'Docker'],
    ['docker', ['compose', 'version'], 'Docker Compose'],
  ] as const) {
    try {
      await environment.run(file, args)
    } catch {
      return failure({
        kind: 'validation',
        code: 'missing-host-prerequisite',
        observed: `${description} is unavailable.`,
        nextAction: supportedHostAction,
      })
    }
  }

  return success(undefined)
}
