import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  escapePathSegment,
  initializeProject,
  projectStateDirectory,
  unescapePathSegment,
} from '../src/project.js'
import { success } from '../src/result.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-project-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('initializeProject', () => {
  it('registers the exact current directory in a flat user-scope mirror', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'non-git', 'nested directory')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    const expectedStateDirectory = join(
      devboxHome,
      'projects',
      `${basename(tmpdir())}-${basename(sandbox)}-non-git-nested%20directory`,
    )
    await Promise.all([mkdir(projectRoot, { recursive: true }), mkdir(join(sandbox, '.git'))])

    const currentDirectory = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot)
    let result

    try {
      result = await initializeProject({
        devboxHome,
        validateHost: async () => success(undefined),
      })
    } finally {
      currentDirectory.mockRestore()
    }

    expect(result).toMatchObject({
      ok: true,
      value: { root: projectRoot, stateDirectory: expectedStateDirectory, created: true },
    })
    await expect(readFile(join(expectedStateDirectory, 'config.yaml'), 'utf8')).resolves.toBe(
      `version: 1\nprojectRoot: ${JSON.stringify(projectRoot)}\n`,
    )
    await expect(readFile(join(projectRoot, 'devbox.yaml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('registers the filesystem root in a named flat mirror', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    const expectedStateDirectory = join(devboxHome, 'projects', 'root')

    const result = await initializeProject({
      root: '/',
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({
      ok: true,
      value: { root: '/', stateDirectory: expectedStateDirectory, created: true },
    })
    await expect(readFile(join(expectedStateDirectory, 'config.yaml'), 'utf8')).resolves.toBe(
      'version: 1\nprojectRoot: "/"\n',
    )
  })

  it('preserves existing registration state when init repeats', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)

    const input = {
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    }
    await initializeProject(input)

    const configurationPath = join(projectStateDirectory(projectRoot, devboxHome), 'config.yaml')
    await writeFile(configurationPath, 'existing registration state\n')
    const repeated = await initializeProject(input)

    expect(repeated).toMatchObject({ ok: true, value: { root: projectRoot, created: false } })
    await expect(readFile(configurationPath, 'utf8')).resolves.toBe('existing registration state\n')
  })

  it('preserves the first registration when Project paths share a flat mirror name', async () => {
    const sandbox = await temporaryDirectory()
    const firstProjectRoot = join(sandbox, 'a-b', 'c')
    const secondProjectRoot = join(sandbox, 'a', 'b-c')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([
      mkdir(firstProjectRoot, { recursive: true }),
      mkdir(secondProjectRoot, { recursive: true }),
    ])

    const first = await initializeProject({
      root: firstProjectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })
    const second = await initializeProject({
      root: secondProjectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(first).toMatchObject({ ok: true, value: { root: firstProjectRoot, created: true } })
    expect(second).toMatchObject({ ok: true, value: { root: secondProjectRoot, created: false } })
    await expect(
      readFile(join(projectStateDirectory(firstProjectRoot, devboxHome), 'config.yaml'), 'utf8'),
    ).resolves.toBe(`version: 1\nprojectRoot: ${JSON.stringify(firstProjectRoot)}\n`)
  })

  it('rejects a missing Project root before creating Devbox state', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, 'user-state', '.devbox')

    const result = await initializeProject({
      root: join(sandbox, 'missing'),
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'missing-project-root' },
    })
    await expect(
      readFile(join(devboxHome, 'projects', 'config.yaml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects unsupported hosts before creating Devbox state', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => ({
        ok: false,
        error: {
          kind: 'validation',
          code: 'unsupported-host',
          observed: 'Unsupported host.',
          nextAction: 'Use WSL2.',
        },
      }),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-host' } })
    await expect(
      readFile(join(devboxHome, 'projects', 'config.yaml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('Project path mirror encoding', () => {
  it('maps the documented Project root to one flat state directory', () => {
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
