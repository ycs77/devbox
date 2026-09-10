import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProject } from '../../src/project/index.js'
import { success } from '../../src/result.js'

const temporaryDirectories: string[] = []
const dockerComposeAvailable =
  spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0
const dockerComposeEnvironment = { ...process.env }
delete dockerComposeEnvironment.COMPOSE_PROJECT_NAME
delete dockerComposeEnvironment.APP_PORT

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-compose-smoke-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('published Compose definition', () => {
  it.runIf(dockerComposeAvailable)(
    'is accepted by Docker Compose with its literal Sandbox configuration',
    async () => {
      const sandbox = await temporaryDirectory()
      const root = join(sandbox, 'project')
      const devboxHome = join(sandbox, 'user-state', '.devbox')
      await mkdir(root)

      const project = await initializeProject({
        root,
        devboxHome,
        validateHost: async () => success(undefined),
        confirm: async () => true,
        initialGlobalConfiguration: {
          version: 1,
          node: ['24'],
          agent: [],
          agent_notifications: false,
        },
        initialLocalConfiguration: {
          version: 1,
          node: '24',
          ports: ['3000:3000', 'APP_PORT:5173:5173'],
        },
      })

      expect(project).toMatchObject({ ok: true, value: { created: true } })
      if (!project.ok) {
        throw new Error(project.error.observed)
      }

      const composePath = join(project.value.stateDirectory, 'compose.yaml')
      const compose = spawnSync(
        'docker',
        [
          'compose',
          '--project-directory',
          root,
          '--file',
          composePath,
          'config',
          '--format',
          'json',
        ],
        { encoding: 'utf8', env: dockerComposeEnvironment },
      )

      expect(compose.status, compose.stderr).toBe(0)
      expect(JSON.parse(compose.stdout)).toMatchObject({
        name: project.value.sandboxName,
        services: {
          devbox: {
            container_name: `devbox-${project.value.sandboxName}`,
            image: 'devbox-workspace:latest',
            working_dir: `/workspace/${project.value.sandboxName}`,
            environment: { NODE_VERSION: '24' },
            ports: expect.arrayContaining([
              expect.objectContaining({ published: '3000', target: 3000 }),
              expect.objectContaining({ published: '5173', target: 5173 }),
            ]),
          },
        },
      })
    },
  )
})
