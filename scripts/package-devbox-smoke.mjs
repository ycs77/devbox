import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const workspace = await mkdtemp(join(tmpdir(), 'devbox-package-smoke-'))

async function run(command, args, { cwd = projectRoot, env, expectedCode = 0 } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })
  const [code] = await once(child, 'close')

  assert.equal(code, expectedCode, `${command} ${args.join(' ')} exited with ${code}\n${stderr}`)
  return { stdout, stderr }
}

try {
  const packageDirectory = join(workspace, 'package')
  const prefix = join(workspace, 'prefix')

  await mkdir(packageDirectory)
  await run('pnpm', ['pack', '--pack-destination', packageDirectory])

  const archive = (await readdir(packageDirectory)).find(entry => entry.endsWith('.tgz'))
  assert.notEqual(archive, undefined, 'pnpm pack did not produce an archive')
  await run('npm', ['install', '--global', '--prefix', prefix, join(packageDirectory, archive)])

  const cli = join(prefix, 'bin', 'devbox')
  const help = (await run(cli, ['--help'])).stdout
  assert.deepEqual(
    [...help.matchAll(/^  ([a-z]+)\s{2,}/gm)].map(match => match[1]),
    ['init', 'config', 'build', 'rm', 'cleanup', 'up', 'down', 'stop', 'sh'],
  )
  assert.match((await run(cli, ['cleanup', '--help'])).stdout, /--missing-projects/)
  assert.doesNotMatch((await run(cli, ['config', '--help'])).stdout, /--global/)
  assert.match(
    (await run(cli, ['cleanup'], { expectedCode: 2 })).stderr,
    /cleanup requires --missing-projects/,
  )
  assert.match((await run(cli, ['restart'], { expectedCode: 2 })).stderr, /Unused args: `restart`/)
  assert.match(
    (await run(cli, ['exec', 'bash'], { expectedCode: 2 })).stderr,
    /Unused args: `exec`, `bash`/,
  )
  assert.match((await run(cli, ['logs'], { expectedCode: 2 })).stderr, /Unused args: `logs`/)

  const shellHelp = (await run(cli, ['sh', '--help'])).stdout
  assert.match(shellHelp, /Usage:\n  \$ devbox sh/)

  const home = join(workspace, 'home')
  const dockerEnvironment = {
    HOME: home,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(homedir(), '.docker'),
  }
  const dockerAvailable =
    spawnSync('docker', ['info'], {
      env: { ...process.env, ...dockerEnvironment },
      stdio: 'ignore',
    }).status === 0 &&
    spawnSync('docker', ['compose', 'version'], {
      env: { ...process.env, ...dockerEnvironment },
      stdio: 'ignore',
    }).status === 0
  if (dockerAvailable) {
    const sandbox = join(workspace, 'sandbox')
    const devboxHome = join(home, '.devbox')
    const stateDirectory = join(devboxHome, 'projects', 'smoke')
    const missingImage = `devbox-smoke-missing-${process.pid}-${Date.now()}:latest`
    await mkdir(sandbox)
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(
      join(devboxHome, 'config.yaml'),
      'version: 1\nnode: []\nagent: []\nagent_notifications: false\n',
    )
    await writeFile(
      join(devboxHome, 'projects.yaml'),
      `version: 1\nprojects:\n  ${JSON.stringify(sandbox)}:\n    identity: smoke\n    name: smoke\n`,
    )
    await writeFile(
      join(stateDirectory, 'compose.yaml'),
      `name: smoke\nservices:\n  devbox:\n    image: ${missingImage}\n    pull_policy: never\n`,
    )

    const lifecycle = await run(cli, ['up'], {
      cwd: sandbox,
      env: dockerEnvironment,
      expectedCode: 1,
    })
    assert.match(lifecycle.stderr, new RegExp(missingImage))
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
