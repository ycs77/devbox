import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { failure, success, type Result } from './result.js'

const execFile = promisify(execFileCallback)

export interface HostEnvironment {
  readonly run: (file: string, args: readonly string[]) => Promise<void>
  readonly runDirect?: (file: string, args: readonly string[]) => Promise<void>
}

export class HostCommandError extends Error {
  public constructor(
    file: string,
    args: readonly string[],
    readonly exitCode: number,
  ) {
    super(`${file} ${args.join(' ')} exited with status ${exitCode}.`)
    this.name = 'HostCommandError'
  }
}

const supportedHostAction = 'Start Docker Desktop and ensure Docker Compose is available.'

export function currentHostEnvironment(): HostEnvironment {
  return {
    run: async (file, args) => {
      await execFile(file, args)
    },
    runDirect: async (file, args) =>
      new Promise<void>((resolve, reject) => {
        const command = spawn(file, args, { stdio: 'inherit' })
        command.once('error', reject)
        command.once('close', code => {
          if (code === 0) {
            resolve()
            return
          }
          reject(new HostCommandError(file, args, code ?? 1))
        })
      }),
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
