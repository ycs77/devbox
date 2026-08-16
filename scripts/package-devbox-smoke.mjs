import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const workspace = await mkdtemp(join(tmpdir(), 'devbox-package-smoke-'))

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let stdout = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  const [code] = await once(child, 'close')

  assert.equal(code, 0, `${command} ${args.join(' ')} exited with ${code}`)
  return stdout
}

try {
  const packageDirectory = join(workspace, 'package')
  const prefix = join(workspace, 'prefix')

  await mkdir(packageDirectory)
  await run('pnpm', ['pack', '--pack-destination', packageDirectory])

  const archive = (await readdir(packageDirectory)).find(entry => entry.endsWith('.tgz'))
  assert.notEqual(archive, undefined, 'pnpm pack did not produce an archive')
  await run('npm', ['install', '--global', '--prefix', prefix, join(packageDirectory, archive)])

  const help = await run(join(prefix, 'bin', 'devbox'), ['--help'])
  assert.match(help, /devbox init/)
} finally {
  await rm(workspace, { recursive: true, force: true })
}
