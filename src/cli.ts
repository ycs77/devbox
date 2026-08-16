#!/usr/bin/env node

import type { CAC } from 'cac'
import type { GlobalConfiguration, LocalConfiguration } from './configuration.js'
import { createInterface } from 'node:readline/promises'
import { cac } from 'cac'
import {
  cleanupMissingProjects,
  configureGlobal,
  configureLocalProject,
  initializeProject,
  InterruptedError,
  removeProject,
  type ConfigurationPrompter,
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

interface PromptHandle {
  readonly prompt: ConfigurationPrompter
  readonly close: () => void
}

function createCli(signal: AbortSignal, interactive: boolean): CAC {
  const cli = cac('devbox')
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
      const result = await runWithPrompt(prompt => initializeProject({ signal, prompt }))
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
        const result = await runWithPrompt(prompt => configureGlobal({ signal, prompt }))
        if (!result.ok) {
          return result
        }
        return success({
          message: result.value.changed
            ? 'Global configuration updated.'
            : 'Global configuration was not changed.',
        })
      }

      const result = await runWithPrompt(prompt => configureLocalProject({ signal, prompt }))
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
      const result = await runWithPrompt(prompt =>
        removeProject({ signal, confirm: prompt.confirm, yes: options.yes }),
      )
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
      const result = await runWithPrompt(prompt =>
        cleanupMissingProjects({ signal, confirm: prompt.confirm, yes: options.yes }),
      )
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

async function runWithPrompt<T>(
  callback: (prompt: ConfigurationPrompter) => Promise<T>,
): Promise<T> {
  const handle = createPrompt()
  try {
    return await callback(handle.prompt)
  } finally {
    handle.close()
  }
}

function createPrompt(): PromptHandle {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (question: string, defaultValue: string): Promise<string> =>
    readline
      .question(`${question}${defaultValue === '' ? '' : ` [${defaultValue}]`}: `)
      .then(value => {
        return value.trim()
      })

  return {
    prompt: {
      confirm: async message => {
        const answer = (await ask(`${message} [Y/n]`, 'y')).toLowerCase()
        return answer === '' || answer === 'y' || answer === 'yes'
      },
      editGlobal: async (configuration, catalog): Promise<GlobalConfiguration> => {
        const runtimes: Record<string, readonly string[]> = {}
        for (const [family, entries] of Object.entries(catalog.runtimes)) {
          const current = configuration.runtimes[family]?.join(',') ?? ''
          const answer = await ask(
            `Configured ${family} release lines (${entries.join(', ')}, empty for none)`,
            current,
          )
          runtimes[family] =
            answer === '' || answer === '-' ? [] : answer.split(',').map(entry => entry.trim())
        }
        const agents = await ask(
          `Configured Agents (${catalog.agents.join(', ')}, empty for none)`,
          configuration.agents.join(','),
        )
        return {
          version: 1,
          runtimes,
          agents:
            agents === '' || agents === '-' ? [] : agents.split(',').map(agent => agent.trim()),
        }
      },
      editLocal: async (configuration, catalog): Promise<LocalConfiguration> => {
        const toolchain: Record<string, string | null> = {}
        for (const family of Object.keys(catalog.runtimes)) {
          const current = configuration.toolchain[family] ?? ''
          const answer = await ask(`Selected ${family} release line (empty for none)`, current)
          toolchain[family] = answer === '' || answer === '-' ? null : answer
        }
        const currentPorts = configuration.ports
          .map(port => `${port.host}:${port.container}`)
          .join(',')
        const portsAnswer = await ask(
          'Ports (host:container, comma-separated, empty for none)',
          currentPorts,
        )
        const ports =
          portsAnswer === '' || portsAnswer === '-'
            ? []
            : portsAnswer.split(',').map(port => {
                const [host, container] = port.split(':', 2)
                return { host: Number(host), container: Number(container) }
              })
        return { version: 1, toolchain, ports }
      },
    },
    close: () => readline.close(),
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
