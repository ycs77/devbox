import { describe, expect, it } from 'vitest'
import { selectComposeFragments } from '../../src/project/compose-fragments.js'

describe('selectComposeFragments', () => {
  it('selects static Node, Agent, and notification fragments', () => {
    expect(
      selectComposeFragments({
        selectedNode: '22',
        configuredAgents: ['claude-code', 'codex'],
        agentNotifications: true,
      }),
    ).toEqual({
      node: { environment: { NODE_VERSION: '22' } },
      agents: [
        {
          agent: 'claude-code',
          volume: {
            name: 'devbox-claude',
            target: '/home/devbox/.claude',
            external: true,
          },
        },
        {
          agent: 'codex',
          volume: {
            name: 'devbox-codex',
            target: '/home/devbox/.codex',
            external: true,
          },
        },
      ],
      notification: {
        environment: { PULSE_SERVER: 'unix:/tmp/pulse-socket' },
        volume: {
          source: '/mnt/wslg/runtime-dir/pulse/native',
          target: '/tmp/pulse-socket',
          readOnly: true,
        },
      },
    })
  })

  it('omits Node and notification fragments when they are not selected', () => {
    expect(
      selectComposeFragments({
        selectedNode: null,
        configuredAgents: ['claude-code'],
        agentNotifications: false,
      }),
    ).toEqual({
      node: undefined,
      agents: [
        {
          agent: 'claude-code',
          volume: {
            name: 'devbox-claude',
            target: '/home/devbox/.claude',
            external: true,
          },
        },
      ],
      notification: undefined,
    })
  })

  it('selects the OMP home and notification fragments', () => {
    expect(
      selectComposeFragments({
        selectedNode: null,
        configuredAgents: ['omp'],
        agentNotifications: true,
      }),
    ).toEqual({
      node: undefined,
      agents: [
        {
          agent: 'omp',
          volume: {
            name: 'devbox-omp',
            target: '/home/devbox/.omp',
            external: true,
          },
        },
      ],
      notification: {
        environment: { PULSE_SERVER: 'unix:/tmp/pulse-socket' },
        volume: {
          source: '/mnt/wslg/runtime-dir/pulse/native',
          target: '/tmp/pulse-socket',
          readOnly: true,
        },
      },
    })
  })

  it('selects the Antigravity home without a notification fragment', () => {
    expect(
      selectComposeFragments({
        selectedNode: null,
        configuredAgents: ['agy'],
        agentNotifications: true,
      }),
    ).toEqual({
      node: undefined,
      agents: [
        {
          agent: 'agy',
          volume: {
            name: 'devbox-agy',
            target: '/home/devbox/.gemini',
            external: true,
          },
        },
      ],
      notification: undefined,
    })
  })

  it('does not select notifications when no supported Agent is configured', () => {
    expect(
      selectComposeFragments({
        selectedNode: '24',
        configuredAgents: [],
        agentNotifications: true,
      }),
    ).toEqual({
      node: { environment: { NODE_VERSION: '24' } },
      agents: [],
      notification: undefined,
    })
  })
})
