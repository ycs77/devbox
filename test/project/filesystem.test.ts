import { mkdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fs, vol } from 'memfs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureGlobal,
  configureLocalProject,
  initializeProject,
  projectStateDirectory,
  sandboxIdentity,
} from '../../src/project/index.js'
import { success } from '../../src/result.js'

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

  it('preserves the retained Compose definition when Local publication fails', async () => {
    const { devboxHome, projectRoot } = await createProjectState()
    const stateDirectory = projectStateDirectory(sandboxIdentity(projectRoot), devboxHome)
    const localPath = join(stateDirectory, 'config.yaml')
    const composePath = join(stateDirectory, 'compose.yaml')
    const localBefore = await readFile(localPath, 'utf8')
    const composeBefore = await readFile(composePath, 'utf8')
    vi.mocked(rename)
      .mockImplementationOnce(memfsRename)
      .mockRejectedValueOnce(new Error('disk full'))

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, node: null, ports: [] },
      confirm: async () => true,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'state-write-failed' },
    })
    await expect(readFile(localPath, 'utf8')).resolves.toBe(localBefore)
    await expect(readFile(composePath, 'utf8')).resolves.toBe(composeBefore)
  })

  it('restores all configuration when publication fails after an affected Local write', async () => {
    const { devboxHome, projectRoot } = await createProjectState()
    const secondProjectRoot = '/workspace/second-project'
    await mkdir(secondProjectRoot, { recursive: true })
    const secondProject = await initializeProject({
      root: secondProjectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => true,
    })
    expect(secondProject).toMatchObject({ ok: true, value: { created: true } })
    if (!secondProject.ok) {
      throw new Error('Second Project initialization failed.')
    }
    const stateDirectory = projectStateDirectory(sandboxIdentity(projectRoot), devboxHome)
    const globalPath = join(devboxHome, 'config.yaml')
    const localPath = join(stateDirectory, 'config.yaml')
    const secondLocalPath = join(secondProject.value.stateDirectory, 'config.yaml')
    const globalBefore = await readFile(globalPath, 'utf8')
    const localBefore = await readFile(localPath, 'utf8')
    const secondLocalBefore = await readFile(secondLocalPath, 'utf8')
    vi.mocked(rename)
      .mockImplementationOnce(memfsRename)
      .mockImplementationOnce(memfsRename)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(memfsRename)

    const result = await configureGlobal({
      devboxHome,
      nextConfiguration: { version: 1, node: [], agent: [], agent_notifications: true },
      nextLocalConfigurations: {
        [projectRoot]: { version: 1, node: null, ports: [] },
        [secondProjectRoot]: { version: 1, node: null, ports: [] },
      },
      confirm: async () => true,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'state-write-failed' },
    })
    await expect(readFile(globalPath, 'utf8')).resolves.toBe(globalBefore)
    await expect(readFile(localPath, 'utf8')).resolves.toBe(localBefore)
    await expect(readFile(secondLocalPath, 'utf8')).resolves.toBe(secondLocalBefore)
  })
})
