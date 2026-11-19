import { spawn } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { descendants, identity } from './processes.mjs'

const [proof, entry, ...cli] = process.argv.slice(2)
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
let owned = [identity(process.pid)]
const record = () => {
  owned = descendants(owned)
  const path = join(proof, `${entry}.processes.json`)
  writeFileSync(`${path}.tmp`, `${JSON.stringify(owned, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}
record()
const child = spawn(
  'script',
  [
    '-qef',
    '--log-in',
    join(proof, `${entry}.input`),
    '--log-out',
    join(proof, `${entry}.terminal`),
    '-c',
    cli.map(quote).join(' '),
  ],
  { stdio: 'inherit' },
)
const timer = setInterval(record, 50)
child.on('error', error => {
  clearInterval(timer)
  writeFileSync(join(proof, `${entry}.runner-error.txt`), String(error))
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  record()
  clearInterval(timer)
  // script -e 傳回 CLI 狀態；被強制終止時沒有可聲稱的 CLI exit code。
  if (signal === null && code !== null) writeFileSync(join(proof, `${entry}.exit`), `${code}\n`)
  else writeFileSync(join(proof, `${entry}.signal`), `${signal}\n`)
})
