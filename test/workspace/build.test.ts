import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import claudeSettings from '../../src/agent/image-defaults/.claude/settings.json?raw'
import ompAgentConfig from '../../src/agent/image-defaults/.omp/agent/config.yml?raw'
import agentInstructions from '../../src/agent/image-defaults/AGENTS.md?raw'
import { failure, success } from '../../src/result.js'
import { withStateLocks } from '../../src/state-lock/index.js'
import {
  buildWorkspace,
  type DockerBuildInvocation,
  WORKSPACE_IMAGE,
} from '../../src/workspace/build.js'
import bashAliases from '../../src/workspace/image-defaults/.bash_aliases?raw'
import gitconfig from '../../src/workspace/image-defaults/.gitconfig?raw'

const temporaryDirectories: string[] = []

let hostUserId = 1000
let hostGroupId = 1000

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
  configuration: {
    readonly node: readonly string[]
    readonly agent: readonly string[]
    readonly agentNotifications?: boolean
  },
): Promise<void> {
  await mkdir(devboxHome, { recursive: true })
  await writeFile(
    join(devboxHome, 'config.yaml'),
    [
      'version: 1',
      `node: [${configuration.node.join(', ')}]`,
      `agent: [${configuration.agent.join(', ')}]`,
      `agent_notifications: ${configuration.agentNotifications ?? true}`,
      '',
    ].join('\n'),
  )
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('buildWorkspace', () => {
  beforeEach(() => {
    hostUserId = 1000
    hostGroupId = 1000
    vi.spyOn(process, 'getuid').mockImplementation(() => hostUserId)
    vi.spyOn(process, 'getgid').mockImplementation(() => hostGroupId)
  })

  it('refreshes all packaged assets before every Docker build without changing user configuration', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    const buildContext = join(devboxHome, 'build')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['claude-code', 'omp'],
    })
    const defaults = [
      ['.bash_aliases', bashAliases],
      ['.gitconfig', gitconfig],
      ['AGENTS.md', agentInstructions],
      ['.claude/settings.json', claudeSettings],
      ['.omp/agent/config.yml', ompAgentConfig],
    ] as const
    const before = await readFile(join(devboxHome, 'config.yaml'), 'utf8')
    await mkdir(buildContext, { recursive: true })
    await writeFile(join(buildContext, 'unrelated.txt'), 'unrelated')

    for (const staleContent of ['previous package version', 'manual build context edit']) {
      for (const [relativePath] of defaults) {
        const destination = join(buildContext, relativePath)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, staleContent)
      }

      const result = await buildWorkspace({
        devboxHome,
        executeDockerBuild: async input => {
          for (const [relativePath, content] of defaults) {
            expect(await readFile(join(input.context, relativePath), 'utf8')).toBe(content)
          }
          const dockerignore = await readFile(join(input.context, '.dockerignore'), 'utf8')
          expect(dockerignore.split('\n')).toContain('*')
          expect(dockerignore).not.toContain('!unrelated.txt')
          return success(undefined)
        },
      })

      expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
    }
    expect(await readFile(join(buildContext, 'unrelated.txt'), 'utf8')).toBe('unrelated')
    expect(await readFile(join(devboxHome, 'config.yaml'), 'utf8')).toBe(before)
  })

  it.each([{ agents: ['codex'] }, { agents: [] }])(
    'removes unused packaged Agent assets while retaining persistent Agent data with Agents $agents',
    async ({ agents }) => {
      const sandbox = await temporaryDirectory()
      const devboxHome = join(sandbox, '.devbox')
      const buildContext = join(devboxHome, 'build')
      await writeGlobalConfiguration(devboxHome, {
        node: [],
        agent: ['claude-code', 'omp', 'codex'],
      })
      expect(
        await buildWorkspace({
          devboxHome,
          executeDockerBuild: async () => success(undefined),
        }),
      ).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })

      const claudeHostConfiguration = join(devboxHome, 'agents', 'claude', '.claude.json')
      await mkdir(dirname(claudeHostConfiguration), { recursive: true })
      await writeFile(claudeHostConfiguration, '{"theme":"custom"}')
      await writeFile(join(buildContext, '.claude', 'unrelated.txt'), 'not a packaged asset')
      await writeGlobalConfiguration(devboxHome, { node: [], agent: agents })
      const before = await readFile(join(devboxHome, 'config.yaml'), 'utf8')

      const result = await buildWorkspace({
        devboxHome,
        executeDockerBuild: async input => {
          for (const relativePath of ['.claude/settings.json', '.omp/agent/config.yml']) {
            await expect(readFile(join(input.context, relativePath))).rejects.toMatchObject({
              code: 'ENOENT',
            })
          }
          if (agents.length > 0) {
            expect(await readFile(join(input.context, 'AGENTS.md'), 'utf8')).toBe(agentInstructions)
          } else {
            await expect(readFile(join(input.context, 'AGENTS.md'))).rejects.toMatchObject({
              code: 'ENOENT',
            })
          }
          const dockerfile = await readFile(join(input.context, 'Dockerfile'), 'utf8')
          const dockerignore = await readFile(join(input.context, '.dockerignore'), 'utf8')
          expect(dockerfile).not.toContain('COPY --chown=devbox:devbox .claude/')
          expect(dockerfile).not.toContain('COPY --chown=devbox:devbox .omp/')
          expect(dockerignore).not.toContain('!.claude')
          expect(dockerignore).not.toContain('!.omp')
          if (agents.length === 0) {
            expect(dockerfile).not.toContain('COPY --chown=devbox:devbox AGENTS.md')
            expect(dockerignore).not.toContain('!AGENTS.md')
          }
          return success(undefined)
        },
      })

      expect(result).toEqual({ ok: true, value: { image: WORKSPACE_IMAGE } })
      expect(await readFile(claudeHostConfiguration, 'utf8')).toBe('{"theme":"custom"}')
      expect(await readFile(join(buildContext, '.claude', 'unrelated.txt'), 'utf8')).toBe(
        'not a packaged asset',
      )
      expect(await readFile(join(devboxHome, 'config.yaml'), 'utf8')).toBe(before)
    },
  )

  it('does not build stale assets when an asset cannot be overwritten and recovers on retry', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, { node: [], agent: [] })
    const blockedAsset = join(devboxHome, 'build', '.gitconfig')
    await mkdir(blockedAsset, { recursive: true })
    await writeFile(join(blockedAsset, 'sentinel'), 'keep')
    let buildAttempts = 0
    const executeDockerBuild = async () => {
      buildAttempts += 1
      return success(undefined)
    }

    await expect(buildWorkspace({ devboxHome, executeDockerBuild })).rejects.toMatchObject({
      code: 'EISDIR',
    })
    expect(buildAttempts).toBe(0)
    expect(await readFile(join(blockedAsset, 'sentinel'), 'utf8')).toBe('keep')

    await rm(blockedAsset, { recursive: true })
    expect(await buildWorkspace({ devboxHome, executeDockerBuild })).toEqual({
      ok: true,
      value: { image: WORKSPACE_IMAGE },
    })
    expect(buildAttempts).toBe(1)
    expect(await readFile(blockedAsset, 'utf8')).toBe(gitconfig)
  })

  it('builds the Workspace image with the invoking host numeric identity', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, { node: [], agent: [] })
    hostUserId = 2001
    hostGroupId = 2002
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
      buildArgs: { USER_ID: '2001', GROUP_ID: '2002' },
    })
    expect(dockerfile).toContain('ARG USER_ID')
    expect(dockerfile).toContain('ARG GROUP_ID')
    expect(dockerfile).toContain('groupadd -g "$GROUP_ID" devbox')
    expect(dockerfile).toContain('useradd -m -s /bin/bash -N -g "$GROUP_ID" -u "$USER_ID" devbox')
    expect(dockerfile).not.toContain('1000')
  })

  it('rejects a root host identity before attempting the Workspace image build', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, { node: [], agent: [] })
    hostUserId = 0
    hostGroupId = 0
    let buildAttempts = 0

    const result = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async () => {
        buildAttempts += 1
        return success(undefined)
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', code: 'invalid-host-identity' },
    })
    expect(buildAttempts).toBe(0)
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
    let generatedAgentInstructions = ''
    let dockerignore = ''

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
        generatedAgentInstructions = await readFile(join(input.context, 'AGENTS.md'), 'utf8')
        dockerignore = await readFile(join(input.context, '.dockerignore'), 'utf8')
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
    expect(dockerfile).toContain(
      "RUN mkdir -p /home/devbox/.claude \\\n    && echo '{}' > /home/devbox/.claude.json \\\n    && curl -fsSL https://claude.ai/install.sh | bash",
    )
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
      'COPY --chown=devbox:devbox .bash_aliases /home/devbox/.bash_aliases\nCOPY --chown=devbox:devbox .gitconfig /home/devbox/.gitconfig',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox .claude/settings.json /home/devbox/.claude/settings.json',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox .omp/agent/config.yml /home/devbox/.omp/agent/config.yml',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox AGENTS.md /home/devbox/.claude/CLAUDE.md',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox AGENTS.md /home/devbox/.codex/AGENTS.md',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox AGENTS.md /home/devbox/.gemini/GEMINI.md',
    )
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox AGENTS.md /home/devbox/.omp/agent/AGENTS.md',
    )
    expect(generatedAgentInstructions).toBe(agentInstructions)
    expect(dockerignore).toContain('!AGENTS.md')
    expect(dockerfile).toContain(
      [
        '# Install Agent Notification Plugins',
        'USER devbox',
        'RUN set -eux \\',
        '    && claude plugin marketplace add ycs77/claude-code-notifications \\',
        '    && claude plugin install notification-basic-wsl@ycs77-notifications \\',
        '    && codex plugin marketplace add ycs77/codex-notifications \\',
        '    && codex plugin add notification-basic-wsl@ycs77-notifications \\',
        '    && omp plugin marketplace add ycs77/omp-notifications \\',
        '    && omp plugin install notification-basic@ycs77-notifications',
        'USER root',
      ].join('\n'),
    )
    expect(dockerfile).toContain('COPY entrypoint.sh /usr/local/bin/entrypoint.sh')
    expect(dockerfile).toContain('COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf')
    expect(entrypoint).toContain('NODE_VERSION="${NODE_VERSION:-}"')
    expect(entrypoint).toContain('ln -sfn /home/devbox/.agents/skills /home/devbox/.gemini/skills')
    expect(claudeSettings).toContain('"CLAUDE_CODE_USE_POWERSHELL_TOOL": "0"')
    expect(ompAgentConfig).toContain('setupVersion:')
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

  it('installs Codex Skills when OMP is configured', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['omp'],
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
    expect(dockerfile).toContain("npx -y skills add ycs77/skills -g -a codex -s '*' -y")
    expect(dockerfile).not.toContain(' -a omp ')
  })

  it('installs Codex Skills once when both OMP and Codex are configured', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['omp', 'codex'],
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
    expect(dockerfile.match(/-a codex/g)).toHaveLength(1)
  })

  it('does not install Agent notification plugins when notifications are disabled', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: [],
      agent: ['claude-code', 'codex', 'omp'],
      agentNotifications: false,
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
    expect(dockerfile).not.toContain('Install Agent Notification Plugins')
    expect(dockerfile).not.toContain('plugin marketplace add ycs77')
  })

  it('installs Agents without a Skill target', async () => {
    const sandbox = await temporaryDirectory()
    const devboxHome = join(sandbox, '.devbox')
    await writeGlobalConfiguration(devboxHome, {
      node: ['24'],
      agent: ['agy'],
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
    expect(dockerfile).not.toContain('/home/devbox/.claude.json')
    expect(dockerfile).not.toContain('Install Agent Skills')
    expect(dockerfile).not.toContain('skills add')
    expect(dockerfile).toContain(
      'COPY --chown=devbox:devbox AGENTS.md /home/devbox/.gemini/GEMINI.md',
    )
    expect(dockerfile).not.toContain('COPY AGENTS.md /home/devbox/.claude/CLAUDE.md')
    expect(dockerfile).not.toContain('COPY AGENTS.md /home/devbox/.codex/AGENTS.md')
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
        nextAction: 'Run devbox init to commit Global configuration before devbox build.',
      },
    })
    expect(dockerInvoked).toBe(false)
  })
})
