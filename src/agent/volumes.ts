import { parse } from 'yaml'
import { currentHostEnvironment, type HostEnvironment } from '../host.js'
import { failure, success, type Result } from '../result.js'

export async function ensureSharedAgentVolumes(
  composeSource: string,
  environment: HostEnvironment = currentHostEnvironment(),
): Promise<Result<void>> {
  const volumeNames = new Set<string>()
  try {
    const definition: unknown = parse(composeSource)
    if (!isMapping(definition)) {
      throw new Error('Expected a Compose mapping.')
    }
    const volumes = definition.volumes
    if (volumes !== undefined) {
      if (!isMapping(volumes)) {
        throw new Error('Expected a volume mapping.')
      }
      for (const [key, volume] of Object.entries(volumes)) {
        if (volume === null) {
          continue
        }
        if (!isMapping(volume)) {
          throw new Error('Expected a volume definition.')
        }
        if (volume.external !== true) {
          continue
        }
        const name = volume.name ?? key
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('Expected an external volume name.')
        }
        volumeNames.add(name)
      }
    }
  } catch {
    return failure({
      kind: 'operational',
      code: 'invalid-project-compose',
      observed: 'Devbox could not read external volumes from the retained Sandbox definition.',
      nextAction: 'Run devbox config to publish the Sandbox definition, then retry devbox up.',
    })
  }

  for (const volumeName of volumeNames) {
    await environment.run('docker', ['volume', 'create', '--driver', 'local', volumeName])
  }
  return success(undefined)
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
