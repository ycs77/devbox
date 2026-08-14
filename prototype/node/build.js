// Build the prototype image with:
// docker build --file prototype/node/Dockerfile --tag devbox:latest .
//
// Enter the prototype image with:
// docker run --rm -it --user devbox -e NODE_VERSION=24 devbox:latest /bin/bash
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
