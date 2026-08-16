import type { Readable, Writable } from 'node:stream'
import type { PortMapping } from './configuration.js'
import * as p from '@clack/prompts'
import { InterruptedError, type ConfigurationPrompter } from './project.js'

export interface ConfigurationPrompterOptions {
  readonly signal: AbortSignal
  readonly input?: Readable
  readonly output?: Writable
}

export function createConfigurationPrompter({
  signal,
  input,
  output,
}: ConfigurationPrompterOptions): ConfigurationPrompter {
  const common = { signal, input, output }

  return {
    confirm: async (message, details) => {
      if (details !== undefined) {
        p.note(details.content, details.title, common)
      }
      return promptValue(p.confirm({ message, ...common }))
    },
    editGlobal: async (configuration, catalog) => {
      const runtimes: Record<string, readonly string[]> = {}
      for (const [family, entries] of Object.entries(catalog.runtimes)) {
        runtimes[family] = await promptValue(
          p.multiselect({
            message: `Configured ${family} release lines`,
            options: entries.map(value => ({ value })),
            initialValues: [...(configuration.runtimes[family] ?? [])],
            required: false,
            ...common,
          }),
        )
      }
      const agents = await promptValue(
        p.multiselect({
          message: 'Configured Agents',
          options: catalog.agents.map(value => ({ value })),
          initialValues: [...configuration.agents],
          required: false,
          ...common,
        }),
      )
      return { version: 1, runtimes, agents }
    },
    editLocal: async (configuration, catalog, globalConfiguration) => {
      const toolchain: Record<string, string | null> = {}
      for (const family of Object.keys(catalog.runtimes)) {
        const options: Array<{ readonly value: string | null; readonly label: string }> = [
          { value: null, label: 'None' },
          ...(globalConfiguration.runtimes[family] ?? []).map(value => ({ value, label: value })),
        ]
        toolchain[family] = await promptValue(
          p.select<string | null>({
            message: `Selected ${family} release line`,
            options,
            initialValue: configuration.toolchain[family] ?? null,
            ...common,
          }),
        )
      }
      const inputValue = await promptValue(
        p.text({
          message: 'Ports (host:container, comma-separated, empty for none)',
          initialValue: configuration.ports.map(port => `${port.host}:${port.container}`).join(','),
          validate: value =>
            parsePortMappings(value) === undefined
              ? 'Enter host:container pairs with ports from 1 to 65535.'
              : undefined,
          ...common,
        }),
      )
      return {
        version: 1,
        toolchain,
        ports: requiredPortMappings(inputValue),
      }
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

function requiredPortMappings(value: string): readonly PortMapping[] {
  const ports = parsePortMappings(value)
  if (ports === undefined) {
    throw new Error('Port prompt returned an invalid value.')
  }
  return ports
}

function parsePortMappings(value: string | undefined): readonly PortMapping[] | undefined {
  if (value === undefined || value.trim() === '') {
    return []
  }

  const ports: PortMapping[] = []
  for (const mapping of value.split(',')) {
    const [hostValue, containerValue, ...extraValues] = mapping.split(':')
    if (hostValue === undefined || containerValue === undefined || extraValues.length > 0) {
      return undefined
    }

    const host = Number(hostValue.trim())
    const container = Number(containerValue.trim())
    if (
      !Number.isInteger(host) ||
      host < 1 ||
      host > 65535 ||
      !Number.isInteger(container) ||
      container < 1 ||
      container > 65535
    ) {
      return undefined
    }
    ports.push({ host, container })
  }
  return ports
}
