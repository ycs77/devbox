import type * as Host from '../../src/host.js'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fs, vol } from 'memfs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirm,
  editGlobal,
  editLocal,
  selectNodeReplacement,
} from '../../src/configuration/prompter.js'
import { validateSupportedHost } from '../../src/host.js'
import {
  configureGlobal,
  configureLocalProject,
  initializeProject,
} from '../../src/project/index.js'
import { projectStateDirectory, sandboxIdentity } from '../../src/project/registry.js'
import { success } from '../../src/result.js'

vi.mock('node:fs/promises', async () => {
  // The mock factory runs before static imports, so memfs must load inside it.
  const { fs } = await import('memfs')
  return {
    ...fs.promises,
    readFile: vi.fn(fs.promises.readFile),
    rename: vi.fn(fs.promises.rename),
    writeFile: vi.fn(fs.promises.writeFile),
  }
})

vi.mock('../../src/configuration/prompter.js', () => ({
  confirm: vi.fn(),
  editGlobal: vi.fn(),
  editLocal: vi.fn(),
  selectNodeReplacement: vi.fn(),
}))

vi.mock('../../src/host.js', async importOriginal => ({
  ...(await importOriginal<typeof Host>()),
  validateSupportedHost: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(selectNodeReplacement).mockReset()
  vi.mocked(confirm).mockReset().mockResolvedValue(true)
  vi.mocked(editGlobal)
    .mockReset()
    .mockImplementation(async configuration => configuration)
  vi.mocked(editLocal)
    .mockReset()
    .mockImplementation(async configuration => configuration)
  vi.mocked(validateSupportedHost).mockReset().mockResolvedValue(success(undefined))
})

const projectRoot = '/workspace/project'
const devboxHome = '/workspace/user-state/.devbox'
const memfsReadFile = fs.promises.readFile.bind(fs.promises) as typeof readFile
const memfsRename = fs.promises.rename.bind(fs.promises) as typeof rename
const memfsWriteFile = fs.promises.writeFile.bind(fs.promises) as typeof writeFile

beforeEach(() => {
  vol.reset()
  vi.mocked(readFile).mockReset().mockImplementation(memfsReadFile)
  vi.mocked(rename).mockReset().mockImplementation(memfsRename)
  vi.mocked(writeFile).mockReset().mockImplementation(memfsWriteFile)
})

async function createProjectState(): Promise<{
  readonly devboxHome: string
  readonly projectRoot: string
}> {
  await mkdir(projectRoot, { recursive: true })

  const result = await initializeProject({ root: projectRoot, devboxHome })
  expect(result).toMatchObject({
    ok: true,
    value: {
      root: projectRoot,
      created: true,
      stateDirectory: '/workspace/user-state/.devbox/projects/workspace-project',
    },
  })

  return { devboxHome, projectRoot }
}

describe('Project filesystem failures', () => {
  it('does not retain partial registration when initial publication fails', async () => {
    await mkdir(projectRoot, { recursive: true })
    vi.mocked(confirm).mockImplementationOnce(async () => {
      await mkdir(devboxHome, { recursive: true })
      await writeFile(join(devboxHome, 'config.yaml'), '# created while confirming\n')
      return true
    })
    vi.mocked(rename)
      .mockImplementationOnce(memfsRename)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(memfsRename)

    const result = await initializeProject({ root: projectRoot, devboxHome })

    expect(result).toMatchObject({ ok: false, error: { code: 'state-write-failed' } })
    for (const path of [
      join(devboxHome, 'config.yaml'),
      join(devboxHome, 'projects.yaml'),
      join(devboxHome, 'projects', 'workspace-project', 'config.yaml'),
      join(devboxHome, 'projects', 'workspace-project', 'compose.yaml'),
    ]) {
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('restores every definition when an unchanged Global refresh fails partway through', async () => {
    await createProjectState()
    const secondRoot = '/workspace/second-project'
    await mkdir(secondRoot, { recursive: true })
    const second = await initializeProject({ root: secondRoot, devboxHome })
    if (!second.ok) {
      throw new Error(second.error.observed)
    }
    const firstDirectory = projectStateDirectory(sandboxIdentity(projectRoot), devboxHome)
    const composePaths = [
      join(firstDirectory, 'compose.yaml'),
      join(second.value.stateDirectory, 'compose.yaml'),
    ]
    const before = await Promise.all(composePaths.map(path => readFile(path, 'utf8')))
    const globalPath = join(devboxHome, 'config.yaml')
    const manualYaml =
      '# manually selected Agent\nversion: 1\nnode: ["24"]\nagent: [codex]\nagent_notifications: false\n'
    await writeFile(globalPath, manualYaml)
    vi.mocked(rename)
      .mockImplementationOnce(memfsRename)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(memfsRename)

    const result = await configureGlobal({ devboxHome })
    expect(result).toMatchObject({ ok: false, error: { code: 'state-write-failed' } })
    expect(await Promise.all(composePaths.map(path => readFile(path, 'utf8')))).toEqual(before)
    await expect(readFile(globalPath, 'utf8')).resolves.toBe(manualYaml)
  })

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

    vi.mocked(confirm).mockImplementationOnce(async () => {
      await writeFile(localPath, `# edited while confirming\n${localBefore}`)
      return true
    })
    vi.mocked(editLocal).mockResolvedValueOnce({ version: 1, node: null, ports: [] })
    const result = await configureLocalProject({ root: projectRoot, devboxHome })

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
    const secondProject = await initializeProject({ root: secondProjectRoot, devboxHome })
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
    vi.mocked(confirm).mockImplementationOnce(async () => {
      await writeFile(globalPath, `# edited while confirming\n${globalBefore}`)
      await writeFile(localPath, `# edited while confirming\n${localBefore}`)
      return true
    })
    vi.mocked(rename)
      .mockImplementationOnce(memfsRename)
      .mockImplementationOnce(memfsRename)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(memfsRename)

    vi.mocked(editGlobal).mockResolvedValueOnce({
      version: 1,
      node: [],
      agent: [],
      agent_notifications: true,
    })
    vi.mocked(selectNodeReplacement).mockImplementation(async configuration => ({
      ...configuration,
      node: null,
    }))
    const result = await configureGlobal({ devboxHome })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'state-write-failed' },
    })
    await expect(readFile(globalPath, 'utf8')).resolves.toBe(globalBefore)
    await expect(readFile(localPath, 'utf8')).resolves.toBe(localBefore)
    await expect(readFile(secondLocalPath, 'utf8')).resolves.toBe(secondLocalBefore)
  })
  it('leaves published files untouched when staging a later definition fails', async () => {
    await createProjectState()
    const globalPath = join(devboxHome, 'config.yaml')
    const composePath = '/workspace/user-state/.devbox/projects/workspace-project/compose.yaml'
    const paths = [globalPath, composePath]
    const before = await Promise.all(
      paths.map(async path => ({
        content: await readFile(path, 'utf8'),
        ino: (await stat(path)).ino,
      })),
    )
    vi.mocked(editGlobal).mockResolvedValueOnce({
      version: 1,
      node: ['24'],
      agent: ['codex'],
      agent_notifications: false,
    })
    vi.mocked(writeFile).mockImplementation(async (path, ...args) => {
      if (typeof path === 'string' && path.includes('.compose.yaml-')) {
        throw new Error('disk full')
      }
      return memfsWriteFile(path, ...args)
    })

    const result = await configureGlobal({ devboxHome })

    expect(result).toMatchObject({ ok: false, error: { code: 'state-write-failed' } })
    expect(
      await Promise.all(
        paths.map(async path => ({
          content: await readFile(path, 'utf8'),
          ino: (await stat(path)).ino,
        })),
      ),
    ).toEqual(before)
  })
})
