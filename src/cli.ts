#!/usr/bin/env node

import type { CAC } from 'cac'
import type { GlobalConfiguration, LocalConfiguration } from './configuration.js'
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { cac } from 'cac'
import {
  cleanupMissingProjects,
  configureGlobal,
  configureLocalProject,
  initializeProject,
  InterruptedError,
  removeProject,
  type CleanupMissingProjectsInput,
  type CleanupMissingProjectsResult,
  type ConfigurationPrompter,
  type ConfigureGlobalInput,
  type ConfigureGlobalResult,
  type ConfigureLocalInput,
  type ConfigureLocalResult,
  type InitializeProjectInput,
  type InitializeProjectResult,
  type RemoveProjectInput,
  type RemoveProjectResult,
} from './project.js'
import { failure, success, type Result } from './result.js'

interface CliDependencies {
  readonly initializeProject?: (input: InitializeProjectInput) => Promise<InitializeProjectResult>
  readonly configureLocalProject?: (input: ConfigureLocalInput) => Promise<ConfigureLocalResult>
  readonly configureGlobal?: (input: ConfigureGlobalInput) => Promise<ConfigureGlobalResult>
  readonly removeProject?: (input: RemoveProjectInput) => Promise<RemoveProjectResult>
  readonly cleanupMissingProjects?: (
    input: CleanupMissingProjectsInput,
  ) => Promise<CleanupMissingProjectsResult>
  readonly isInteractive?: () => boolean
  readonly prompt?: ConfigurationPrompter
}

interface CliSuccess {
  readonly projectRoot?: string
  readonly created?: boolean
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

function createCli(
  dependencies: Required<
    Pick<
      CliDependencies,
      | 'initializeProject'
      | 'configureLocalProject'
      | 'configureGlobal'
      | 'removeProject'
      | 'cleanupMissingProjects'
    >
  >,
  signal: AbortSignal,
  interactive: boolean,
): CAC {
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
      const result = await runWithPrompt(dependencies, prompt =>
        dependencies.initializeProject({ signal, prompt }),
      )
      if (!result.ok) {
        return result
      }
      return success({
        projectRoot: result.value.root,
        created: result.value.created,
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
        const result = await runWithPrompt(dependencies, prompt =>
          dependencies.configureGlobal({ signal, prompt }),
        )
        if (!result.ok) {
          return result
        }
        return success({
          message: result.value.changed
            ? 'Global configuration updated.'
            : 'Global configuration was not changed.',
        })
      }

      const result = await runWithPrompt(dependencies, prompt =>
        dependencies.configureLocalProject({ signal, prompt }),
      )
      if (!result.ok) {
        return result
      }
      return success({
        projectRoot: result.value.root,
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
      const result = await runWithPrompt(dependencies, prompt =>
        dependencies.removeProject({ signal, confirm: prompt.confirm, yes: options.yes }),
      )
      if (!result.ok) {
        return result
      }
      return success({
        projectRoot: result.value.root,
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
      const result = await runWithPrompt(dependencies, prompt =>
        dependencies.cleanupMissingProjects({ signal, confirm: prompt.confirm, yes: options.yes }),
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

  if (result.value.message !== undefined) {
    output.stdout.write(`${result.value.message}\n`)
  } else if (result.value.created !== undefined && result.value.projectRoot !== undefined) {
    output.stdout.write(
      result.value.created
        ? `Registered Project: ${result.value.projectRoot}\n`
        : `Project is already registered: ${result.value.projectRoot}\n`,
    )
  }
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

  const interactive =
    dependencies?.isInteractive?.() ??
    (process.stdin.isTTY === true && process.stdout.isTTY === true)
  const cliDependencies = {
    initializeProject:
      dependencies?.initializeProject ??
      ((input: InitializeProjectInput) => initializeProject(input)),
    configureLocalProject:
      dependencies?.configureLocalProject ??
      ((input: ConfigureLocalInput) => configureLocalProject(input)),
    configureGlobal:
      dependencies?.configureGlobal ?? ((input: ConfigureGlobalInput) => configureGlobal(input)),
    removeProject:
      dependencies?.removeProject ?? ((input: RemoveProjectInput) => removeProject(input)),
    cleanupMissingProjects:
      dependencies?.cleanupMissingProjects ??
      ((input: CleanupMissingProjectsInput) => cleanupMissingProjects(input)),
  }
  const cli = createCli(cliDependencies, abortController.signal, interactive)

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

async function runWithPrompt<T>(
  dependencies: CliDependencies,
  callback: (prompt: ConfigurationPrompter) => Promise<T>,
): Promise<T> {
  if (dependencies.prompt !== undefined) {
    return callback(dependencies.prompt)
  }
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await main()
}
