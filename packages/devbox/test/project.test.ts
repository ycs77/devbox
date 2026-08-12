import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  cleanupMissingProjects,
  configureGlobal,
  configureLocalProject,
  initializeProject,
  projectStateDirectory,
  removeProject,
  escapePathSegment,
  unescapePathSegment,
} from '../src/project.js'
import { success } from '../src/result.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-project-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createProjectState(
  root: string,
  devboxHome: string,
): Promise<{ readonly root: string; readonly stateDirectory: string }> {
  const result = await initializeProject({
    root,
    devboxHome,
    validateHost: async () => success(undefined),
    confirm: async () => true,
  })
  expect(result).toMatchObject({ ok: true, value: { root, created: true } })
  if (!result.ok) {
    throw new Error(result.error.observed)
  }
  return { root, stateDirectory: result.value.stateDirectory }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('initializeProject', () => {
  it('does not write Global, Local, or registry state before confirmation', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => false,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { root: projectRoot, created: false, confirmed: false },
    })
    await expect(stat(devboxHome)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('commits Global, Local, and registry state for the exact current directory', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'non-git', 'nested directory')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot, { recursive: true })

    const result = await createProjectState(projectRoot, devboxHome)
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, string>
    }

    expect(registry.projects).toEqual({
      [projectRoot]: basename(result.stateDirectory),
    })
    expect(parse(await readFile(join(devboxHome, 'config.yaml'), 'utf8'))).toMatchObject({
      version: 1,
      runtimes: { node: ['24'] },
      agents: [],
    })
    expect(parse(await readFile(join(result.stateDirectory, 'config.yaml'), 'utf8'))).toMatchObject(
      {
        version: 1,
        toolchain: { node: '24' },
        ports: [{ host: 5173, container: 5173 }],
      },
    )
  })
  it('serializes registry roots in exact root order', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'z-project')
    const secondRoot = join(sandbox, 'a-project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])

    await createProjectState(firstRoot, devboxHome)
    await createProjectState(secondRoot, devboxHome)

    const source = await readFile(join(devboxHome, 'projects.yaml'), 'utf8')
    expect(source.indexOf(secondRoot)).toBeLessThan(source.indexOf(firstRoot))
  })

  it('allocates distinct state directories for colliding path-derived names', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'a-b', 'c')
    const secondRoot = join(sandbox, 'a', 'b-c')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true }),
    ])

    const first = await createProjectState(firstRoot, devboxHome)
    const second = await createProjectState(secondRoot, devboxHome)

    expect(second.stateDirectory).toBe(`${first.stateDirectory}-2`)
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, string>
    }
    expect(new Set(Object.values(registry.projects)).size).toBe(2)
    await expect(readFile(join(first.stateDirectory, 'config.yaml'), 'utf8')).resolves.toContain(
      'toolchain:',
    )
    await expect(readFile(join(second.stateDirectory, 'config.yaml'), 'utf8')).resolves.toContain(
      'toolchain:',
    )
  })

  it('does not adopt an unregistered residual state directory', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    const residual = projectStateDirectory(projectRoot, devboxHome)
    await mkdir(projectRoot)
    await mkdir(residual, { recursive: true })
    await writeFile(join(residual, 'sentinel'), 'keep me\n')

    const result = await createProjectState(projectRoot, devboxHome)

    expect(result.stateDirectory).toBe(`${residual}-2`)
    await expect(readFile(join(residual, 'sentinel'), 'utf8')).resolves.toBe('keep me\n')
  })

  it('fails closed on an invalid machine-owned registry without writing state', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await mkdir(devboxHome, { recursive: true })
    await writeFile(
      join(devboxHome, 'projects.yaml'),
      'version: 1\nprojects:\n  relative/path: unsafe\n',
    )

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-project-registry' } })
    await expect(stat(join(devboxHome, 'config.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('configuration boundaries', () => {
  it('edits only the current registered Project Local configuration', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    const globalPath = join(devboxHome, 'config.yaml')
    const registryPath = join(devboxHome, 'projects.yaml')
    const globalBefore = await readFile(globalPath, 'utf8')
    const registryBefore = await readFile(registryPath, 'utf8')

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, toolchain: { node: null }, ports: [] },
      prompt: { confirm: async () => true },
    })

    expect(result).toEqual({
      ok: true,
      value: { scope: 'local', root: projectRoot, changed: true },
    })
    await expect(readFile(globalPath, 'utf8')).resolves.toBe(globalBefore)
    await expect(readFile(registryPath, 'utf8')).resolves.toBe(registryBefore)
    await expect(readFile(join(project.stateDirectory, 'config.yaml'), 'utf8')).resolves.toContain(
      'node: null',
    )
  })

  it('fails closed when a registered Project Local configuration is missing', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    await rm(join(project.stateDirectory, 'config.yaml'))

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => true,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'missing-local-configuration' },
    })
  })

  it('does not write Local configuration when configuration confirmation is declined', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    const localPath = join(project.stateDirectory, 'config.yaml')
    const before = await readFile(localPath, 'utf8')

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, toolchain: { node: null }, ports: [] },
      confirm: async () => false,
    })

    expect(result).toEqual({
      ok: true,
      value: { scope: 'local', root: projectRoot, changed: false },
    })
    await expect(readFile(localPath, 'utf8')).resolves.toBe(before)
  })

  it('rejects invalid manually edited Local YAML without replacing it', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    const localPath = join(project.stateDirectory, 'config.yaml')
    await writeFile(localPath, 'version: 1\ntoolchain:\n  node: 24\nports: []\nunknown: true\n')
    const invalidBefore = await readFile(localPath, 'utf8')

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, toolchain: { node: null }, ports: [] },
      prompt: { confirm: async () => true },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
    await expect(readFile(localPath, 'utf8')).resolves.toBe(invalidBefore)
  })

  it('rejects Global Runtime removal selected by a Missing-root Project', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await createProjectState(projectRoot, devboxHome)
    await rm(projectRoot, { recursive: true, force: true })

    const result = await configureGlobal({
      devboxHome,
      nextConfiguration: { version: 1, runtimes: { node: [] }, agents: [] },
      prompt: { confirm: async () => true },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'runtime-still-selected' } })
    expect(parse(await readFile(join(devboxHome, 'config.yaml'), 'utf8'))).toMatchObject({
      runtimes: { node: ['24'] },
    })
  })
})

describe('Project removal and Missing-root cleanup', () => {
  it('removes only the registered Project state and leaves another Project untouched', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'a-b', 'c')
    const secondRoot = join(sandbox, 'a', 'b-c')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true }),
    ])
    const first = await createProjectState(firstRoot, devboxHome)
    const second = await createProjectState(secondRoot, devboxHome)

    const result = await removeProject({ root: firstRoot, devboxHome, yes: true })

    expect(result).toEqual({ ok: true, value: { root: firstRoot, removed: true } })
    await expect(stat(first.stateDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(second.stateDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, string>
    }
    expect(registry.projects[firstRoot]).toBeUndefined()
    expect(registry.projects[secondRoot]).toBe(basename(second.stateDirectory))
  })

  it('cleans Missing-root registrations but preserves unregistered residual state', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'missing-project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    await rm(projectRoot, { recursive: true, force: true })
    const residual = join(devboxHome, 'projects', 'orphan')
    await mkdir(residual, { recursive: true })
    await writeFile(join(residual, 'sentinel'), 'keep me\n')

    const result = await cleanupMissingProjects({ devboxHome, yes: true })

    expect(result).toEqual({ ok: true, value: { roots: [projectRoot], removed: true } })
    await expect(stat(project.stateDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(residual, 'sentinel'), 'utf8')).resolves.toBe('keep me\n')
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, string>
    }
    expect(registry.projects[projectRoot]).toBeUndefined()
  })
})

describe('Project path mirror encoding', () => {
  it('maps an absolute Project root to one flat state directory', () => {
    expect(
      projectStateDirectory(
        '/home/lucas/dev/testing/devbox/test-results/package-smoke-fixed/project',
        '/home/lucas/.devbox',
      ),
    ).toBe(
      '/home/lucas/.devbox/projects/home-lucas-dev-testing-devbox-test-results-package-smoke-fixed-project',
    )
  })

  it('round-trips unsafe path segments without opaque hashes', () => {
    const segment = 'nested directory_日本語%'

    expect(escapePathSegment(segment)).toBe('nested%20directory_%E6%97%A5%E6%9C%AC%E8%AA%9E%25')
    expect(unescapePathSegment(escapePathSegment(segment))).toBe(segment)
  })
})
