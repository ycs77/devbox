import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = join(projectRoot, 'packages', 'devbox')
const workspace = await mkdtemp(join(tmpdir(), 'devbox-package-smoke-'))

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', ...options })
  const [code] = await once(child, 'close')

  assert.equal(code, 0, `${command} ${args.join(' ')} exited with ${code}`)
}

try {
  const packageDirectory = join(workspace, 'package')
  const prefix = join(workspace, 'prefix')
  const home = join(workspace, 'home')
  const repositoryRoot = join(workspace, 'repository')
  const firstProjectRoot = join(repositoryRoot, 'a-b', 'c')
  const collidingProjectRoot = join(repositoryRoot, 'a', 'b-c')
  const stateDirectory = join(
    home,
    '.devbox',
    'projects',
    `${basename(tmpdir())}-${basename(workspace)}-repository-a-b-c`,
  )
  const configurationPath = join(stateDirectory, 'config.yaml')

  await Promise.all([mkdir(packageDirectory), mkdir(repositoryRoot)])
  await run('git', ['init', '--quiet', repositoryRoot])
  await Promise.all([
    mkdir(firstProjectRoot, { recursive: true }),
    mkdir(collidingProjectRoot, { recursive: true }),
  ])
  await run('pnpm', ['--dir', packageRoot, 'pack', '--pack-destination', packageDirectory])

  const archive = (await readdir(packageDirectory)).find(entry => entry.endsWith('.tgz'))
  assert.notEqual(archive, undefined, 'pnpm pack did not produce an archive')
  await run('npm', ['install', '--global', '--prefix', prefix, join(packageDirectory, archive)])

  const devbox = join(prefix, 'bin', 'devbox')
  const environment = { ...process.env, HOME: home }
  const configuration = `version: 1\nprojectRoot: ${JSON.stringify(firstProjectRoot)}\n`

  await run(devbox, ['init'], { cwd: firstProjectRoot, env: environment })
  await expectNoFile(join(firstProjectRoot, 'devbox.yaml'))
  assert.equal(await readFile(configurationPath, 'utf8'), configuration)

  await run(devbox, ['init'], { cwd: firstProjectRoot, env: environment })
  assert.equal(await readFile(configurationPath, 'utf8'), configuration)

  await run(devbox, ['init'], { cwd: collidingProjectRoot, env: environment })
  assert.equal(await readFile(configurationPath, 'utf8'), configuration)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function expectNoFile(path) {
  await assert.rejects(access(path))
}
