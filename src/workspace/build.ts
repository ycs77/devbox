import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PACKAGED_AGENTS,
  PACKAGED_NODE_RECIPES,
  type NodeRuntimeRecipe,
  type PackagedAgent,
} from '../catalog/index.js'
import {
  normalizeCatalog,
  parseGlobalConfiguration,
  type GlobalConfiguration,
} from '../configuration/index.js'
import { devboxPaths, InterruptedError } from '../project/index.js'
import { failure, success, type Result } from '../result.js'
import { withStateLocks } from '../state-lock/index.js'
import bashAliases from './image-defaults/.bash_aliases?raw'
import claudeSettings from './image-defaults/.claude/settings.json?raw'
import gitconfig from './image-defaults/.gitconfig?raw'
import ompAgentConfig from './image-defaults/.omp/agent/config.yml?raw'
import { WORKSPACE_IMAGE } from './image.js'

export { WORKSPACE_IMAGE } from './image.js'

export interface DockerBuildInvocation {
  readonly context: string
  readonly image: string
  readonly noCache: boolean
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

interface ConfiguredAgent {
  readonly name: string
  readonly recipe: PackagedAgent
}

interface WorkspaceImageDefault {
  readonly relativePath: string
  readonly content: string
}

const BASE_WORKSPACE_IMAGE_DEFAULTS = [
  { relativePath: '.bash_aliases', content: bashAliases },
  { relativePath: '.gitconfig', content: gitconfig },
] satisfies readonly WorkspaceImageDefault[]

const CLAUDE_SETTINGS_DEFAULT = {
  relativePath: '.claude/settings.json',
  content: claudeSettings,
} satisfies WorkspaceImageDefault

const OMP_AGENT_CONFIG_DEFAULT = {
  relativePath: '.omp/agent/config.yml',
  content: ompAgentConfig,
} satisfies WorkspaceImageDefault

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

  const agents = globalConfiguration.agent.map(name => ({
    name,
    recipe: PACKAGED_AGENTS[name],
  }))
  const buildContextAssets = selectBuildContextAssets(agents)
  const nodeRuntimes = globalConfiguration.node.map(
    releaseLine => PACKAGED_NODE_RECIPES[releaseLine],
  )
  const dockerfile = renderBuildDockerfile({
    nodeRuntimes,
    buildNodeRuntime: buildNodeRuntimeRecipe(globalConfiguration),
    agents,
    skillAgents: globalConfiguration.agent.filter(
      agent => PACKAGED_AGENTS[agent]?.supportsSkillInstallation === true,
    ),
  })
  await mkdir(paths.buildContext, { recursive: true })
  await seedBuildContextAssets(paths.buildContext, buildContextAssets)
  await Promise.all([
    writeFile(join(paths.buildContext, 'Dockerfile'), dockerfile),
    writeFile(join(paths.buildContext, '.dockerignore'), renderDockerignore(buildContextAssets)),
    writeFile(
      join(paths.buildContext, 'entrypoint.sh'),
      renderEntrypoint({ nodeRuntimes, agents }),
    ),
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
  })
  if (!buildResult.ok) {
    return buildResult
  }

  return success({ image: WORKSPACE_IMAGE })
}

function buildNodeRuntimeRecipe(
  globalConfiguration: GlobalConfiguration,
): NodeRuntimeRecipe | undefined {
  let buildNodeRuntime: NodeRuntimeRecipe | undefined
  for (const releaseLine of globalConfiguration.node) {
    const recipe = PACKAGED_NODE_RECIPES[releaseLine]
    if (
      buildNodeRuntime === undefined ||
      Number.parseFloat(releaseLine) > Number.parseFloat(buildNodeRuntime.releaseLine)
    ) {
      buildNodeRuntime = recipe
    }
  }
  return buildNodeRuntime
}

function renderBuildDockerfile(input: {
  readonly nodeRuntimes: readonly NodeRuntimeRecipe[]
  readonly buildNodeRuntime: NodeRuntimeRecipe | undefined
  readonly agents: readonly ConfiguredAgent[]
  readonly skillAgents: readonly string[]
}): string {
  const lines: string[] = [
    '# Generated by devbox build. Machine-owned Workspace build context.',
    'FROM ubuntu:24.04',
    '',
    'ENV DEBIAN_FRONTEND=noninteractive',
    'ENV TZ=UTC',
    'ENV LANG=C.UTF-8',
    '',
    'RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone',
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
    '    && groupadd -f -g 1000 devbox \\',
    '    && useradd -m -s /bin/bash -N -g 1000 -u 1000 devbox \\',
    '    && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox \\',
    '    && chmod 0440 /etc/sudoers.d/devbox',
    '',
  ]

  for (const recipe of input.nodeRuntimes) {
    lines.push(...renderNodeRuntimeStage(recipe))
  }

  lines.push('WORKDIR /workspace', 'USER devbox', '')

  if (input.buildNodeRuntime !== undefined) {
    lines.push(
      '# Configure pnpm for the non-root Sandbox user',
      'RUN mkdir -p /home/devbox/.config/pnpm /home/devbox/.pnpm-store \\',
      "    && printf 'storeDir: /home/devbox/.pnpm-store\\n' > /home/devbox/.config/pnpm/config.yaml \\",
      '    && chown devbox:devbox /home/devbox/.config/pnpm/config.yaml',
      '',
    )
  }

  for (const agent of input.agents) {
    const preInstallCommands = agent.recipe.installation.preInstallCommands ?? []
    lines.push(
      `# Install ${agent.name}`,
      `RUN mkdir -p ${agent.recipe.home.target} \\`,
      ...preInstallCommands.map(command => `    && ${command} \\`),
      `    && curl -fsSL ${agent.recipe.installation.url} | ${agent.recipe.installation.shell}`,
      '',
    )
  }
  if (input.agents.length > 0) {
    lines.push(
      '# Set the PATH to include AI tools',
      'ENV PATH="/home/devbox/.local/bin:${PATH}"',
      '',
    )
  }

  if (input.buildNodeRuntime !== undefined && input.skillAgents.length > 0) {
    const skillAgentArguments = input.skillAgents.map(agent => `-a ${agent}`).join(' ')
    lines.push(
      '# Install Agent Skills',
      'RUN set -eux \\',
      '    && mkdir -p /home/devbox/.agents/skills \\',
      `    && export PATH="${input.buildNodeRuntime.runtimeRoot}/bin:$PATH" \\`,
      `    && npx -y skills add ycs77/skills -g ${skillAgentArguments} -s '*' -y`,
      '',
    )
  }

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

  const hasClaudeCode = input.agents.some(agent => agent.name === 'claude-code')
  const hasOmp = input.agents.some(agent => agent.name === 'omp')
  if (hasClaudeCode || hasOmp) {
    const ownershipCommands: string[] = []
    lines.push('# Copy AI dotfiles')
    if (hasClaudeCode) {
      lines.push('COPY .claude/settings.json /home/devbox/.claude/settings.json')
      ownershipCommands.push('chown devbox:devbox /home/devbox/.claude/settings.json')
    }
    if (hasOmp) {
      lines.push('COPY .omp/agent/config.yml /home/devbox/.omp/agent/config.yml')
      ownershipCommands.push(
        'chown devbox:devbox /home/devbox/.omp/agent',
        'chown devbox:devbox /home/devbox/.omp/agent/config.yml',
      )
    }
    lines.push(`RUN ${ownershipCommands.join(' \\\n    && ')}`, '')
  }

  lines.push(
    'COPY entrypoint.sh /usr/local/bin/entrypoint.sh',
    'COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf',
    'RUN chmod +x /usr/local/bin/entrypoint.sh',
    '',
    'ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]',
  )

  return `${lines.join('\n')}\n`
}

function renderDockerignore(assets: readonly WorkspaceImageDefault[]): string {
  const lines = [
    '# Machine-owned Workspace build context',
    '*',
    '!Dockerfile',
    '!entrypoint.sh',
    '!supervisord.conf',
    ...assets.map(asset => `!${asset.relativePath}`),
  ]
  if (assets.some(asset => asset.relativePath === '.claude/settings.json')) {
    lines.push('!.claude', '!.claude/settings.json')
  }
  if (assets.some(asset => asset.relativePath === '.omp/agent/config.yml')) {
    lines.push('!.omp', '!.omp/agent', '!.omp/agent/config.yml')
  }
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

function selectBuildContextAssets(
  agents: readonly ConfiguredAgent[],
): readonly WorkspaceImageDefault[] {
  const assets: WorkspaceImageDefault[] = [...BASE_WORKSPACE_IMAGE_DEFAULTS]
  if (agents.some(agent => agent.name === 'claude-code')) {
    assets.push(CLAUDE_SETTINGS_DEFAULT)
  }
  if (agents.some(agent => agent.name === 'omp')) {
    assets.push(OMP_AGENT_CONFIG_DEFAULT)
  }
  return assets
}

function renderEntrypoint(input: {
  readonly nodeRuntimes: readonly NodeRuntimeRecipe[]
  readonly agents: readonly ConfiguredAgent[]
}): string {
  const lines = ['#!/bin/sh', 'set -eu', '']

  if (input.nodeRuntimes.length > 0) {
    lines.push(
      '# Set the Node.js release line to use',
      'NODE_VERSION="${NODE_VERSION:-}"',
      'if [ -n "$NODE_VERSION" ]; then',
      '  case "$NODE_VERSION" in',
      '    *[!0-9]*)',
      '      echo "NODE_VERSION must be a numeric release line: $NODE_VERSION" >&2',
      '      exit 1',
      '      ;;',
      '  esac',
      '',
      '  NODE_RUNTIME_ROOT="/opt/devbox/runtimes/node/$NODE_VERSION"',
      '  if [ ! -x "$NODE_RUNTIME_ROOT/bin/node" ]; then',
      '    echo "Node.js release line $NODE_VERSION is not installed." >&2',
      '    exit 1',
      '  fi',
      '',
      '  if ! grep -q "# Devbox" /etc/bash.bashrc; then',
      '    printf "\\n# Devbox\\nexport PATH=\\"$NODE_RUNTIME_ROOT/bin:\\$PATH\\"\\n" >> /etc/bash.bashrc',
      '  fi',
      '',
      '  export PATH="$NODE_RUNTIME_ROOT/bin:$PATH"',
      'fi',
      '',
    )
  }

  if (input.agents.some(agent => agent.name === 'agy')) {
    lines.push(
      '# Link shared Agent Skills',
      'if [ ! -L "/home/devbox/.gemini/skills" ]; then',
      '  ln -sfn /home/devbox/.agents/skills /home/devbox/.gemini/skills',
      '  chown -h devbox:devbox /home/devbox/.gemini/skills',
      'fi',
      '',
    )
  }

  lines.push(
    'if [ $# -gt 0 ]; then',
    '  exec gosu devbox "$@"',
    'else',
    '  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf',
    'fi',
  )

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

function renderNodeRuntimeStage(recipe: NodeRuntimeRecipe): string[] {
  const keys = recipe.trustedReleaseKeys.map(key => `      ${key}`).join(' \\\n')

  return [
    `# Install Node.js ${recipe.releaseLine}`,
    'RUN ARCH= OPENSSL_ARCH= && dpkgArch="$(dpkg --print-architecture)" \\',
    '    && case "${dpkgArch##*-}" in \\',
    "      amd64) ARCH='x64' OPENSSL_ARCH='linux-x86_64';; \\",
    "      ppc64el) ARCH='ppc64le' OPENSSL_ARCH='linux-ppc64le';; \\",
    "      s390x) ARCH='s390x' OPENSSL_ARCH='linux*-s390x';; \\",
    "      arm64) ARCH='arm64' OPENSSL_ARCH='linux-aarch64';; \\",
    '      *) echo "unsupported architecture"; exit 1 ;; \\',
    '    esac \\',
    '    && set -eux \\',
    `    && NODE_RUNTIME_VERSION=${recipe.version} \\`,
    `    && NODE_RUNTIME_ROOT=${recipe.runtimeRoot} \\`,
    '    && mkdir -p "$NODE_RUNTIME_ROOT" /tmp/node-source \\',
    '    && cd /tmp/node-source \\',
    // use pre-existing gpg directory
    '    && export GNUPGHOME="$(mktemp -d)" \\',
    // gpg keys listed at https://github.com/nodejs/node#release-keys
    '    && for key in \\',
    `${keys} \\`,
    '    ; do \\',
    '      { gpg --batch --no-options --keyserver hkps://keys.openpgp.org --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; } || \\',
    '      { gpg --batch --no-options --keyserver keyserver.ubuntu.com --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; }; \\',
    '    done \\',
    '    && archive="node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \\',
    '    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \\',
    '    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \\',
    '    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \\',
    '    && gpgconf --kill all \\',
    '    && rm -rf "$GNUPGHOME" \\',
    '    && grep " node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz\\$" SHASUMS256.txt | sha256sum -c - \\',
    '    && tar -xJf "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" -C "$NODE_RUNTIME_ROOT" --strip-components=1 --no-same-owner \\',
    '    && rm "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt \\',
    // Remove unused OpenSSL headers to save ~34MB. See this NodeJS issue: https://github.com/nodejs/node/issues/46451
    '    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \\; \\',
    '    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \\',
    '    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \\',
    '    && npm install -g npm \\',
    '    && npm uninstall -g corepack \\',
    '    && npm install -g yarn pnpm @antfu/ni \\',
    '    && "$NODE_RUNTIME_ROOT/bin/node" --version \\',
    '    && "$NODE_RUNTIME_ROOT/bin/npm" --version \\',
    '    && rm -rf /tmp/node-source',
    '',
  ]
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
