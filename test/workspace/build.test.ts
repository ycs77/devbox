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
  it('preserves user Build context inputs and initializes missing Workspace image defaults', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    const buildContext = join(devboxHome, 'build')
    await writeGlobalConfiguration(devboxHome, { node: ['24'], agent: [] })
    await mkdir(buildContext, { recursive: true })
    await writeFile(join(buildContext, 'stale.txt'), 'stale')
    await writeFile(join(buildContext, '.gitconfig'), '[user]\n\tname = Devbox User\n')
    const before = await readFile(join(devboxHome, 'config.yaml'), 'utf8')

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async () => success(undefined),
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(await readFile(join(buildContext, 'stale.txt'), 'utf8')).toBe('stale')
    expect(await readFile(join(buildContext, '.gitconfig'), 'utf8')).toBe(
      '[user]\n\tname = Devbox User\n',
    )
    await expect(readFile(join(buildContext, '.bash_aliases'), 'utf8')).resolves.toContain(
      "alias ..='cd ..'",
    )
    await expect(readFile(join(buildContext, '.dockerignore'), 'utf8')).resolves.toContain(
      '!entrypoint.sh',
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

  it('builds the Configured Runtime and Agent sets with the Build Node Runtime', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['22', '24'],
      agent: ['claude-code', 'codex', 'agy', 'omp'],
    })
    let invocation: DockerBuildInvocation | undefined
    let dockerfile = ''
    let entrypoint = ''
    let supervisord = ''
    let claudeSettings = ''
    let ompAgentConfig = ''

    const result = await buildWorkspace({
      devboxHome,
      noCache: true,
      executeDockerBuild: async input => {
        invocation = input
        dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
        entrypoint = await readFile(join(input.context, 'entrypoint.sh'), 'utf8')
        supervisord = await readFile(join(input.context, 'supervisord.conf'), 'utf8')
        claudeSettings = await readFile(join(input.context, '.claude', 'settings.json'), 'utf8')
        ompAgentConfig = await readFile(join(input.context, '.omp', 'agent', 'config.yml'), 'utf8')
        return success(undefined)
      },
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(invocation).toMatchObject({
      context: join(devboxHome, 'build'),
      image: WORKSPACE_IMAGE,
      noCache: true,
    })
    expect(dockerfile).toContain('NODE_RUNTIME_VERSION=22.23.2')
    expect(dockerfile).toContain('NODE_RUNTIME_VERSION=24.19.0')
    expect(dockerfile).toContain('export PATH="/opt/devbox/runtimes/node/24/bin:$PATH"')
    expect(dockerfile).toContain('curl -fsSL https://claude.ai/install.sh | bash')
    expect(dockerfile).toContain('curl -fsSL https://chatgpt.com/codex/install.sh | sh')
    expect(dockerfile).toContain('curl -fsSL https://antigravity.google/cli/install.sh | bash')
    expect(dockerfile).toContain('curl -fsSL https://omp.sh/install | sh')
    expect(dockerfile).toContain('ENV PATH="/home/devbox/.local/bin:${PATH}"')
    expect(dockerfile).toContain(
      "npx -y skills add ycs77/skills -g -a claude-code -a codex -s '*' -y",
    )
    expect(dockerfile).not.toContain(' -a agy ')
    expect(dockerfile).not.toContain(' -a omp ')
    expect(dockerfile).toContain(
      'COPY .bash_aliases /home/devbox/.bash_aliases\nCOPY .gitconfig /home/devbox/.gitconfig',
    )
    expect(dockerfile).toContain('COPY .claude/settings.json /home/devbox/.claude/settings.json')
    expect(dockerfile).toContain('COPY .omp/agent/config.yml /home/devbox/.omp/agent/config.yml')
    expect(dockerfile).toContain('COPY entrypoint.sh /usr/local/bin/entrypoint.sh')
    expect(dockerfile).toContain('COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf')
    expect(entrypoint).toContain('NODE_VERSION="${NODE_VERSION:-}"')
    expect(entrypoint).toContain('ln -sfn /home/devbox/.agents/skills /home/devbox/.gemini/skills')
    expect(claudeSettings).toContain('"CLAUDE_CODE_USE_POWERSHELL_TOOL": "0"')
    expect(ompAgentConfig).toContain('setupVersion: 2')
    expect(supervisord).toBe(
      [
        '[supervisord]',
        'nodaemon=true',
        'user=root',
        'logfile=/var/log/supervisor/supervisord.log',
        'pidfile=/var/run/supervisord.pid',
        '',
        '[program:idle]',
        'command=/bin/sleep infinity',
        'autorestart=false',
        'startsecs=0',
        'stopsignal=TERM',
        'stopasgroup=true',
        'killasgroup=true',
        'stdout_logfile=/dev/null',
        'stderr_logfile=/dev/null',
        '',
      ].join('\n'),
    )
  })

  it('installs Agents that do not support skills', async () => {
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
    expect(dockerfile).toContain('curl -fsSL https://antigravity.google/cli/install.sh | bash')
    expect(dockerfile).toContain('curl -fsSL https://omp.sh/install | sh')
    expect(dockerfile).not.toContain('Install Agent Skills')
    expect(dockerfile).not.toContain('skills add')
  })

  it('installs Agents without Node Runtime or Agent Skills', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: [],
      agent: ['claude-code'],
    })
    let dockerfile = ''
    let entrypoint = ''

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async input => {
        dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
        entrypoint = await readFile(join(input.context, 'entrypoint.sh'), 'utf8')
        return success(undefined)
      },
    })

    expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    expect(dockerfile).not.toContain('NODE_RUNTIME_VERSION')
    expect(dockerfile).toContain('curl -fsSL https://claude.ai/install.sh | bash')
    expect(dockerfile).toContain('ENV PATH="/home/devbox/.local/bin:${PATH}"')
    expect(dockerfile).not.toContain('skills add')
    expect(dockerfile).not.toContain('/opt/devbox/runtimes')
    expect(entrypoint).not.toContain('NODE_VERSION')
    expect(entrypoint).not.toContain('NODE_RUNTIME_ROOT')
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
