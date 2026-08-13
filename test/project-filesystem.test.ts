import { mkdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fs, vol } from 'memfs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLocalProject, initializeProject, projectStateDirectory } from '../src/project.js'
import { success } from '../src/result.js'

vi.mock('node:fs/promises', async () => {
  // The mock factory runs before static imports, so memfs must load inside it.
  const { fs } = await import('memfs')
  return {
    ...fs.promises,
    readFile: vi.fn(fs.promises.readFile),
    rename: vi.fn(fs.promises.rename),
  }
})

const projectRoot = '/workspace/project'
const devboxHome = '/workspace/user-state/.devbox'
const memfsReadFile = fs.promises.readFile.bind(fs.promises) as typeof readFile
const memfsRename = fs.promises.rename.bind(fs.promises) as typeof rename

beforeEach(() => {
  vol.reset()
  vi.mocked(readFile).mockReset().mockImplementation(memfsReadFile)
  vi.mocked(rename).mockReset().mockImplementation(memfsRename)
})

async function createProjectState(): Promise<{
  readonly devboxHome: string
  readonly projectRoot: string
}> {
  await mkdir(projectRoot, { recursive: true })

  const result = await initializeProject({
    root: projectRoot,
    devboxHome,
    validateHost: async () => success(undefined),
    confirm: async () => true,
  })
  expect(result).toMatchObject({ ok: true, value: { root: projectRoot, created: true } })

  return { devboxHome, projectRoot }
}

describe('Project filesystem failures', () => {
  it('returns a state-read failure when the Project registry cannot be read', async () => {
    const { devboxHome, projectRoot } = await createProjectState()
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    )

    const result = await configureLocalProject({ root: projectRoot, devboxHome })

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'operational',
        code: 'state-read-failed',
        observed: expect.stringContaining('projects.yaml'),
      },
    })
  })

  it('returns a state-write failure and preserves the previous Local configuration', async () => {
    const { devboxHome, projectRoot } = await createProjectState()
    const localPath = join(projectStateDirectory(projectRoot, devboxHome), 'config.yaml')
    const before = await readFile(localPath, 'utf8')
    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'))

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, toolchain: { node: null }, ports: [] },
      confirm: async () => true,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'state-write-failed' },
    })
    await expect(readFile(localPath, 'utf8')).resolves.toBe(before)
  })
})
