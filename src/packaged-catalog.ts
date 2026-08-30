export interface PackagedAgent {
  readonly home: {
    readonly volumeName: string
    readonly target: string
  }
  readonly supportsNotifications: boolean
}

export const PACKAGED_NODE_RELEASE_LINES = ['24', '22'] as const

export const PACKAGED_AGENTS: Readonly<Record<string, PackagedAgent>> = {
  'claude-code': {
    home: { volumeName: 'devbox-claude', target: '/home/devbox/.claude' },
    supportsNotifications: true,
  },
  codex: {
    home: { volumeName: 'devbox-codex', target: '/home/devbox/.codex' },
    supportsNotifications: true,
  },
  agy: {
    home: { volumeName: 'devbox-agy', target: '/home/devbox/.gemini' },
    supportsNotifications: false,
  },
  omp: {
    home: { volumeName: 'devbox-omp', target: '/home/devbox/.omp' },
    supportsNotifications: true,
  },
}

export const PACKAGED_RUNTIME_CATALOG = {
  runtimes: { node: PACKAGED_NODE_RELEASE_LINES },
  agents: Object.keys(PACKAGED_AGENTS),
}
