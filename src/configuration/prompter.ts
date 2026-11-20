import type { Readable, Writable } from 'node:stream'
import * as p from '@clack/prompts'
import c from 'picocolors'
import { InterruptedError } from '../result.js'
import {
  normalizePortMappings,
  type GlobalConfiguration,
  type LocalConfiguration,
  type RuntimeCatalog,
} from './index.js'

export interface ConfirmationSection {
  readonly title: string
  readonly current: string
  readonly next: string
}

export interface ConfirmationDetails {
  readonly title: string
  readonly sections: readonly ConfirmationSection[]
}

export type ConfirmationHandler = (
  message: string,
  details?: ConfirmationDetails,
) => Promise<boolean>

export interface ConfigurationPrompter {
  readonly confirm: ConfirmationHandler
  readonly editGlobal: (
    configuration: GlobalConfiguration,
    catalog: RuntimeCatalog,
  ) => Promise<GlobalConfiguration>
  readonly editLocal: (
    configuration: LocalConfiguration,
    catalog: RuntimeCatalog,
    globalConfiguration: GlobalConfiguration,
  ) => Promise<LocalConfiguration>
  readonly selectNodeReplacement: (
    configuration: LocalConfiguration,
    globalConfiguration: GlobalConfiguration,
  ) => Promise<LocalConfiguration>
}

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
  const selectNodeReplacement: ConfigurationPrompter['selectNodeReplacement'] = async (
    configuration,
    globalConfiguration,
  ) => {
    p.log.step(c.bold(c.cyan('Project configuration')), common)
    const node = await promptValue(
      p.select<string | null>({
        message: 'Selected Node release line',
        options: [
          { value: null, label: 'None' },
          ...globalConfiguration.node.map(value => ({ value, label: value })),
        ],
        initialValue: configuration.node,
        ...common,
      }),
    )
    return { ...configuration, node }
  }

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
          message: 'Where should this configuration apply?',
          options: [
            {
              value: 'local',
              label: 'Current project',
            },
            {
              value: 'global',
              label: 'Workspace Docker image',
            },
          ],
          ...common,
        }),
      ),
    editGlobal: async (configuration, catalog) => {
      p.log.step(c.bold(c.cyan('Workspace Docker image')), common)
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
    selectNodeReplacement,
    editLocal: async (configuration, _catalog, globalConfiguration) => {
      const { node } = await selectNodeReplacement(configuration, globalConfiguration)

      const source = await promptValue(
        p.multiline({
          message:
            'Published ports' +
            c.dim(' (multiline; one mapping per line; press Enter twice to submit)'),
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

async function promptValue<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
  const value = await prompt
  if (p.isCancel(value)) {
    throw new InterruptedError()
  }
  return value as Exclude<T, symbol>
}
