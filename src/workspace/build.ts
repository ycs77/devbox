import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createAgentWorkspaceContribution,
  type AgentWorkspaceContribution,
} from '../agent/build.js'
import {
  normalizeCatalog,
  parseGlobalConfiguration,
  type GlobalConfiguration,
} from '../configuration/index.js'
import { devboxPaths, InterruptedError } from '../project/index.js'
import { failure, success, type Result } from '../result.js'
import {
  createNodeWorkspaceContribution,
  type NodeWorkspaceContribution,
} from '../runtimes/node/build.js'
import { withStateLocks } from '../state-lock/index.js'
import bashAliases from './image-defaults/.bash_aliases?raw'
import gitconfig from './image-defaults/.gitconfig?raw'
import { WORKSPACE_IMAGE } from './image.js'

export { WORKSPACE_IMAGE } from './image.js'

export interface DockerBuildInvocation {
  readonly context: string
  readonly image: string
  readonly noCache: boolean
  readonly buildArgs: {
    readonly USER_ID: string
    readonly GROUP_ID: string
  }
}

export interface BuildWorkspaceInput {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly noCache?: boolean
  readonly executeDockerBuild?: (
    invocation: DockerBuildInvocation,
    signal?: AbortSignal,
  ) => Promise<Result<void>>
}

interface WorkspaceImageDefault {
  readonly relativePath: string
  readonly content: string
}

const BASE_WORKSPACE_IMAGE_DEFAULTS = [
  { relativePath: '.bash_aliases', content: bashAliases },
  { relativePath: '.gitconfig', content: gitconfig },
] satisfies readonly WorkspaceImageDefault[]

export interface WorkspaceBuild {
  readonly image: string
}

export type BuildWorkspaceResult = Result<WorkspaceBuild>

export async function buildWorkspace(
  input: BuildWorkspaceInput = {},
): Promise<BuildWorkspaceResult> {
  return withStateLocks(
    {
      devboxHome: input.devboxHome ?? join(homedir(), '.devbox'),
      global: true,
      projectRoots: [],
      signal: input.signal,
    },
    () => buildWorkspaceUnlocked(input),
  )
}

async function buildWorkspaceUnlocked(input: BuildWorkspaceInput): Promise<BuildWorkspaceResult> {
  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const catalogCheck = normalizeCatalog()
  if (!catalogCheck.ok) {
    return catalogCheck
  }

  const paths = devboxPaths(input.devboxHome)
  let globalSource: string
  try {
    globalSource = await readFile(paths.globalConfiguration, 'utf8')
  } catch {
    return failure({
      kind: 'operational',
      code: 'global-configuration-missing',
      observed: 'Global configuration is required before building the Workspace image.',
      nextAction: 'Run devbox config to commit Global configuration before devbox build.',
    })
  }

  const parsedGlobal = parseGlobalConfiguration(globalSource, catalogCheck.value)
  if (!parsedGlobal.ok) {
    return parsedGlobal
  }
  const globalConfiguration: GlobalConfiguration = parsedGlobal.value

  const hostIdentity = currentHostIdentity()
  if (!hostIdentity.ok) {
    return hostIdentity
  }

  const node = createNodeWorkspaceContribution(globalConfiguration.node)
  const agent = createAgentWorkspaceContribution({
    configuredAgents: globalConfiguration.agent,
    notificationsEnabled: globalConfiguration.agent_notifications,
    buildNodeRuntimeRoot: node.buildNodeRuntimeRoot,
  })
  const buildContextAssets = [...BASE_WORKSPACE_IMAGE_DEFAULTS, ...agent.buildContextAssets]
  const dockerfile = renderBuildDockerfile({ node, agent })
  await mkdir(paths.buildContext, { recursive: true })
  await seedBuildContextAssets(paths.buildContext, buildContextAssets)
  await Promise.all([
    writeFile(join(paths.buildContext, 'Dockerfile'), dockerfile),
    writeFile(
      join(paths.buildContext, '.dockerignore'),
      renderDockerignore(buildContextAssets, agent.dockerignoreEntries),
    ),
    writeFile(join(paths.buildContext, 'entrypoint.sh'), renderEntrypoint({ node, agent })),
    writeFile(join(paths.buildContext, 'supervisord.conf'), renderSupervisorConfiguration()),
  ])

  if (input.signal?.aborted) {
    throw new InterruptedError()
  }

  const execute = input.executeDockerBuild ?? runDockerBuild
  const buildResult = await execute({
    context: paths.buildContext,
    image: WORKSPACE_IMAGE,
    noCache: input.noCache === true,
    buildArgs: hostIdentity.value,
  })
  if (!buildResult.ok) {
    return buildResult
  }

  return success({ image: WORKSPACE_IMAGE })
}

function currentHostIdentity(): Result<DockerBuildInvocation['buildArgs']> {
  const userId = typeof process.getuid === 'function' ? process.getuid() : undefined
  const groupId = typeof process.getgid === 'function' ? process.getgid() : undefined
  if (
    typeof userId !== 'number' ||
    typeof groupId !== 'number' ||
    !Number.isSafeInteger(userId) ||
    !Number.isSafeInteger(groupId) ||
    userId <= 0 ||
    groupId <= 0
  ) {
    return failure({
      kind: 'validation',
      code: 'invalid-host-identity',
      observed: 'The invoking host process must have a non-root POSIX numeric UID and GID.',
      nextAction: 'Run devbox build as the intended non-root host user.',
    })
  }

  return success({ USER_ID: String(userId), GROUP_ID: String(groupId) })
}

function renderBuildDockerfile(input: {
  readonly node: NodeWorkspaceContribution
  readonly agent: AgentWorkspaceContribution
}): string {
  const lines: string[] = [
    '# Generated by devbox build. Machine-owned Workspace build context.',
    'FROM ubuntu:24.04',
    '',
    'ARG USER_ID',
    'ARG GROUP_ID',
    '',
    'ENV DEBIAN_FRONTEND=noninteractive',
    'ENV TZ=UTC',
    'ENV LANG=C.UTF-8',
    'ENV TERM=xterm-256color',
    'ENV EDITOR=vim',
    'ENV VISUAL=vim',
    '',
    'RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone',
    '',
    'RUN echo "Acquire::http::Pipeline-Depth 0;" > /etc/apt/apt.conf.d/99custom && \\',
    '    echo "Acquire::http::No-Cache true;" >> /etc/apt/apt.conf.d/99custom && \\',
    '    echo "Acquire::BrokenProxy    true;" >> /etc/apt/apt.conf.d/99custom',
    '',
    '# Install the Base profile packages and build tools',
    'RUN set -eux \\',
    '    && apt-get update && apt-get upgrade -y \\',
    '    && apt-get install -y --no-install-recommends \\',
    '      ca-certificates curl wget git supervisor openssh-client \\',
    '      zip unzip jq less vim ripgrep fd-find procps lsof iproute2 \\',
    '      dnsutils netcat-openbsd rsync tree tzdata bubblewrap \\',
    '      build-essential python3 python-is-python3 pkg-config \\',
    '      gnupg dirmngr xz-utils pulseaudio-utils sudo gosu \\',
    '    && apt-get -y autoremove \\',
    '    && apt-get clean \\',
    '    && rm -rf /var/lib/apt/lists/*',
    '',
    '# Create the devbox user and group',
    'RUN userdel -r ubuntu \\',
    '    && groupadd -g "$GROUP_ID" devbox \\',
    '    && useradd -m -s /bin/bash -N -g "$GROUP_ID" -u "$USER_ID" devbox \\',
    '    && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox \\',
    '    && chmod 0440 /etc/sudoers.d/devbox',
    '',
  ]
  lines.push(...input.node.runtimeInstallations)
  lines.push('WORKDIR /workspace', 'USER devbox', '')
  lines.push(...input.node.sandboxUserSetup)
  lines.push(...input.agent.installationDockerfileLines)

  lines.push(
    'USER root',
    '',
    '# Copy dotfiles',
    'COPY .bash_aliases /home/devbox/.bash_aliases',
    'COPY .gitconfig /home/devbox/.gitconfig',
    'RUN chown devbox:devbox /home/devbox/.bash_aliases \\',
    '    && chown devbox:devbox /home/devbox/.gitconfig',
    '',
  )

  lines.push(...input.agent.assetDockerfileLines)
  lines.push(...input.agent.notificationDockerfileLines)

  lines.push(
    'COPY entrypoint.sh /usr/local/bin/entrypoint.sh',
    'COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf',
    'RUN chmod +x /usr/local/bin/entrypoint.sh',
    '',
    'ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]',
  )

  return `${lines.join('\n')}\n`
}

function renderDockerignore(
  assets: readonly WorkspaceImageDefault[],
  additionalEntries: readonly string[],
): string {
  const lines = [
    '# Machine-owned Workspace build context',
    '*',
    '!Dockerfile',
    '!entrypoint.sh',
    '!supervisord.conf',
    ...assets.map(asset => `!${asset.relativePath}`),
    ...additionalEntries,
  ]
  return `${lines.join('\n')}\n`
}

async function seedBuildContextAssets(
  buildContext: string,
  assets: readonly WorkspaceImageDefault[],
): Promise<void> {
  await Promise.all(
    assets.map(async asset => {
      const destination = join(buildContext, asset.relativePath)
      await mkdir(dirname(destination), { recursive: true })
      try {
        await writeFile(destination, asset.content, { flag: 'wx' })
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        ) {
          throw error
        }
      }
    }),
  )
}

function renderEntrypoint(input: {
  readonly node: NodeWorkspaceContribution
  readonly agent: AgentWorkspaceContribution
}): string {
  const lines = [
    '#!/usr/bin/env bash',
    '',
    ...input.node.entrypointSetup,
    ...input.agent.entrypointSetup,
    'if [ $# -gt 0 ]; then',
    '  exec gosu devbox "$@"',
    'else',
    '  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf',
    'fi',
  ]

  return `${lines.join('\n')}\n`
}

function renderSupervisorConfiguration(): string {
  const lines = [
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
  ]
  return `${lines.join('\n')}\n`
}

async function runDockerBuild(
  invocation: DockerBuildInvocation,
  signal?: AbortSignal,
): Promise<Result<void>> {
  const build = spawn(
    'docker',
    [
      'build',
      ...(invocation.noCache ? ['--no-cache'] : []),
      '--build-arg',
      `USER_ID=${invocation.buildArgs.USER_ID}`,
      '--build-arg',
      `GROUP_ID=${invocation.buildArgs.GROUP_ID}`,
      '--tag',
      invocation.image,
      '--file',
      join(invocation.context, 'Dockerfile'),
      invocation.context,
    ],
    { stdio: 'inherit' },
  )
  const interrupt = () => build.kill('SIGINT')
  signal?.addEventListener('abort', interrupt, { once: true })

  let spawnFailed = false
  build.on('error', () => {
    spawnFailed = true
  })
  const [exitCode] = (await once(build, 'close')) as [number | null]
  signal?.removeEventListener('abort', interrupt)

  if (signal?.aborted) {
    throw new InterruptedError()
  }
  if (spawnFailed || exitCode !== 0) {
    return failure({
      kind: 'operational',
      code: 'docker-build-failed',
      observed: `Docker failed to build ${invocation.image}.`,
      nextAction: 'Inspect the Docker output above; the prior Workspace image is unchanged.',
    })
  }
  return success(undefined)
}
