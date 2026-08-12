#!/usr/bin/env node

import type { CAC } from 'cac'
import type { Result } from './result.js'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { cac } from 'cac'
import { initializeProject, InterruptedError } from './project.js'

interface CliDependencies {
  readonly initializeProject: typeof initializeProject
}

interface CliSuccess {
  readonly projectRoot: string
  readonly created: boolean
}

type CliResult = Result<CliSuccess>

function createCli(dependencies: CliDependencies): CAC {
  const cli = cac('devbox')
  cli.usage('<command> [options]')

  cli
    .command('init', 'Register the current directory as a Devbox Project.')
    .action(async (): Promise<CliResult> => {
      const registration = await dependencies.initializeProject()
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
    })

  cli
    .command('', '')
    .usage('<command> [options]')
    .action(() => cli.globalCommand.outputHelp())

  cli.help(sections => {
    const commandSection = sections.find(section => section.title === 'Commands')
    if (commandSection) {
      commandSection.body = commandSection.body.trimEnd()
    }
    return sections
  })
  return cli
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

  output.stdout.write(
    result.value.created
      ? `Registered Project: ${result.value.projectRoot}\n`
      : `Project is already registered: ${result.value.projectRoot}\n`,
  )
  return 0
}

function isCacError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'CACError'
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  dependencies?: CliDependencies,
  output: TerminalOutput = process,
): Promise<number> {
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)

  const cliDependencies = dependencies ?? {
    initializeProject: () => initializeProject({ signal: abortController.signal }),
  }
  const cli = createCli(cliDependencies)

  try {
    cli.parse(['node', 'devbox', ...args], { run: false })
    const result = (await cli.runMatchedCommand()) as CliResult | undefined
    return result === undefined ? 0 : present(result, output)
  } catch (error) {
    if (error instanceof InterruptedError || abortController.signal.aborted) {
      output.stderr.write('Devbox command interrupted.\n')
      return 130
    }

    if (isCacError(error)) {
      output.stderr.write(`${error.message}\n`)
      return 1
    }

    output.stderr.write('Devbox encountered an unexpected failure. Run devbox init again.\n')
    return 1
  } finally {
    process.off('SIGINT', interrupt)
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await main()
}
