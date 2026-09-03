import { PACKAGED_AGENTS } from '../catalog/index.js'
import { currentHostEnvironment, type HostEnvironment } from '../host.js'

export async function ensureSharedAgentVolumes(
  configuredAgents: readonly string[],
  environment: HostEnvironment = currentHostEnvironment(),
): Promise<void> {
  for (const configuredAgent of configuredAgents) {
    const volumeName = PACKAGED_AGENTS[configuredAgent]?.home.volumeName
    if (volumeName !== undefined) {
      await environment.run('docker', ['volume', 'create', '--driver', 'local', volumeName])
    }
  }
}
