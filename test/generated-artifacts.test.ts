import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProject } from '../src/project/index.js'
import { success } from '../src/result.js'
import { buildWorkspace } from '../src/workspace/build.js'

const fixtureDirectory = fileURLToPath(new URL('./fixtures/generated/', import.meta.url))
const temporaryDirectories: string[] = []

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtureDirectory, name), 'utf8')
}

async function prepareAllFeaturesGlobalConfiguration(devboxHome: string): Promise<void> {
  await mkdir(devboxHome, { recursive: true })
  await writeFile(
    join(devboxHome, 'config.yaml'),
    [
      'version: 1',
      'node: [22, 24]',
      'agent: [claude-code, codex, agy, omp]',
      'agent_notifications: true',
      '',
    ].join('\n'),
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('generated Workspace and Sandbox artifacts', () => {
  it('preserves complete all-features Workspace artifacts', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'devbox-generated-artifacts-test-'))
    temporaryDirectories.push(sandbox)
    const devboxHome = join(sandbox, '.devbox')
    await prepareAllFeaturesGlobalConfiguration(devboxHome)

    let dockerfile = ''
    let entrypoint = ''
    const workspace = await buildWorkspace({
      devboxHome,
      executeDockerBuild: async invocation => {
        dockerfile = await readFile(join(invocation.context, 'Dockerfile'), 'utf8')
        entrypoint = await readFile(join(invocation.context, 'entrypoint.sh'), 'utf8')
        return success(undefined)
      },
    })

    expect(workspace).toMatchObject({ ok: true })
    expect(dockerfile).toBe(await fixture('workspace-all-features.Dockerfile'))
    expect(entrypoint).toBe(await fixture('workspace-all-features.entrypoint.sh'))
  })

  it('preserves the complete all-features Sandbox Compose artifact', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'devbox-generated-artifacts-test-'))
    temporaryDirectories.push(sandbox)
    const devboxHome = join(sandbox, '.devbox')
    const projectRoot = join(sandbox, 'project')
    await mkdir(projectRoot)
    await prepareAllFeaturesGlobalConfiguration(devboxHome)

    const project = await initializeProject({
      root: projectRoot,
      devboxHome,
      validateHost: async () => success(undefined),
      confirm: async () => true,
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
    const compose = await readFile(join(project.value.stateDirectory, 'compose.yaml'), 'utf8')
    expect(compose.split(sandbox).join('__SANDBOX__')).toBe(
      await fixture('project-all-features.compose.yaml'),
    )
  })
})
