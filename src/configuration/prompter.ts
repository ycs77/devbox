import type { Readable, Writable } from 'node:stream'
import * as p from '@clack/prompts'
import c from 'picocolors'
import {
  InterruptedError,
  type ConfigurationPrompter,
  type ConfirmationDetails,
} from '../project/index.js'
import { normalizePortMappings } from './index.js'

export interface ConfigurationPrompterOptions {
  readonly signal: AbortSignal
  readonly input?: Readable
  readonly output?: Writable
}

export interface InteractiveConfigurationPrompter extends ConfigurationPrompter {
  readonly selectConfigurationScope: () => Promise<'global' | 'local'>
}
export function createConfigurationPrompter({
  signal,
  input,
  output,
}: ConfigurationPrompterOptions): InteractiveConfigurationPrompter {
  const common = { signal, input, output }

  return {
    confirm: async (message, details) => {
      if (details !== undefined) {
        p.note(renderConfirmationDetails(details), c.bold(c.cyan(details.title)), common)
      }
      return promptValue(p.confirm({ message, ...common }))
    },
    selectConfigurationScope: async () =>
      promptValue(
        p.select<'global' | 'local'>({
          message: 'Configuration scope',
          options: [
            { value: 'local', label: 'Current Project' },
            { value: 'global', label: 'Global' },
          ],
          ...common,
        }),
      ),
    editGlobal: async (configuration, catalog) => {
      p.log.step(
        `${c.bold(c.cyan('Global configuration'))}\n${c.dim(
          'Choose the runtimes and agents available to every Project.',
        )}`,
        common,
      )
      const node = await promptValue(
        p.multiselect<string>({
          message: 'Configured Node release lines',
          options: (catalog.runtimes.node ?? []).map(value => ({ value })),
          initialValues: [...configuration.node],
          required: false,
          ...common,
        }),
      )
      const agent = await promptValue(
        p.multiselect<string>({
          message: 'Configured Agents',
          options: catalog.agents.map(value => ({ value })),
          initialValues: [...configuration.agent],
          required: false,
          ...common,
        }),
      )
      const agent_notifications = await promptValue(
        p.confirm({
          message: 'Enable Agent notifications',
          initialValue: configuration.agent_notifications,
          ...common,
        }),
      )
      return { version: 1, node, agent, agent_notifications }
    },
    editLocal: async (configuration, catalog, globalConfiguration, editPorts = true) => {
      p.log.step(
        `${c.bold(c.cyan('Project configuration'))}\n${c.dim(
          editPorts
            ? 'Choose the runtime and published ports for this Project.'
            : 'Choose the replacement runtime for this Project.',
        )}`,
        common,
      )
      const node = await promptValue(
        p.select<string | null>({
          message: 'Selected Node release line',
          options: [
            { value: null, label: 'None' },
            ...(globalConfiguration.node ?? []).map(value => ({ value, label: value })),
          ],
          initialValue: configuration.node,
          ...common,
        }),
      )
      if (!editPorts) {
        return { ...configuration, node }
      }

      const source = await promptValue(
        p.multiline({
          message: 'Published ports',
          initialValue: configuration.ports.join('\n'),
          validate: value => {
            const ports = normalizePortMappings((value ?? '').split('\n'))
            return ports.ok ? undefined : ports.error.observed
          },
          ...common,
        }),
      )
      const ports = normalizePortMappings(source.split('\n'))
      if (!ports.ok) {
        throw new Error(ports.error.observed)
      }
      return { version: 1, node, ports: ports.value }
    },
  }
}

function renderConfirmationDetails(details: ConfirmationDetails): string {
  return details.sections
    .map(section =>
      [
        c.bold(section.title),
        `${c.yellow(c.dim('Current'))}\n${section.current}`,
        `${c.bold(c.green('New'))}\n${section.next}`,
      ].join('\n\n'),
    )
    .join('\n\n')
}

async function promptValue<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt
  if (p.isCancel(value)) {
    throw new InterruptedError()
  }
  return value as T
}
