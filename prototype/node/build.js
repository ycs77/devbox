// Enter the prototype image with the default Node.js 24 runtime:
// docker run --rm -it -u devbox -v "$PWD:/workspace" devbox:latest
//
// Switch to Node.js 22 with:
// docker run --rm -it -u devbox -e NODE_VERSION=22 -v "$PWD:/workspace" devbox:latest
//
// Create the some AI directory for the devbox user with:
// docker volume create --name devbox-claude
// docker volume create --name devbox-codex
// docker volume create --name devbox-omp
// docker run --rm -it -u devbox -v "$PWD:/workspace" -v devbox-claude:/home/devbox/.claude -v devbox-codex:/home/devbox/.codex -v devbox-omp:/home/devbox/.omp devbox:latest
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const image = 'devbox:latest'
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const dockerfile = fileURLToPath(new URL('./Dockerfile', import.meta.url))

const build = spawn('docker', ['build', '--file', dockerfile, '--tag', image, '.'], {
  cwd: projectRoot,
  stdio: 'inherit',
})

const [code] = await once(build, 'close')

if (code !== 0) {
  process.exitCode = code ?? 1
} else {
  console.log(image)
}
