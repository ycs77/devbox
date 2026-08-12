import { describe, expect, it, vi } from 'vitest'
import { validateSupportedHost } from '../src/host.js'

describe('validateSupportedHost', () => {
  it('rejects a non-WSL Linux host before Docker checks', async () => {
    const run = vi.fn()

    const result = await validateSupportedHost({
      platform: 'linux',
      arch: 'x64',
      procVersion: async () => 'Linux version 6.8.0-generic',
      run,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-host' } })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a missing Docker prerequisite with an actionable result', async () => {
    const run = vi.fn(async () => {
      throw new Error('not found')
    })

    const result = await validateSupportedHost({
      platform: 'linux',
      arch: 'x64',
      procVersion: async () => 'Linux version 6.6.0-microsoft-standard-WSL2',
      run,
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'missing-host-prerequisite',
        observed: 'Docker is unavailable.',
      },
    })
  })
})
