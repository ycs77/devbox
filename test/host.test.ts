import { describe, expect, it, vi } from 'vitest'
import { validateSupportedHost } from '../src/host.js'

describe('validateSupportedHost', () => {
  it('reports a missing Docker prerequisite with an actionable result', async () => {
    const run = vi.fn(async () => {
      throw new Error('not found')
    })

    const result = await validateSupportedHost({
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
