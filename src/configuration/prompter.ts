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

export interface PromptOptions {
  readonly signal: AbortSignal | undefined
  readonly input?: Readable
  readonly output?: Writable
}

export async function confirm(
  message: string,
  details: ConfirmationDetails | undefined,
  options: PromptOptions,
): Promise<boolean> {
  if (details !== undefined) {
    p.note(renderConfirmationDetails(details), c.bold(c.cyan(details.title)), options)
  }
  return promptValue(p.confirm({ message, ...options }))
}

export async function selectConfigurationScope(
  options: PromptOptions,
): Promise<'global' | 'local'> {
  return promptValue(
    p.select<'global' | 'local'>({
      message: 'Where should this configuration apply?',
      options: [
        { value: 'local', label: 'Current project' },
        { value: 'global', label: 'Workspace Docker image' },
      ],
      ...options,
    }),
  )
}

export async function editGlobal(
  configuration: GlobalConfiguration,
  catalog: RuntimeCatalog,
  options: PromptOptions,
): Promise<GlobalConfiguration> {
  p.log.step(c.bold(c.cyan('Workspace Docker image')), options)
  const node = await promptValue(
    p.multiselect<string>({
      message: 'Configured Node release lines',
      options: (catalog.runtimes.node ?? []).map(value => ({ value })),
      initialValues: [...configuration.node],
      required: false,
      ...options,
    }),
  )
  const agent = await promptValue(
    p.multiselect<string>({
      message: 'Configured Agents',
      options: catalog.agents.map(value => ({ value })),
      initialValues: [...configuration.agent],
      required: false,
      ...options,
    }),
  )
  const agent_notifications = await promptValue(
    p.confirm({
      message: 'Enable Agent notifications',
      initialValue: configuration.agent_notifications,
      ...options,
    }),
  )
  return { version: 1, node, agent, agent_notifications }
}

export async function selectNodeReplacement(
  configuration: LocalConfiguration,
  globalConfiguration: GlobalConfiguration,
  options: PromptOptions,
): Promise<LocalConfiguration> {
  p.log.step(c.bold(c.cyan('Project configuration')), options)
  const node = await promptValue(
    p.select<string | null>({
      message: 'Selected Node release line',
      options: [
        { value: null, label: 'None' },
        ...globalConfiguration.node.map(value => ({ value, label: value })),
      ],
      initialValue: configuration.node,
      ...options,
    }),
  )
  return { ...configuration, node }
}

export async function editLocal(
  configuration: LocalConfiguration,
  globalConfiguration: GlobalConfiguration,
  options: PromptOptions,
): Promise<LocalConfiguration> {
  const { node } = await selectNodeReplacement(configuration, globalConfiguration, options)
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
      ...options,
    }),
  )
  const ports = normalizePortMappings(source.split('\n'))
  if (!ports.ok) {
    throw new Error(ports.error.observed)
  }
  return { version: 1, node, ports: ports.value }
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
