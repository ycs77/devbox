export interface PackagedAgent {
  readonly home: {
    readonly volumeName: string
    readonly target: string
  }
  readonly supportsNotifications: boolean
}

export interface NodeRuntimeRecipe {
  readonly releaseLine: string
  readonly version: string
  readonly runtimeRoot: string
  readonly trustedReleaseKeys: readonly string[]
}

const NODE_RELEASE_KEYS = [
  '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
  'DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7',
  'CC68F5A3106FF448322E48ED27F5E38D5B0A215F',
  '8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600',
  '890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4',
  'C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C',
  '108F52B48DB57BB0CC439B2997B01419BD92F80A',
  'A363A499291CBBC940DD62E41F10027AF002F8B0',
  '655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD',
]

export const PACKAGED_NODE_RECIPES: Readonly<Record<string, NodeRuntimeRecipe>> = {
  '24': {
    releaseLine: '24',
    version: '24.19.0',
    runtimeRoot: '/opt/devbox/runtimes/node/24',
    trustedReleaseKeys: NODE_RELEASE_KEYS,
  },
  '22': {
    releaseLine: '22',
    version: '22.23.2',
    runtimeRoot: '/opt/devbox/runtimes/node/22',
    trustedReleaseKeys: NODE_RELEASE_KEYS,
  },
}

export const PACKAGED_SKILL_AGENTS = ['claude-code', 'codex'] as const

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
