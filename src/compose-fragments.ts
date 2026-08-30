export interface NodeComposeFragment {
  readonly environment: {
    readonly NODE_VERSION: string
  }
}

export interface AgentComposeFragment {
  readonly agent: string
  readonly volume: {
    readonly name: string
    readonly target: string
    readonly external: true
  }
}

export interface NotificationComposeFragment {
  readonly environment: {
    readonly PULSE_SERVER: 'unix:/tmp/pulse-socket'
  }
  readonly volume: {
    readonly source: '/mnt/wslg/runtime-dir/pulse/native'
    readonly target: '/tmp/pulse-socket'
    readonly readOnly: true
  }
}

export interface ComposeFragmentSelectionInput {
  readonly selectedNode: string | null
  readonly configuredAgents: readonly string[]
  readonly agentNotifications: boolean
}

export interface ComposeFragments {
  readonly node: NodeComposeFragment | undefined
  readonly agents: readonly AgentComposeFragment[]
  readonly notification: NotificationComposeFragment | undefined
}

const AGENT_FRAGMENTS: Readonly<Record<string, AgentComposeFragment>> = {
  'claude-code': {
    agent: 'claude-code',
    volume: { name: 'devbox-claude', target: '/home/devbox/.claude', external: true },
  },
  codex: {
    agent: 'codex',
    volume: { name: 'devbox-codex', target: '/home/devbox/.codex', external: true },
  },
  agy: {
    agent: 'agy',
    volume: { name: 'devbox-agy', target: '/home/devbox/.gemini', external: true },
  },
  omp: {
    agent: 'omp',
    volume: { name: 'devbox-omp', target: '/home/devbox/.omp', external: true },
  },
}

const NOTIFICATION_AGENTS: Readonly<Record<string, true>> = {
  'claude-code': true,
  codex: true,
  omp: true,
}

const NOTIFICATION_FRAGMENT: NotificationComposeFragment = {
  environment: { PULSE_SERVER: 'unix:/tmp/pulse-socket' },
  volume: {
    source: '/mnt/wslg/runtime-dir/pulse/native',
    target: '/tmp/pulse-socket',
    readOnly: true,
  },
}

export function selectComposeFragments({
  selectedNode,
  configuredAgents,
  agentNotifications,
}: ComposeFragmentSelectionInput): ComposeFragments {
  const agents: AgentComposeFragment[] = []
  let hasNotificationAgent = false
  for (const agent of configuredAgents) {
    const fragment = AGENT_FRAGMENTS[agent]
    if (fragment !== undefined) {
      agents.push(fragment)
    }
    hasNotificationAgent ||= NOTIFICATION_AGENTS[agent] === true
  }

  return {
    node: selectedNode === null ? undefined : { environment: { NODE_VERSION: selectedNode } },
    agents,
    notification: agentNotifications && hasNotificationAgent ? NOTIFICATION_FRAGMENT : undefined,
  }
}
