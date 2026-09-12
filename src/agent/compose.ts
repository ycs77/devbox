import { PACKAGED_AGENTS } from '../catalog/index.js'

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

export interface AgentComposeFragments {
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

export function selectAgentComposeFragments(
  configuredAgents: readonly string[],
  notificationsEnabled: boolean,
): AgentComposeFragments {
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
    agents,
    notification: notificationsEnabled && hasNotificationAgent ? NOTIFICATION_FRAGMENT : undefined,
  }
}
