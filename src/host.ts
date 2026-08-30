import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { failure, success, type Result } from './result.js'

const execFile = promisify(execFileCallback)

export interface HostEnvironment {
  readonly run: (file: string, args: readonly string[]) => Promise<void>
}

const supportedHostAction = 'Start Docker Desktop and ensure Docker Compose is available.'

export function currentHostEnvironment(): HostEnvironment {
  return {
    run: async (file, args) => {
      await execFile(file, args)
    },
  }
}

export async function validateSupportedHost(
  environment: HostEnvironment = currentHostEnvironment(),
): Promise<Result<void>> {
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
