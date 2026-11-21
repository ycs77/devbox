import { describe, expect, it } from 'vitest'
import {
  escapePathSegment,
  projectStateDirectory,
  sandboxIdentity,
  sandboxName,
  unescapePathSegment,
} from '../../src/project/registry.js'

describe('Sandbox identity encoding', () => {
  it('maps an absolute Project root to a safe flat identity and state directory', () => {
    const identity = sandboxIdentity(
      '/home/lucas/dev/testing/devbox/test-results/package-smoke-fixed/project',
    )

    expect(identity).toBe('home-lucas-dev-testing-devbox-test-results-package-smoke-fixed-project')
    expect(projectStateDirectory(identity, '/home/lucas/.devbox')).toBe(
      '/home/lucas/.devbox/projects/home-lucas-dev-testing-devbox-test-results-package-smoke-fixed-project',
    )
  })

  it('normalizes one-character Project basenames to Docker-safe Sandbox names', () => {
    expect(sandboxName('/workspace/a')).toBe('project-a')
  })

  it('round-trips unsafe path segments without opaque hashes', () => {
    const segment = 'nested directory_日本語%'

    expect(escapePathSegment(segment)).toBe('nested%20directory_%E6%97%A5%E6%9C%AC%E8%AA%9E%25')
    expect(unescapePathSegment(escapePathSegment(segment))).toBe(segment)
  })
})
