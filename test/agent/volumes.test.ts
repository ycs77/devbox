import { describe, expect, it, vi } from 'vitest'
import { ensureSharedAgentVolumes } from '../../src/agent/volumes.js'

describe('ensureSharedAgentVolumes', () => {
  it('creates external volumes by their Compose names, not Agent catalog entries', async () => {
    const run = vi.fn(async () => {})

    const result = await ensureSharedAgentVolumes(
      `volumes:
  claude:
    name: devbox-claude
    external: true
  duplicate:
    name: devbox-claude
    external: true
  devbox-omp:
    external: true
  internal:
    name: devbox-codex
  anonymous: null
`,
      { run },
    )
    expect(result).toEqual({ ok: true, value: undefined })

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledWith('docker', [
      'volume',
      'create',
      '--driver',
      'local',
      'devbox-claude',
    ])
    expect(run).toHaveBeenCalledWith('docker', [
      'volume',
      'create',
      '--driver',
      'local',
      'devbox-omp',
    ])
  })

  it('does not invoke Docker when Compose has no external volumes', async () => {
    const run = vi.fn(async () => {})

    await ensureSharedAgentVolumes('services: {}', { run })

    expect(run).not.toHaveBeenCalled()
  })

  it.each(['volumes: [', 'volumes: []', 'volumes: { agent: { external: true, name: 42 } }'])(
    'rejects unreadable external volumes without provisioning anything: %s',
    async source => {
      const run = vi.fn(async () => {})

      const result = await ensureSharedAgentVolumes(source, { run })

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-project-compose' } })
      expect(run).not.toHaveBeenCalled()
    },
  )
})
