import { describe, expect, it } from 'vitest'
import { parseGlobalConfiguration, parseLocalConfiguration } from '../src/configuration.js'

describe('configuration schemas', () => {
  it('accepts the Global configuration boundary', () => {
    expect(
      parseGlobalConfiguration(
        'version: 1\nnode:\n  - "24"\nagent:\n  - codex\nagent_notifications: true\n',
      ),
    ).toEqual({
      ok: true,
      value: {
        version: 1,
        node: ['24'],
        agent: ['codex'],
        agent_notifications: true,
      },
    })
  })

  it('rejects superseded Global and Local fields', () => {
    expect(
      parseGlobalConfiguration('version: 1\nruntimes:\n  node:\n    - "24"\nagents: []\n'),
    ).toMatchObject({ ok: false, error: { code: 'invalid-global-configuration' } })
    expect(
      parseLocalConfiguration('version: 1\ntoolchain:\n  node: "24"\nports: []\n', {
        version: 1,
        node: ['24'],
        agent: [],
        agent_notifications: true,
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
  })

  it('accepts a nullable Selected Node Runtime only when configured globally', () => {
    const global = {
      version: 1 as const,
      node: ['24'] as const,
      agent: [] as const,
      agent_notifications: false,
    }

    expect(parseLocalConfiguration('version: 1\nnode: null\n', global)).toEqual({
      ok: true,
      value: { version: 1, node: null },
    })
    expect(parseLocalConfiguration('version: 1\nnode: ""\n', global)).toMatchObject({
      ok: false,
      error: { code: 'invalid-local-configuration' },
    })
    expect(parseLocalConfiguration('version: 1\nnode: "22"\n', global)).toMatchObject({
      ok: false,
      error: { code: 'unconfigured-runtime-selection' },
    })
  })
})
