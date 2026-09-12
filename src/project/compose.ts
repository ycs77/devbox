import { parse, stringify } from 'yaml'
import { selectAgentComposeFragments } from '../agent/compose.js'
import { renderComposePortMapping } from '../configuration/index.js'
import { failure, success, type Result } from '../result.js'
import { selectNodeComposeFragment } from '../runtimes/node/compose.js'
import { WORKSPACE_IMAGE } from '../workspace/image.js'

export interface ProjectComposeInput {
  readonly projectRoot: string
  readonly sandboxName: string
  readonly selectedNode: string | null
  readonly configuredAgents: readonly string[]
  readonly agentNotifications: boolean
  readonly claudeHostConfiguration: string | undefined
  readonly ports: readonly string[]
}

interface RenderedProjectCompose {
  readonly name: unknown
  readonly 'x-devbox': {
    readonly version: unknown
    readonly project_root: unknown
    readonly compose_name: unknown
    readonly sandbox_service: unknown
  }
  readonly services: {
    readonly devbox: {
      readonly image: unknown
      readonly container_name: unknown
      readonly working_dir: unknown
      readonly environment?: { readonly NODE_VERSION?: unknown }
      readonly ports?: unknown
      readonly build?: unknown
    }
  }
}

export function renderProjectCompose(input: ProjectComposeInput): Result<string> {
  const node = selectNodeComposeFragment(input.selectedNode)
  const agent = selectAgentComposeFragments(input.configuredAgents, input.agentNotifications)
  const environment = {
    ...node?.environment,
    ...agent.notification?.environment,
  }
  const volumes = [
    {
      type: 'bind',
      source: input.projectRoot,
      target: `/workspace/${input.sandboxName}`,
    },
    ...agent.agents.map(fragment => ({
      type: 'volume',
      source: fragment.volume.name,
      target: fragment.volume.target,
    })),
    ...(input.claudeHostConfiguration === undefined
      ? []
      : [
          {
            type: 'bind',
            source: input.claudeHostConfiguration,
            target: '/home/devbox/.claude.json',
          },
        ]),
    ...(agent.notification === undefined
      ? []
      : [
          {
            type: 'bind',
            source: agent.notification.volume.source,
            target: agent.notification.volume.target,
            read_only: agent.notification.volume.readOnly,
          },
        ]),
  ]
  const definition = {
    name: input.sandboxName,
    'x-devbox': {
      version: 1,
      project_root: input.projectRoot,
      compose_name: input.sandboxName,
      sandbox_service: 'devbox',
    },
    services: {
      devbox: {
        image: WORKSPACE_IMAGE,
        hostname: 'devbox',
        container_name: `devbox-${input.sandboxName}`,
        working_dir: `/workspace/${input.sandboxName}`,
        ...(input.ports.length === 0
          ? {}
          : { ports: input.ports.map(port => renderComposePortMapping(port)) }),
        ...(Object.keys(environment).length === 0 ? {} : { environment }),
        volumes,
      },
    },
    ...(agent.agents.length === 0
      ? {}
      : {
          volumes: Object.fromEntries(
            agent.agents.map(fragment => [
              fragment.volume.name,
              { name: fragment.volume.name, external: fragment.volume.external },
            ]),
          ),
        }),
  }
  const source = stringify(definition)

  return validatesProjectCompose(source, input)
    ? success(source)
    : failure({
        kind: 'operational',
        code: 'invalid-project-compose',
        observed: `Devbox generated an invalid Compose definition for Project ${input.projectRoot}.`,
        nextAction: 'Run the command again. If the problem continues, report it as a Devbox bug.',
      })
}

function validatesProjectCompose(source: string, input: ProjectComposeInput): boolean {
  try {
    const definition = parse(source) as RenderedProjectCompose
    if (definition.name !== input.sandboxName) {
      return false
    }
    const metadata = definition['x-devbox']
    if (
      metadata.version !== 1 ||
      metadata.project_root !== input.projectRoot ||
      metadata.compose_name !== input.sandboxName ||
      metadata.sandbox_service !== 'devbox'
    ) {
      return false
    }
    const service = definition.services.devbox
    if (
      service.image !== WORKSPACE_IMAGE ||
      service.container_name !== `devbox-${input.sandboxName}` ||
      service.working_dir !== `/workspace/${input.sandboxName}` ||
      'build' in service
    ) {
      return false
    }
    const ports = input.ports.map(port => renderComposePortMapping(port))
    return (
      JSON.stringify(service.ports ?? []) === JSON.stringify(ports) &&
      ((input.selectedNode === null && service.environment?.NODE_VERSION === undefined) ||
        (input.selectedNode !== null && service.environment?.NODE_VERSION === input.selectedNode))
    )
  } catch {
    return false
  }
}
