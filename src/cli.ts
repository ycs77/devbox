#!/usr/bin/env node

import type { CAC } from 'cac'
import { cac } from 'cac'
import { createConfigurationPrompter } from './configuration-prompter.js'
import {
  cleanupMissingProjects,
  configureGlobal,
  configureLocalProject,
  initializeProject,
  InterruptedError,
  removeProject,
} from './project.js'
import { failure, success, type Result } from './result.js'

interface CliSuccess {
  readonly message?: string
}

type CliResult = Result<CliSuccess>

interface CommandOptions {
  readonly global?: boolean
  readonly yes?: boolean
  readonly missingProjects?: boolean
}

function createCli(signal: AbortSignal, interactive: boolean): CAC {
  const cli = cac('devbox')
  const prompt = createConfigurationPrompter({ signal })
  cli.usage('<command> [options]')

  cli
    .command('init', 'Register the current directory as a Devbox Project.')
    .action(async (): Promise<CliResult> => {
      if (!interactive) {
        return interactiveFailure(
          'devbox init requires an interactive terminal.',
          'Run devbox init from a TTY before it writes Project state.',
        )
      }
      const result = await initializeProject({ signal, prompt })
      if (!result.ok) {
        return result
      }
      return success({
        message: result.value.created
          ? `Registered Project: ${result.value.root}`
          : result.value.confirmed === false
            ? 'Project registration was not changed.'
            : `Project is already registered: ${result.value.root}`,
      })
    })

  cli
    .command('config', 'Edit Local or Global configuration.')
    .option('-g, --global', 'Edit Global configuration instead of the current Project.')
    .action(async (options: CommandOptions = {}): Promise<CliResult> => {
      if (!interactive) {
        return interactiveFailure(
          'devbox config requires an interactive terminal.',
          'Run devbox config from a TTY, or edit the supported Global or Local YAML directly.',
        )
      }
      if (options.global) {
        const result = await configureGlobal({ signal, prompt })
        if (!result.ok) {
          return result
        }
        return success({
          message: result.value.changed
            ? 'Global configuration updated.'
            : 'Global configuration was not changed.',
        })
      }

      const result = await configureLocalProject({ signal, prompt })
      if (!result.ok) {
        return result
      }
      return success({
        message: result.value.changed
          ? 'Local configuration updated.'
          : 'Local configuration was not changed.',
      })
    })

  cli
    .command('rm', 'Remove the current registered Project and its state.')
    .option('--yes', 'Skip the confirmation prompt.')
    .action(async (options: CommandOptions = {}): Promise<CliResult> => {
      if (!interactive && !options.yes) {
        return interactiveFailure(
          'devbox rm requires a TTY or --yes.',
          'Run devbox rm from a TTY, or pass --yes to confirm removal.',
        )
      }
      const result = await removeProject({ signal, confirm: prompt.confirm, yes: options.yes })
      if (!result.ok) {
        return result
      }
      return success({
        message: result.value.removed
          ? `Removed Project: ${result.value.root}`
          : 'Project removal was not changed.',
      })
    })

  cli
    .command('cleanup', 'Remove explicitly selected disposable Devbox state.')
    .option('--missing-projects', 'Remove Missing-root Project registrations.')
    .option('--yes', 'Skip the confirmation prompt.')
    .action(async (options: CommandOptions = {}): Promise<CliResult> => {
      if (!options.missingProjects) {
        return failure({
          kind: 'usage',
          code: 'cleanup-mode-required',
          observed: 'cleanup requires --missing-projects.',
          nextAction: 'Run devbox cleanup --missing-projects.',
        })
      }
      if (!interactive && !options.yes) {
        return interactiveFailure(
          'devbox cleanup --missing-projects requires a TTY or --yes.',
          'Run devbox cleanup --missing-projects from a TTY, or pass --yes to confirm removal.',
        )
      }
      const result = await cleanupMissingProjects({
        signal,
        confirm: prompt.confirm,
        yes: options.yes,
      })
      if (!result.ok) {
        return result
      }
      return success({
        message: result.value.removed
          ? `Removed Missing-root Projects: ${result.value.roots.join(', ')}`
          : 'No Missing-root Projects were removed.',
      })
    })

  cli
    .command('', '')
    .usage('<command> [options]')
    .action(() => cli.globalCommand.outputHelp())

  cli.help()

  return cli
}

function present(result: CliResult): number {
  if (!result.ok) {
    process.stderr.write(`${result.error.observed}\n${result.error.nextAction}\n`)
    return result.error.kind === 'usage' ? 2 : 1
  }

  if (result.value.message !== undefined) {
    process.stdout.write(`${result.value.message}\n`)
  }
  return 0
}

async function main(): Promise<number> {
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)

  const cli = createCli(
    abortController.signal,
    process.stdin.isTTY === true && process.stdout.isTTY === true,
  )

  try {
    cli.parse(process.argv, { run: false })
    const result = (await cli.runMatchedCommand()) as CliResult | undefined
    return result === undefined ? 0 : present(result)
  } catch (error) {
    if (error instanceof InterruptedError || abortController.signal.aborted) {
      process.stderr.write('Devbox command interrupted.\n')
      return 130
    }

    throw error
  } finally {
    process.off('SIGINT', interrupt)
  }
}

function interactiveFailure(observed: string, nextAction: string): Result<never> {
  return failure({
    kind: 'usage',
    code: 'interactive-terminal-required',
    observed,
    nextAction,
  })
}

process.exitCode = await main()
