import { PACKAGED_AGENTS, type PackagedAgent } from '../catalog/index.js'
import claudeSettings from './image-defaults/.claude/settings.json?raw'
import ompAgentConfig from './image-defaults/.omp/agent/config.yml?raw'

export interface AgentBuildContextAsset {
  readonly relativePath: string
  readonly content: string
}

export interface AgentWorkspaceContribution {
  readonly buildContextAssets: readonly AgentBuildContextAsset[]
  readonly dockerignoreEntries: readonly string[]
  readonly installationDockerfileLines: readonly string[]
  readonly assetDockerfileLines: readonly string[]
  readonly notificationDockerfileLines: readonly string[]
  readonly entrypointSetup: readonly string[]
}

interface ConfiguredAgent {
  readonly name: string
  readonly recipe: PackagedAgent
}

export function createAgentWorkspaceContribution(input: {
  readonly configuredAgents: readonly string[]
  readonly notificationsEnabled: boolean
  readonly buildNodeRuntimeRoot: string | undefined
}): AgentWorkspaceContribution {
  const agents = input.configuredAgents.map(name => ({ name, recipe: PACKAGED_AGENTS[name] }))
  const buildContextAssets = selectBuildContextAssets(agents)
  const skillAgents = agents
    .filter(agent => agent.recipe.supportsSkillInstallation)
    .map(agent => agent.name)

  return {
    buildContextAssets,
    dockerignoreEntries: selectDockerignoreEntries(buildContextAssets),
    installationDockerfileLines: renderAgentInstallations(
      agents,
      input.buildNodeRuntimeRoot,
      skillAgents,
    ),
    assetDockerfileLines: renderAgentAssets(agents),
    notificationDockerfileLines: renderAgentNotifications(agents, input.notificationsEnabled),
    entrypointSetup: renderAgentEntrypointSetup(agents),
  }
}

function renderAgentInstallations(
  agents: readonly ConfiguredAgent[],
  buildNodeRuntimeRoot: string | undefined,
  skillAgents: readonly string[],
): string[] {
  const lines: string[] = []
  for (const agent of agents) {
    const preInstallCommands = agent.recipe.installation.preInstallCommands ?? []
    lines.push(
      `# Install ${agent.name}`,
      `RUN mkdir -p ${agent.recipe.home.target} \\`,
      ...preInstallCommands.map(command => `    && ${command} \\`),
      `    && curl -fsSL ${agent.recipe.installation.url} | ${agent.recipe.installation.shell}`,
      '',
    )
  }
  if (agents.length > 0) {
    lines.push(
      '# Set the PATH to include AI tools',
      'ENV PATH="/home/devbox/.local/bin:${PATH}"',
      '',
    )
  }
  if (buildNodeRuntimeRoot !== undefined && skillAgents.length > 0) {
    const skillAgentArguments = skillAgents.map(agent => `-a ${agent}`).join(' ')
    lines.push(
      '# Install Agent Skills',
      'RUN set -eux \\',
      '    && mkdir -p /home/devbox/.agents/skills \\',
      `    && export PATH="${buildNodeRuntimeRoot}/bin:$PATH" \\`,
      `    && npx -y skills add ycs77/skills -g ${skillAgentArguments} -s '*' -y`,
      '',
    )
  }
  return lines
}

function selectDockerignoreEntries(assets: readonly AgentBuildContextAsset[]): readonly string[] {
  const entries: string[] = []
  if (assets.some(asset => asset.relativePath === '.claude/settings.json')) {
    entries.push('!.claude', '!.claude/settings.json')
  }
  if (assets.some(asset => asset.relativePath === '.omp/agent/config.yml')) {
    entries.push('!.omp', '!.omp/agent', '!.omp/agent/config.yml')
  }
  return entries
}

function selectBuildContextAssets(
  agents: readonly ConfiguredAgent[],
): readonly AgentBuildContextAsset[] {
  const assets: AgentBuildContextAsset[] = []
  if (agents.some(agent => agent.name === 'claude-code')) {
    assets.push({ relativePath: '.claude/settings.json', content: claudeSettings })
  }
  if (agents.some(agent => agent.name === 'omp')) {
    assets.push({ relativePath: '.omp/agent/config.yml', content: ompAgentConfig })
  }
  return assets
}

function renderAgentAssets(agents: readonly ConfiguredAgent[]): string[] {
  const hasClaudeCode = agents.some(agent => agent.name === 'claude-code')
  const hasOmp = agents.some(agent => agent.name === 'omp')
  if (!hasClaudeCode && !hasOmp) {
    return []
  }

  const ownershipCommands: string[] = []
  const lines = ['# Copy AI dotfiles']
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
  return lines
}

function renderAgentNotifications(
  agents: readonly ConfiguredAgent[],
  notificationsEnabled: boolean,
): string[] {
  const commands = notificationsEnabled
    ? agents.flatMap(agent =>
        agent.recipe.supportsNotifications ? agent.recipe.notificationInstallationCommands : [],
      )
    : []
  if (commands.length === 0) {
    return []
  }

  return [
    '# Install Agent Notification Plugins',
    'USER devbox',
    'RUN set -eux \\',
    ...commands.map(
      (command, index) => `    && ${command}${index < commands.length - 1 ? ' \\' : ''}`,
    ),
    'USER root',
    '',
  ]
}

function renderAgentEntrypointSetup(agents: readonly ConfiguredAgent[]): string[] {
  if (!agents.some(agent => agent.name === 'agy')) {
    return []
  }

  return [
    '# Link shared Agent Skills',
    'if [ ! -L "/home/devbox/.gemini/skills" ]; then',
    '  ln -sfn /home/devbox/.agents/skills /home/devbox/.gemini/skills',
    '  chown -h devbox:devbox /home/devbox/.gemini/skills',
    'fi',
    '',
  ]
}
