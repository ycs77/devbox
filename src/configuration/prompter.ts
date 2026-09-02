import type { Readable, Writable } from 'node:stream'
import * as p from '@clack/prompts'
import { InterruptedError, type ConfigurationPrompter } from '../project/index.js'

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
        p.note(details.content, details.title, common)
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
    editLocal: async (configuration, catalog, globalConfiguration) => {
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
      return { version: 1, node }
    },
  }
}

async function promptValue<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt
  if (p.isCancel(value)) {
    throw new InterruptedError()
  }
  return value as T
}
