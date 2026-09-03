import { parse, stringify } from 'yaml'
import { selectComposeFragments, type ComposeFragmentSelectionInput } from './compose-fragments.js'
import { failure, success, type Result } from '../result.js'
import { WORKSPACE_IMAGE } from '../workspace/image.js'

export interface ProjectComposeInput extends ComposeFragmentSelectionInput {
  readonly projectRoot: string
  readonly sandboxName: string
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
      readonly build?: unknown
    }
  }
}

export function renderProjectCompose(input: ProjectComposeInput): Result<string> {
  const fragments = selectComposeFragments(input)
  const environment = {
    ...fragments.node?.environment,
    ...fragments.notification?.environment,
  }
  const volumes = [
    {
      type: 'bind',
      source: input.projectRoot,
      target: `/workspace/${input.sandboxName}`,
    },
    ...fragments.agents.map(fragment => ({
      type: 'volume',
      source: fragment.volume.name,
      target: fragment.volume.target,
    })),
    ...(fragments.notification === undefined
      ? []
      : [
          {
            type: 'bind',
            source: fragments.notification.volume.source,
            target: fragments.notification.volume.target,
            read_only: fragments.notification.volume.readOnly,
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
        container_name: input.sandboxName,
        working_dir: `/workspace/${input.sandboxName}`,
        ...(Object.keys(environment).length === 0 ? {} : { environment }),
        volumes,
      },
    },
    ...(fragments.agents.length === 0
      ? {}
      : {
          volumes: Object.fromEntries(
            fragments.agents.map(fragment => [
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
      service.container_name !== input.sandboxName ||
      service.working_dir !== `/workspace/${input.sandboxName}` ||
      'build' in service
    ) {
      return false
    }
    return (
      (input.selectedNode === null && service.environment?.NODE_VERSION === undefined) ||
      (input.selectedNode !== null && service.environment?.NODE_VERSION === input.selectedNode)
    )
  } catch {
    return false
  }
}
