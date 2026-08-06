#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { defineCommand, runCommand } from 'citty'
import { initializeProject, InterruptedError } from './project.js'
import { failure, type Result } from './result.js'

interface CliDependencies {
  readonly initializeProject: typeof initializeProject
}

interface CliSuccess {
  readonly projectRoot: string
  readonly created: boolean
}

type CliResult = Result<CliSuccess>

const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Register the current directory as a Devbox Project.',
  },
  run: async (context): Promise<CliResult> => {
    if (context.rawArgs.length > 0) {
      return failure({
        kind: 'usage',
        code: 'unexpected-init-arguments',
        observed: 'devbox init does not accept arguments.',
        nextAction: 'Run devbox init without arguments.',
      })
    }

    const registration = await (context.data as CliDependencies).initializeProject()
    if (!registration.ok) {
      return registration
    }

    return {
      ok: true,
      value: {
        projectRoot: registration.value.root,
        created: registration.value.created,
      },
    }
  },
})

const rootCommand = defineCommand({
  meta: {
    name: 'devbox',
    description: 'Prepare and run the Devbox Node Toolchain.',
  },
  args: {
    command: {
      type: 'positional',
      required: true,
    },
  },
  run: async (context): Promise<CliResult> => {
    if (context.args.command !== 'init') {
      return failure({
        kind: 'usage',
        code: 'unknown-command',
        observed: `Unknown command: ${context.args.command}.`,
        nextAction: 'Run devbox --help to see available commands.',
      })
    }

    const { result } = await runCommand(initCommand, {
      rawArgs: context.rawArgs.slice(1),
      data: context.data,
    })
    return result as CliResult
  },
})

export async function runCli(
  rawArgs: readonly string[],
  dependencies: CliDependencies = { initializeProject },
): Promise<CliResult> {
  if (rawArgs.length === 1 && (rawArgs[0] === '--help' || rawArgs[0] === '-h')) {
    return {
      ok: true,
      value: {
        projectRoot: '',
        created: false,
      },
    }
  }

  try {
    const { result } = await runCommand(rootCommand, {
      rawArgs: [...rawArgs],
      data: dependencies,
    })
    return result as CliResult
  } catch (error) {
    if (error instanceof InterruptedError) {
      throw error
    }

    return failure({
      kind: 'usage',
      code: 'invalid-command-usage',
      observed: error instanceof Error ? error.message : 'Invalid Devbox command usage.',
      nextAction: 'Run devbox --help to see available commands.',
    })
  }
}

interface TerminalOutput {
  readonly stdout: { write(message: string): unknown }
  readonly stderr: { write(message: string): unknown }
}

export function present(result: CliResult, output: TerminalOutput = process): number {
  if (!result.ok) {
    output.stderr.write(`${result.error.observed}\n${result.error.nextAction}\n`)
    return result.error.kind === 'usage' ? 2 : 1
  }

  if (result.value.projectRoot === '') {
    output.stdout.write(
      'Usage: devbox init\n\nRegister the current directory as a Devbox Project.\n',
    )
    return 0
  }

  output.stdout.write(
    result.value.created
      ? `Registered Project: ${result.value.projectRoot}\n`
      : `Project is already registered: ${result.value.projectRoot}\n`,
  )
  return 0
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)

  try {
    const result = await runCli(process.argv.slice(2), {
      initializeProject: () => initializeProject({ signal: abortController.signal }),
    })
    process.exitCode = present(result)
  } catch (error) {
    if (error instanceof InterruptedError || abortController.signal.aborted) {
      process.stderr.write('Devbox command interrupted.\n')
      process.exitCode = 130
      return
    }

    process.stderr.write('Devbox encountered an unexpected failure. Run devbox init again.\n')
    process.exitCode = 1
  } finally {
    process.off('SIGINT', interrupt)
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await main()
}
