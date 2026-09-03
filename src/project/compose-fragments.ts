import { PACKAGED_AGENTS } from '../catalog/index.js'

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
  readonly environment: Record<string, string>
  readonly volume: {
    readonly source: string
    readonly target: string
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
    const packagedAgent = PACKAGED_AGENTS[agent]
    if (packagedAgent !== undefined) {
      agents.push({
        agent,
        volume: {
          name: packagedAgent.home.volumeName,
          target: packagedAgent.home.target,
          external: true,
        },
      })
      hasNotificationAgent ||= packagedAgent.supportsNotifications
    }
  }

  return {
    node: selectedNode === null ? undefined : { environment: { NODE_VERSION: selectedNode } },
    agents,
    notification: agentNotifications && hasNotificationAgent ? NOTIFICATION_FRAGMENT : undefined,
  }
}
