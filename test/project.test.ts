import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  cleanupMissingProjects,
  configureGlobal,
  configureLocalProject,
  escapePathSegment,
  initializeProject,
  projectStateDirectory,
  removeProject,
  sandboxIdentity,
  sandboxName,
  unescapePathSegment,
} from '../src/project.js'
import { success } from '../src/result.js'
import { withStateLocks } from '../src/state-lock.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-project-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it('fails immediately when the required Global marker is occupied', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () => {
      entered.resolve()
      await release.promise
      return success(undefined)
    })
    await entered.promise

    try {
      const result = await initializeProject({
        root: projectRoot,
        devboxHome,
        validateHost: async () => success(undefined),
        confirm: async () => true,
      })

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'operational',
          code: 'command-lock-busy',
          observed: expect.stringContaining('Global'),
          nextAction: expect.stringContaining('no Devbox process'),
        },
      })
    } finally {
      release.resolve()
      await running
    }
  })

  it('commits Global, Local, and registry state for the exact current directory', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'non-git', 'nested directory')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot, { recursive: true })

    const result = await createProjectState(projectRoot, devboxHome)
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, { identity: string; name: string }>
    }

    expect(registry.projects).toEqual({
      [projectRoot]: {
        identity: basename(result.stateDirectory),
        name: 'nested-directory',
      },
    })
    expect(parse(await readFile(join(devboxHome, 'config.yaml'), 'utf8'))).toMatchObject({
      version: 1,
      node: ['24'],
      agent: [],
      agent_notifications: true,
    })
    expect(parse(await readFile(join(result.stateDirectory, 'config.yaml'), 'utf8'))).toMatchObject(
      {
        version: 1,
        node: '24',
      },
    )
  })

  it('publishes a static Compose definition for the registered Sandbox', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)

    const project = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => true,
      initialGlobalConfiguration: {
        version: 1,
        node: ['24', '22'],
        agent: ['claude-code', 'agy'],
        agent_notifications: true,
      },
      initialLocalConfiguration: { version: 1, node: '22' },
    })

    expect(project).toMatchObject({ ok: true, value: { created: true } })
    if (!project.ok) {
      throw new Error(project.error.observed)
    }
    expect(
      parse(await readFile(join(project.value.stateDirectory, 'compose.yaml'), 'utf8')),
    ).toEqual({
      name: 'project',
      'x-devbox': {
        version: 1,
        project_root: projectRoot,
        compose_name: 'project',
        sandbox_service: 'devbox',
      },
      services: {
        devbox: {
          image: 'devbox-workspace:latest',
          container_name: 'project',
          working_dir: '/workspace/project',
          environment: {
            NODE_VERSION: '22',
            PULSE_SERVER: 'unix:/tmp/pulse-socket',
          },
          volumes: [
            {
              type: 'bind',
              source: projectRoot,
              target: '/workspace/project',
            },
            {
              type: 'volume',
              source: 'devbox-claude',
              target: '/home/devbox/.claude',
            },
            {
              type: 'volume',
              source: 'devbox-agy',
              target: '/home/devbox/.gemini',
            },
            {
              type: 'bind',
              source: '/mnt/wslg/runtime-dir/pulse/native',
              target: '/tmp/pulse-socket',
              read_only: true,
            },
          ],
        },
      },
      volumes: {
        'devbox-claude': { name: 'devbox-claude', external: true },
        'devbox-agy': { name: 'devbox-agy', external: true },
      },
    })
  })

  it('regenerates a retained definition from registered configuration', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    await rm(join(project.stateDirectory, 'compose.yaml'))

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => true,
      initialGlobalConfiguration: {
        version: 1,
        node: ['22'],
        agent: ['codex'],
        agent_notifications: false,
      },
      initialLocalConfiguration: { version: 1, node: '22' },
    })

    expect(result).toMatchObject({ ok: true, value: { created: false } })
    expect(
      parse(await readFile(join(project.stateDirectory, 'compose.yaml'), 'utf8')),
    ).toMatchObject({
      services: { devbox: { environment: { NODE_VERSION: '24' } } },
    })
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

  it('assigns colliding path-derived identities independently from Sandbox names', async () => {
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
      projects: Record<string, { identity: string; name: string }>
    }
    expect(registry.projects[firstRoot]).toMatchObject({ name: 'project-c' })
    expect(registry.projects[secondRoot]).toMatchObject({ name: 'b-c' })
    expect(registry.projects[firstRoot]!.identity).not.toBe(registry.projects[secondRoot]!.identity)
    await expect(readFile(join(first.stateDirectory, 'config.yaml'), 'utf8')).resolves.toContain(
      'node:',
    )
    await expect(readFile(join(second.stateDirectory, 'config.yaml'), 'utf8')).resolves.toContain(
      'node:',
    )
  })

  it('assigns colliding Sandbox names independently from path-derived identities', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'first-parent', 'shared project')
    const secondRoot = join(sandbox, 'second-parent', 'shared project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true }),
    ])

    const first = await createProjectState(firstRoot, devboxHome)
    const second = await createProjectState(secondRoot, devboxHome)

    expect(first.stateDirectory).not.toBe(second.stateDirectory)
    const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
      projects: Record<string, { identity: string; name: string }>
    }
    expect(registry.projects[firstRoot]).toMatchObject({ name: 'shared-project' })
    expect(registry.projects[secondRoot]).toMatchObject({ name: 'shared-project-2' })
    expect(registry.projects[firstRoot]!.identity).not.toBe(registry.projects[secondRoot]!.identity)
  })

  it('does not adopt an unregistered residual state directory', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    const residual = projectStateDirectory(sandboxIdentity(projectRoot), devboxHome)
    await mkdir(projectRoot)
    await mkdir(residual, { recursive: true })
    await writeFile(join(residual, 'sentinel'), 'keep me\n')

    const result = await createProjectState(projectRoot, devboxHome)

    expect(result.stateDirectory).toBe(`${residual}-2`)
    await expect(readFile(join(residual, 'sentinel'), 'utf8')).resolves.toBe('keep me\n')
  })

  it('fails closed on a legacy registry entry without writing state', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await mkdir(devboxHome, { recursive: true })
    await writeFile(
      join(devboxHome, 'projects.yaml'),
      `version: 1\nprojects:\n  ${projectRoot}: legacy-identity\n`,
    )

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-project-registry' } })
    await expect(stat(join(devboxHome, 'config.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a persisted Sandbox name with a line terminator', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await mkdir(devboxHome, { recursive: true })
    await writeFile(
      join(devboxHome, 'projects.yaml'),
      `version: 1\nprojects:\n  ${projectRoot}:\n    identity: valid-identity\n    name: "project\\n"\n`,
    )

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-project-registry' } })
  })

  it('rejects a one-character persisted Sandbox name', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await mkdir(devboxHome, { recursive: true })
    await writeFile(
      join(devboxHome, 'projects.yaml'),
      `version: 1\nprojects:\n  ${projectRoot}:\n    identity: valid-identity\n    name: a\n`,
    )

    const result = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-project-registry' } })
  })
  it('configures Global state before Local state only when Global state is absent', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'first')
    const secondRoot = join(sandbox, 'second')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    const firstResult = await initializeProject({
      root: firstRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      prompt: {
        confirm: async () => true,
        editGlobal: async () => ({
          version: 1,
          node: ['22'],

          agent: [],
          agent_notifications: false,
        }),
        editLocal: async (_configuration, _catalog, globalConfiguration) => ({
          version: 1,
          node: globalConfiguration.node[0] ?? null,
        }),
      },
    })

    const secondResult = await initializeProject({
      root: secondRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      prompt: {
        confirm: async () => true,
        editGlobal: async () => {
          throw new Error('Global configuration prompt must not run when Global state exists.')
        },
        editLocal: async (_configuration, _catalog, globalConfiguration) => ({
          version: 1,
          node: globalConfiguration.node[0] ?? null,
        }),
      },
    })

    expect(firstResult).toMatchObject({ ok: true, value: { created: true } })
    expect(secondResult).toMatchObject({ ok: true, value: { created: true } })
    if (!firstResult.ok || !secondResult.ok) {
      throw new Error('Project initialization failed.')
    }
    expect(parse(await readFile(join(devboxHome, 'config.yaml'), 'utf8'))).toMatchObject({
      node: ['22'],
      agent_notifications: false,
    })
    expect(
      parse(await readFile(join(firstResult.value.stateDirectory, 'config.yaml'), 'utf8')),
    ).toMatchObject({ node: '22' })
    expect(
      parse(await readFile(join(secondResult.value.stateDirectory, 'config.yaml'), 'utf8')),
    ).toMatchObject({ node: '22' })
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
      nextConfiguration: { version: 1, node: null },
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
    expect(
      parse(await readFile(join(project.stateDirectory, 'compose.yaml'), 'utf8')),
    ).not.toHaveProperty('services.devbox.environment.NODE_VERSION')
  })
  it('regenerates every affected Project definition after a Global change', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'first-project')
    const secondRoot = join(sandbox, 'second-project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    const first = await createProjectState(firstRoot, devboxHome)
    const second = await createProjectState(secondRoot, devboxHome)

    const result = await configureGlobal({
      devboxHome,
      nextConfiguration: {
        version: 1,
        node: ['24'],
        agent: ['codex'],
        agent_notifications: false,
      },
      confirm: async () => true,
    })

    expect(result).toEqual({ ok: true, value: { scope: 'global', changed: true } })
    await Promise.all(
      [first, second].map(async project => {
        expect(
          parse(await readFile(join(project.stateDirectory, 'compose.yaml'), 'utf8')),
        ).toMatchObject({
          services: {
            devbox: {
              environment: { NODE_VERSION: '24' },
              volumes: expect.arrayContaining([
                {
                  type: 'volume',
                  source: 'devbox-codex',
                  target: '/home/devbox/.codex',
                },
              ]),
            },
          },
          volumes: {
            'devbox-codex': { name: 'devbox-codex', external: true },
          },
        })
      }),
    )
  })

  it('locks every registered Project before changing Global configuration', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    await createProjectState(projectRoot, devboxHome)
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks(
      { devboxHome, global: false, projectRoots: [projectRoot] },
      async () => {
        entered.resolve()
        await release.promise
        return success(undefined)
      },
    )
    await entered.promise

    try {
      const result = await configureGlobal({
        devboxHome,
        prompt: {
          confirm: async () => true,
          editGlobal: async () => {
            throw new Error('Global configuration prompt must not run while a Project is locked.')
          },
        },
      })

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'command-lock-busy', observed: expect.stringContaining('Project') },
      })
    } finally {
      release.resolve()
      await running
    }
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
      nextConfiguration: { version: 1, node: null },
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
    await writeFile(localPath, 'version: 1\nnode: "24"\nunknown: true\n')
    const invalidBefore = await readFile(localPath, 'utf8')

    const result = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      nextConfiguration: { version: 1, node: null },
      prompt: { confirm: async () => true },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
    await expect(readFile(localPath, 'utf8')).resolves.toBe(invalidBefore)
  })

  it('rejects catalog-external interactive Global and Local input before persistence', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    const globalPath = join(devboxHome, 'config.yaml')
    const localPath = join(project.stateDirectory, 'config.yaml')
    const globalBefore = await readFile(globalPath, 'utf8')
    const localBefore = await readFile(localPath, 'utf8')

    const globalResult = await configureGlobal({
      devboxHome,
      prompt: {
        confirm: async () => true,
        editGlobal: async () => ({
          version: 1,
          node: ['26'],
          agent: [],
          agent_notifications: true,
        }),
      },
    })
    const localResult = await configureLocalProject({
      root: projectRoot,
      devboxHome,
      prompt: {
        confirm: async () => true,
        editLocal: async () => ({ version: 1, node: '26' }),
      },
    })

    expect(globalResult).toMatchObject({
      ok: false,
      error: { code: 'invalid-global-configuration' },
    })
    expect(localResult).toMatchObject({
      ok: false,
      error: { code: 'invalid-local-configuration' },
    })
    await expect(readFile(globalPath, 'utf8')).resolves.toBe(globalBefore)
    await expect(readFile(localPath, 'utf8')).resolves.toBe(localBefore)
  })

  it('replaces a Missing-root Project Selected Node Runtime before removing it globally', async () => {
    const sandbox = await temporaryDirectory()
    const projectRoot = join(sandbox, 'project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await mkdir(projectRoot)
    const project = await createProjectState(projectRoot, devboxHome)
    await rm(projectRoot, { recursive: true, force: true })

    const result = await configureGlobal({
      devboxHome,
      nextConfiguration: { version: 1, node: [], agent: [], agent_notifications: true },
      prompt: {
        confirm: async () => true,
        editLocal: async () => ({ version: 1, node: null }),
      },
    })

    expect(result).toEqual({ ok: true, value: { scope: 'global', changed: true } })
    expect(parse(await readFile(join(devboxHome, 'config.yaml'), 'utf8'))).toMatchObject({
      node: [],
    })
    expect(
      parse(await readFile(join(project.stateDirectory, 'config.yaml'), 'utf8')),
    ).toMatchObject({
      node: null,
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
      projects: Record<string, { identity: string; name: string }>
    }
    expect(registry.projects[firstRoot]).toBeUndefined()
    expect(registry.projects[secondRoot]!.identity).toBe(basename(second.stateDirectory))
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

  it('does not partially clean Missing-root Projects when one Project marker is busy', async () => {
    const sandbox = await temporaryDirectory()
    const firstRoot = join(sandbox, 'a-missing-project')
    const secondRoot = join(sandbox, 'b-missing-project')
    const devboxHome = join(sandbox, 'user-state', '.devbox')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    const first = await createProjectState(firstRoot, devboxHome)
    const second = await createProjectState(secondRoot, devboxHome)
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ])

    const entered = deferred()
    const release = deferred()
    const running = withStateLocks(
      { devboxHome, global: false, projectRoots: [secondRoot] },
      async () => {
        entered.resolve()
        await release.promise
        return success(undefined)
      },
    )
    await entered.promise

    try {
      const result = await cleanupMissingProjects({ devboxHome, yes: true })

      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'operational',
          code: 'command-lock-busy',
          observed: expect.stringContaining('Project'),
        },
      })
      await expect(stat(first.stateDirectory)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      })
      await expect(stat(second.stateDirectory)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      })
      const registry = parse(await readFile(join(devboxHome, 'projects.yaml'), 'utf8')) as {
        projects: Record<string, { identity: string; name: string }>
      }
      expect(registry.projects[firstRoot]!.identity).toBe(basename(first.stateDirectory))
      expect(registry.projects[secondRoot]!.identity).toBe(basename(second.stateDirectory))
    } finally {
      release.resolve()
      await running
    }
  })
})

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
