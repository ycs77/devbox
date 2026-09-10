import { describe, expect, it } from 'vitest'
import { parseGlobalConfiguration, parseLocalConfiguration } from '../../src/configuration/index.js'

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

  it('accepts packaged Antigravity and OMP Agents', () => {
    expect(
      parseGlobalConfiguration(
        'version: 1\nnode:\n  - "24"\nagent:\n  - agy\n  - omp\nagent_notifications: true\n',
      ),
    ).toEqual({
      ok: true,
      value: {
        version: 1,
        node: ['24'],
        agent: ['agy', 'omp'],
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
      value: { version: 1, node: null, ports: [] },
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

  it('normalizes valid Local port mappings', () => {
    const global = {
      version: 1 as const,
      node: ['24'] as const,
      agent: [] as const,
      agent_notifications: false,
    }

    expect(
      parseLocalConfiguration(
        'version: 1\nnode: null\nports:\n  - " 3000:3000 "\n  - " APP_PORT:5173:5173 "\n',
        global,
      ),
    ).toEqual({
      ok: true,
      value: {
        version: 1,
        node: null,
        ports: ['3000:3000', 'APP_PORT:5173:5173'],
      },
    })
  })

  it('rejects an invalid Local environment port mapping', () => {
    const global = {
      version: 1 as const,
      node: ['24'] as const,
      agent: [] as const,
      agent_notifications: false,
    }

    expect(
      parseLocalConfiguration('version: 1\nnode: null\nports:\n  - "APP-PORT:5173:5173"\n', global),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
  })

  it('rejects duplicate Local host ports', () => {
    const global = {
      version: 1 as const,
      node: ['24'] as const,
      agent: [] as const,
      agent_notifications: false,
    }

    expect(
      parseLocalConfiguration(
        'version: 1\nnode: null\nports:\n  - "3000:3000"\n  - "APP_PORT:3000:5173"\n',
        global,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
    expect(
      parseLocalConfiguration(
        'version: 1\nnode: null\nports:\n  - "3000:3000"\n  - "03000:4000"\n',
        global,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
  })

  it('enforces Local port number boundaries', () => {
    const global = {
      version: 1 as const,
      node: ['24'] as const,
      agent: [] as const,
      agent_notifications: false,
    }

    expect(
      parseLocalConfiguration('version: 1\nnode: null\nports:\n  - "1:65535"\n', global),
    ).toMatchObject({ ok: true })
    expect(
      parseLocalConfiguration('version: 1\nnode: null\nports:\n  - "0:3000"\n', global),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
    expect(
      parseLocalConfiguration('version: 1\nnode: null\nports:\n  - "65536:3000"\n', global),
    ).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
  })
})
