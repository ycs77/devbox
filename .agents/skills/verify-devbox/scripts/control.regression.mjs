import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { living } from './processes.mjs'

const control = fileURLToPath(new URL('./control.mjs', import.meta.url))
const pause = () => new Promise(resolve => setTimeout(resolve, 100))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const runs = []
const harness = docker => {
  const proof = mkdtempSync(join(tmpdir(), 'devbox-control-regression-'))
  const env = { ...process.env, DOCKER_HOST: `unix://${proof}/missing.sock` }
  const invoke = (...args) =>
    spawnSync(process.execPath, [control, proof, ...args], {
      env,
      encoding: 'utf8',
      timeout: 45000,
    })
  const ok = (...args) => {
    const result = invoke(...args)
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  const h = { proof, invoke, ok, state: () => json(join(proof, 'run.json')) }
  runs.push(h)
  ok('launch', ...(docker ? ['docker'] : []))
  console.log(`真實終端證據：${proof}`)
  return h
}
const init = h => {
  h.ok('snapshot', 'before-init')
  h.ok('open', 'init-save', 'init')
  h.ok('wait', 'Configured Node release lines')
  h.ok('send', 'Enter')
  h.ok('wait', 'Configured Agents')
  const completed = h.invoke('wait', 'Configured Node release lines', '0.3')
  assert.notEqual(completed.status, 0, '同一命令已提交的提示不可匹配')
  assert.match(completed.stderr, /Timed out/)
  h.ok('send', 'Enter')
  h.ok('wait', 'Enable Agent notifications')
  h.ok('send', 'Right', 'Enter')
  h.ok('wait', 'Selected Node release line')
  h.ok('send', 'Enter')
  h.ok('wait', 'Published ports')
  h.ok('send', '-N', String('APP_PORT:5173:5173'.length), 'BSpace')
  h.ok('text', 'VERIFY_PORT:5173:5173')
  h.ok('send', 'Enter', 'Enter')
  h.ok('wait', 'Save configuration?')
  h.ok('send', 'Enter')
  h.ok('finish', 'init-save')
  const screen = readFileSync(join(h.proof, 'init-save.pane.txt'), 'utf8')
  assert.match(screen, /Next: run devbox build/)
  h.ok('snapshot', 'after-init')
  h.ok('check-init')
  assert.equal(json(join(h.proof, 'init-save.verdict.json')).passed, true)
  assert.match(
    readFileSync(join(h.proof, 'init-save.terminal'), 'utf8'),
    /Configured Node release lines/,
  )
}
const block = async h => {
  h.ok('open', 'blocked', 'init')
  h.ok('wait', 'Configured Node release lines')
  h.ok('send', 'Enter')
  h.ok('wait', 'Configured Agents')
  h.ok('send', 'Enter')
  h.ok('wait', 'Enable Agent notifications')
  h.ok('send', 'Right', 'Enter')
  h.ok('wait', 'Selected Node release line')
  h.ok('send', 'Enter')
  h.ok('wait', 'Published ports')
  h.ok('send', '-N', String('APP_PORT:5173:5173'.length), 'BSpace')
  h.ok('text', 'invalid')
  h.ok('send', 'Enter', 'Enter')
  assert.match(h.ok('wait', '▲'), /Published ports/)
  const cli = await findProcess(h, 'blocked', argv => argv[1]?.endsWith('/dist/cli.mjs'))
  process.kill(cli.pid, 'SIGSTOP')
  return cli
}
const findProcess = async (h, entry, matches) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const path = join(h.proof, `${entry}.processes.json`)
    if (existsSync(path)) {
      const found = json(path).find(item => {
        if (!living(item)) return false
        try {
          return matches(readFileSync(`/proc/${item.pid}/cmdline`, 'utf8').split('\0'))
        } catch {
          return false
        }
      })
      if (found) return found
    }
    await pause()
  }
  assert.fail(`未找到本 run 的 ${entry} 自有程序`)
}
const ttyGone = h => {
  const result = spawnSync('tmux', ['-L', h.state().socket, 'has-session'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0, '自有 TTY 必須已停止')
  assert(
    h.state().ownedProcesses.every(item => !living(item)),
    '自有程序必須已停止',
  )
}

try {
  const h = harness(false)
  h.ok('doctor')
  init(h)
  h.ok('snapshot', 'before-config-local')
  h.ok('open', 'config-local', 'config')
  h.ok('wait', 'Where should this configuration apply?')
  h.ok('send', 'Enter')
  h.ok('wait', 'Selected Node release line')
  h.ok('send', 'Enter')
  h.ok('wait', 'Published ports')
  const before = join(h.proof, 'before-config-local')
  const currentPorts = parse(readFileSync(join(before, 'project-config.yaml'), 'utf8')).ports
  h.ok('send', '-N', String(currentPorts.join('\n').length), 'BSpace')
  h.ok('text', 'VERIFY_PORT:5188:5173')
  h.ok('send', 'Enter', 'Enter')
  h.ok('wait', 'Save Project configuration?')
  h.ok('send', 'Enter')
  h.ok('finish', 'config-local')
  assert.match(
    readFileSync(join(h.proof, 'config-local.pane.txt'), 'utf8'),
    /Local configuration updated\./,
  )
  h.ok('snapshot', 'after-config-local')
  const after = join(h.proof, 'after-config-local')
  assert.deepEqual(parse(readFileSync(join(after, 'project-config.yaml'), 'utf8')).ports, [
    'VERIFY_PORT:5188:5173',
  ])
  assert.deepEqual(
    parse(readFileSync(join(after, 'project-compose.yaml'), 'utf8')).services.devbox.ports,
    ['${VERIFY_PORT:-5188}:5173'],
  )
  for (const name of ['config.yaml', 'projects.yaml', 'project-files.json', 'user-file.txt']) {
    assert.equal(readFileSync(join(after, name), 'utf8'), readFileSync(join(before, name), 'utf8'))
  }
  console.log('通過：真實 config-local 儲存、Local／Compose ports 更新，其餘公開檔案不變')
  h.ok('open', 'repeat', 'init')
  const stale = h.invoke('wait', 'Save configuration?', '1')
  assert.notEqual(stale.status, 0, '前一命令的提示不可匹配')
  assert.match(stale.stderr, /has ended/)
  h.ok('finish', 'repeat')
  assert.notEqual(h.state().commands.repeat.pane, h.state().commands['init-save'].pane)
  h.ok('project', 'verify-blocked')
  h.ok('open', 'local-init', 'init')
  h.ok('wait', 'Selected Node release line')
  const previous = h.invoke('wait', 'Save configuration?', '0.3')
  assert.notEqual(previous.status, 0, '新命令仍在操作時也不可匹配前一命令提示')
  assert.match(previous.stderr, /Timed out/)
  h.ok('cleanup')
  ttyGone(h)
  assert.equal(existsSync(h.state().scratch), false)
  console.log('通過：init-save、已完成提示拒絕、連續命令提示隔離')

  const blocked = harness(false)
  const cli = await block(blocked)
  blocked.ok('cleanup')
  ttyGone(blocked)
  assert.equal(living(cli), false)
  assert.equal(blocked.state().cleaned, true)
  assert.equal(existsSync(blocked.state().scratch), false)
  assert.equal(
    existsSync(join(blocked.proof, 'blocked.exit')),
    false,
    '強制終止不能捏造 CLI exit code',
  )
  assert(json(join(blocked.proof, 'cleanup-report.json')).forced.length > 0)
  console.log('通過：▲ 提示與 SIGSTOP 受阻命令 cleanup')

  const signaled = harness(false)
  signaled.ok('open', 'ctrl-c', 'init')
  signaled.ok('wait', 'Configured Node release lines')
  signaled.ok('send', 'C-c')
  const interrupted = signaled.invoke('finish', 'ctrl-c')
  assert.equal(interrupted.status, 130, interrupted.stderr)
  assert.equal(readFileSync(join(signaled.proof, 'ctrl-c.exit'), 'utf8').trim(), '130')
  signaled.ok('open', 'killed', 'init')
  signaled.ok('wait', 'Configured Node release lines')
  const script = await findProcess(signaled, 'killed', argv => argv[0] === 'script')
  process.kill(script.pid, 'SIGKILL')
  const finished = signaled.invoke('finish', 'killed', '2')
  assert.equal(finished.status, 1, finished.stderr)
  assert.match(finished.stderr, /script signal SIGKILL/)
  assert.doesNotMatch(finished.stderr, /Timed out/)
  assert.equal(signaled.state().active, null)
  assert.equal(existsSync(join(signaled.proof, 'killed.exit')), false)
  assert.equal(json(join(signaled.proof, 'killed.finish-error.json')).cliExitCode, null)
  assert.equal(existsSync(join(signaled.proof, 'killed.pane.txt')), true)
  signaled.ok('cleanup')
  ttyGone(signaled)
  console.log('通過：Ctrl-C 保留 130、script SIGKILL 後 finish 立即失敗且不捏造 exit')

  const docker = harness(true)
  init(docker)
  docker.ok('project', 'verify-blocked')
  docker.ok('open', 'pending', 'init')
  docker.ok('wait', 'Selected Node release line')
  const result = docker.invoke('cleanup')
  assert.notEqual(result.status, 0)
  ttyGone(docker)
  assert.equal(docker.state().cleaned, false)
  assert.equal(existsSync(docker.state().scratch), true)
  const projects = join(docker.state().scratch, 'home', '.devbox', 'projects')
  assert(readdirSync(projects).some(entry => existsSync(join(projects, entry, 'compose.yaml'))))
  assert.match(
    readFileSync(join(docker.proof, 'cleanup-report.json'), 'utf8'),
    /Docker down failed/,
  )
  assert(readdirSync(docker.proof).some(name => name.startsWith('cleanup-docker-')))
  const retry = docker.invoke('cleanup')
  assert.notEqual(retry.status, 0)
  ttyGone(docker)
  assert.equal(docker.state().cleaned, false)
  assert.equal(existsSync(docker.state().scratch), true)
  assert.equal(
    json(join(docker.proof, 'cleanup-report.json')).phases.find(
      phase => phase.phase === 'stop-owned-processes',
    ).ok,
    true,
  )
  console.log('通過：Docker 無 socket 保留資料、清掉 TTY、無 pane 重試')
} finally {
  const errors = []
  for (const h of runs) {
    try {
      if (!existsSync(join(h.proof, 'run.json'))) continue
      const result = h.invoke('cleanup')
      ttyGone(h)
      const state = h.state()
      if (existsSync(state.scratch)) {
        // 僅測試 teardown 可移除這份故障資料；正式 cleanup 的安全門檻不變。
        assert.equal(state.dockerHost, `unix://${h.proof}/missing.sock`)
        assert.equal(existsSync(join(h.proof, 'missing.sock')), false)
        for (const entry of Object.keys(state.commands)) {
          assert.equal(json(join(h.proof, `${entry}.command.json`)).argv[2], 'init')
        }
        assert(state.scratch.startsWith(join(tmpdir(), 'devbox-verify-')))
        rmSync(state.scratch, { recursive: true, force: true })
      }
      writeFileSync(
        join(h.proof, 'regression-teardown.json'),
        `${JSON.stringify({ processesStopped: true, scratchRemoved: true, cleanupStatus: result.status, dockerResourcesCreated: false }, null, 2)}\n`,
      )
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, '回歸測試 teardown 失敗；保留尚未確認的資源')
}
