import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { failure, success } from '../../src/result.js'
import { withStateLocks } from '../../src/state-lock/index.js'
import {
  buildWorkspace,
  type DockerBuildInvocation,
  WORKSPACE_IMAGE,
} from '../../src/workspace/build.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-build-test-'))
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

async function writeGlobalConfiguration(
  devboxHome: string,
  configuration: { readonly node: readonly string[]; readonly agent: readonly string[] },
): Promise<void> {
  await mkdir(devboxHome, { recursive: true })
  await writeFile(
    join(devboxHome, 'config.yaml'),
    [
      'version: 1',
      `node: [${configuration.node.join(', ')}]`,
      `agent: [${configuration.agent.join(', ')}]`,
      'agent_notifications: true',
      '',
    ].join('\n'),
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('buildWorkspace', () => {
  it('replaces stale Build context contents and leaves configuration untouched on success', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, { node: ['24'], agent: [] })
    await mkdir(join(devboxHome, 'build'), { recursive: true })
    await writeFile(join(devboxHome, 'build', 'stale.txt'), 'stale')
    const before = await readFile(join(devboxHome, 'config.yaml'), 'utf8')

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async () => success(undefined),
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    await expect(readFile(join(devboxHome, 'build', 'stale.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(join(devboxHome, 'build', '.dockerignore'), 'utf8')).resolves.toContain(
      '!Dockerfile',
    )
    expect(await readFile(join(devboxHome, 'config.yaml'), 'utf8')).toBe(before)
  })

  it('serializes access to the shared Build context', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, { node: ['24'], agent: [] })
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () => {
      entered.resolve()
      await release.promise
      return success(undefined)
    })
    await entered.promise

    try {
      const result = await buildWorkspace({
        devboxHome,
        executeDockerBuild: async () => success(undefined),
      })

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'operational', code: 'command-lock-busy' },
      })
    } finally {
      release.resolve()
      await running
    }
  })

  it('builds the Configured Runtime set and installs skills with the Build Node Runtime', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['22', '24'],
      agent: ['claude-code', 'codex', 'agy'],
    })
    let invocation: DockerBuildInvocation | undefined
    let dockerfile = ''

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async input => {
        invocation = input
        dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
        return success(undefined)
      },
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(invocation).toMatchObject({
      context: join(devboxHome, 'build'),
      image: WORKSPACE_IMAGE,
    })
    expect(dockerfile).toContain('NODE_RUNTIME_VERSION=22.23.2')
    expect(dockerfile).toContain('NODE_RUNTIME_VERSION=24.19.0')
    expect(dockerfile).toContain('export PATH="/opt/devbox/runtimes/node/24/bin:$PATH"')
    expect(dockerfile).toContain(
      "npx -y skills add ycs77/skills -g -a claude-code -a codex -s '*' -y",
    )
    expect(dockerfile).not.toContain(' -a agy ')
  })

  it('omits skill installation when configured agents do not support it', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['agy', 'omp'],
    })
    let dockerfile = ''

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async input => {
        dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
        return success(undefined)
      },
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(dockerfile).toContain('NODE_RUNTIME_VERSION=24.19.0')
    expect(dockerfile).not.toContain('Install Agent Skills')
    expect(dockerfile).not.toContain('skills add')
  })

  it('omits skills and Node stages when no Node Runtime is configured', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: [],
      agent: ['claude-code'],
    })
    let dockerfile = ''

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async input => {
        dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
        return success(undefined)
      },
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(dockerfile).not.toContain('NODE_RUNTIME_VERSION')
    expect(dockerfile).not.toContain('skills add')
    expect(dockerfile).not.toContain('/opt/devbox/runtimes')
  })

  it('keeps Global configuration unchanged when the Docker build fails', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['codex'],
    })
    const before = await readFile(join(devboxHome, 'config.yaml'), 'utf8')

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async () =>
        failure({
          kind: 'operational',
          code: 'docker-build-failed',
          observed: 'Docker failed to build devbox-workspace:latest.',
          nextAction: 'Inspect the Docker output; the prior Workspace image is unchanged.',
        }),
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'docker-build-failed' },
    })
    expect(await readFile(join(devboxHome, 'config.yaml'), 'utf8')).toBe(before)
  })

  it('fails without building when Global configuration is missing', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    let dockerInvoked = false

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async () => {
        dockerInvoked = true
        return success(undefined)
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: 'operational',
        code: 'global-configuration-missing',
      },
    })
    expect(dockerInvoked).toBe(false)
  })
})
