import type { ConfigurationPrompter } from '../../src/configuration/prompter.js'

export function configurationPrompter(
  overrides: Partial<ConfigurationPrompter> = {},
): ConfigurationPrompter {
  return {
    confirm: async () => true,
    editGlobal: async configuration => configuration,
    editLocal: async configuration => configuration,
    selectNodeReplacement: async (configuration, globalConfiguration) => ({
      ...configuration,
      node: globalConfiguration.node.includes(configuration.node ?? '')
        ? configuration.node
        : (globalConfiguration.node[0] ?? null),
    }),
    ...overrides,
  }
}
