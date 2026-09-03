import { describe, expect, it, vi } from 'vitest'
import { ensureSharedAgentVolumes } from '../src/shared-agent-volumes.js'

describe('ensureSharedAgentVolumes', () => {
  it('creates only Shared Agent volumes for the Configured Agent set', async () => {
    const run = vi.fn(async () => {})

    await ensureSharedAgentVolumes(['claude-code', 'omp'], { run })

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

  it('does not invoke Docker when no Agents are configured', async () => {
    const run = vi.fn(async () => {})

    await ensureSharedAgentVolumes([], { run })

    expect(run).not.toHaveBeenCalled()
  })
})
