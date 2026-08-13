import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  DEFAULT_RUNTIME_CATALOG,
  serializeGlobalConfiguration,
  serializeLocalConfiguration,
  type GlobalConfiguration,
} from '../src/configuration.js'
import {
  updatePlatform,
  type BaseLock,
  type NodeRuntimeLock,
  type PlatformResolver,
} from '../src/platform.js'
import { serializeProjectRegistry } from '../src/registry.js'
import { failure, success } from '../src/result.js'

const temporaryDirectories: string[] = []

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

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-platform-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeConfigurationState(
  devboxHome: string,
  globalConfiguration: GlobalConfiguration,
  localEntry?: { readonly root: string; readonly stateDirectory: string },
): Promise<void> {
  await mkdir(devboxHome, { recursive: true })
  await writeFile(
    join(devboxHome, 'config.yaml'),
    serializeGlobalConfiguration(globalConfiguration),
  )
  if (localEntry === undefined) {
    return
  }

  await mkdir(localEntry.stateDirectory, { recursive: true })
  await writeFile(
    join(devboxHome, 'projects.yaml'),
    serializeProjectRegistry({
      version: 1,
      projects: { [localEntry.root]: localEntry.stateDirectory.split('/').at(-1) ?? '' },
    }),
  )
  await writeFile(
    join(localEntry.stateDirectory, 'config.yaml'),
    serializeLocalConfiguration({ version: 1, toolchain: { node: '24' }, ports: [] }),
  )
}

function fixtureResolver(): PlatformResolver {
  const nodes: Record<string, NodeRuntimeLock> = {
    '24': {
      revision: '24.19.0',
      archive: {
        url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz',
        sha256: 'f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4',
      },
      signedChecksums: {
        url: 'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt.asc',
        signer: '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
      },
    },
    '22': {
      revision: '22.19.0',
      archive: {
        url: 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.gz',
        sha256: 'd36e56998220085782c0ca965f9d51b7726335aed2f5fc7321c6c0ad233aa96d',
      },
      signedChecksums: {
        url: 'https://nodejs.org/dist/v22.19.0/SHASUMS256.txt.asc',
        signer: '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
      },
    },
  }
  return {
    resolveBase: async () =>
      success({
        image: 'ubuntu:24.04',
        digest: `sha256:${'a'.repeat(64)}`,
        apt: { snapshot: '20260804T000000Z', packages: ['ca-certificates', 'curl', 'git'] },
      }),
    resolveNode: async ({ releaseLine }) => {
      const node = nodes[releaseLine]
      if (node === undefined) {
        throw new Error(`Missing fixture for ${releaseLine}`)
      }
      return success(node)
    },
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('updatePlatform', () => {
  it('publishes a canonical exact Platform lock for Global and Local state', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    const projectRoot = join(sandbox, 'project')
    const stateDirectory = join(devboxHome, 'projects', 'project')
    await mkdir(projectRoot)
    await writeConfigurationState(
      devboxHome,
      { version: 1, runtimes: { node: ['22', '24'] }, agents: ['codex'] },
      { root: projectRoot, stateDirectory },
    )

    const result = await updatePlatform({ devboxHome, resolver: fixtureResolver() })

    expect(result).toMatchObject({
      ok: true,
      value: {
        changed: true,
        lockPath: join(devboxHome, 'platform-lock.yaml'),
        runtimes: { node: ['24', '22'] },
      },
    })
    if (!result.ok) {
      throw new Error(result.error.observed)
    }

    const serialized = await readFile(result.value.lockPath, 'utf8')
    expect(serialized.indexOf('"24":')).toBeLessThan(serialized.indexOf('"22":'))
    const lock = parse(serialized) as Record<string, unknown>
    expect(Object.keys(lock)).toEqual(['version', 'platform', 'base', 'runtimes'])
    expect(lock.version).toBe(1)
    expect(lock.platform).toBe('linux/amd64')
    expect(lock.base).toMatchObject({
      image: 'ubuntu:24.04',
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      apt: {
        snapshot: expect.stringMatching(/^20[0-9]{6}T[0-9]{6}Z$/),
        packages: expect.arrayContaining(['ca-certificates', 'curl', 'git']),
      },
    })
    expect(lock.runtimes).toEqual({
      node: {
        '24': {
          revision: '24.19.0',
          archive: {
            url: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.gz',
            sha256: 'f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4',
          },
          signedChecksums: {
            url: 'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt.asc',
            signer: '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
          },
        },
        '22': expect.objectContaining({
          revision: '22.19.0',
        }),
      },
    })
    expect(lock.runtimes).not.toHaveProperty('agents')
  })

  it('preserves the existing lock bytes when resolution fails', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: { node: ['24'] },
      agents: [],
    })
    const lockPath = join(devboxHome, 'platform-lock.yaml')
    const previous = 'version: 1\nplatform: linux/amd64\nbase: old\nruntimes: {}\n'
    await writeFile(lockPath, previous)

    const resolver: PlatformResolver = {
      resolveBase: async () =>
        failure({
          kind: 'operational',
          code: 'base-resolution-failed',
          observed: 'The packaged Ubuntu Base input could not be resolved.',
          nextAction: 'Install a newer Devbox package and run devbox update again.',
        }),
      resolveNode: async () => {
        throw new Error('Node resolution must not run after Base resolution fails.')
      },
    }

    const result = await updatePlatform({ devboxHome, resolver })

    expect(result).toMatchObject({ ok: false, error: { code: 'base-resolution-failed' } })
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(previous)
  })

  it('rejects a catalog-external Global selection before replacing the lock', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: { node: ['26'] },
      agents: [],
    })
    const lockPath = join(devboxHome, 'platform-lock.yaml')
    const previous = 'previous platform lock bytes\n'
    await writeFile(lockPath, previous)

    const result = await updatePlatform({ devboxHome })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-global-configuration' },
    })
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(previous)
  })

  it('rejects a catalog-external Local selection before resolving Base inputs', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    const projectRoot = join(sandbox, 'project')
    const stateDirectory = join(devboxHome, 'projects', 'project')
    await mkdir(projectRoot)
    await writeConfigurationState(
      devboxHome,
      { version: 1, runtimes: { node: ['24'] }, agents: [] },
      { root: projectRoot, stateDirectory },
    )
    await writeFile(
      join(stateDirectory, 'config.yaml'),
      'version: 1\ntoolchain:\n  node: 26\nports: []\n',
    )
    const lockPath = join(devboxHome, 'platform-lock.yaml')
    const previous = 'previous platform lock bytes\n'
    await writeFile(lockPath, previous)

    let baseResolved = false
    const result = await updatePlatform({
      devboxHome,
      resolver: {
        resolveBase: async () => {
          baseResolved = true
          return failure({
            kind: 'operational',
            code: 'base-resolution-should-not-run',
            observed: 'Base resolution should not run for invalid Local state.',
            nextAction: 'Repair Local configuration and run devbox update again.',
          })
        },
        resolveNode: async () => {
          throw new Error('Node resolution must not run for invalid Local state.')
        },
      },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-local-configuration' } })
    expect(baseResolved).toBe(false)
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(previous)
  })

  it('fails closed with a package recovery action for an invalid catalog', async () => {
    const sandbox = await temporaryDirectory()
    const result = await updatePlatform({
      devboxHome: join(sandbox, '.devbox'),
      catalog: { runtimes: { node: [] }, agents: [] },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'invalid-runtime-catalog',
        nextAction: expect.stringContaining('Install or reinstall a Devbox package'),
      },
    })
  })

  it('rejects configured Runtime families without a Platform resolver', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: { python: ['3.13'] },
      agents: [],
    })
    const lockPath = join(devboxHome, 'platform-lock.yaml')
    const previous = 'previous platform lock bytes\n'
    await writeFile(lockPath, previous)
    let baseResolved = false

    const result = await updatePlatform({
      devboxHome,
      catalog: { runtimes: { python: ['3.13'] }, agents: [] },
      resolver: {
        resolveBase: async () => {
          baseResolved = true
          return failure({
            kind: 'operational',
            code: 'base-resolution-should-not-run',
            observed: 'Base resolution should not run for an unsupported Runtime family.',
            nextAction: 'Repair Runtime configuration and run devbox update again.',
          })
        },
        resolveNode: async () => {
          throw new Error('Node resolution must not run for an unsupported Runtime family.')
        },
      },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-runtime-family' } })
    expect(baseResolved).toBe(false)
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(previous)
  })

  it('keeps the separate Platform marker owned by the active update', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: {},
      agents: [],
    })
    const entered = deferred()
    const release = deferred()
    const resolver: PlatformResolver = {
      resolveBase: async () => {
        entered.resolve()
        await release.promise
        return success({
          image: 'ubuntu:24.04',
          digest: `sha256:${'a'.repeat(64)}`,
          apt: { snapshot: '20260804T000000Z', packages: ['curl'] },
        })
      },
      resolveNode: async () => {
        throw new Error('Node resolution must not run without configured Node entries.')
      },
    }
    const running = updatePlatform({ devboxHome, resolver })
    await entered.promise

    const second = await updatePlatform({ devboxHome })

    expect(second).toMatchObject({ ok: false, error: { code: 'platform-lock-busy' } })
    release.resolve()
    await running
    const third = await updatePlatform({ devboxHome, resolver })
    expect(third).toMatchObject({ ok: true, value: { changed: false } })
  })

  it('returns a typed failure when the Platform marker path is unavailable', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, 'devbox-home-file')
    await writeFile(devboxHome, 'not a directory')

    const result = await updatePlatform({ devboxHome, resolver: fixtureResolver() })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'platform-lock-unavailable' },
    })
  })

  it('supports deterministic resolver fixtures without Docker or a public registry', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: { node: ['24'] },
      agents: [],
    })
    let baseResolved = false
    let nodeResolved = false
    const base: BaseLock = {
      image: 'ubuntu:24.04',
      digest: `sha256:${'a'.repeat(64)}`,
      apt: { snapshot: '20260804T000000Z', packages: ['curl'] },
    }
    const node: NodeRuntimeLock = {
      revision: '24.0.0',
      archive: {
        url: 'https://example.invalid/node.tar.gz',
        sha256: 'b'.repeat(64),
      },
      signedChecksums: {
        url: 'https://example.invalid/SHASUMS256.txt.asc',
        signer: 'C'.repeat(40),
      },
    }
    const resolver: PlatformResolver = {
      resolveBase: async () => {
        baseResolved = true
        return success(base)
      },
      resolveNode: async () => {
        nodeResolved = true
        return success(node)
      },
    }

    const result = await updatePlatform({
      devboxHome,
      catalog: DEFAULT_RUNTIME_CATALOG,
      resolver,
    })

    expect(result.ok).toBe(true)
    expect(baseResolved).toBe(true)
    expect(nodeResolved).toBe(true)
    expect(await readFile(join(devboxHome, 'platform-lock.yaml'), 'utf8')).toContain(
      'https://example.invalid/node.tar.gz',
    )
  })

  it('does not require a Project registry when Global configuration is valid', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeConfigurationState(devboxHome, {
      version: 1,
      runtimes: {},
      agents: [],
    })

    const result = await updatePlatform({ devboxHome, resolver: fixtureResolver() })

    expect(result).toMatchObject({ ok: true, value: { runtimes: { node: [] } } })
  })
})
