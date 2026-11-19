#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { descendants, identity, living, sameProcess } from './processes.mjs'
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const { parse } = createRequire(join(root, 'package.json'))('yaml')
const [proofArgument, action, ...args] = process.argv.slice(2)
assert(
  proofArgument && action,
  'Usage: control.mjs PROOF launch [docker] | doctor | project NAME | open LABEL COMMAND... | wait TEXT [SECONDS] | send KEY... | text TEXT | finish LABEL [SECONDS] | snapshot LABEL | check-init | cleanup',
)
const proof = resolve(proofArgument)
const manifest = join(proof, 'run.json')
const bundle = join(root, 'dist/cli.mjs')
const hash = () => createHash('sha256').update(readFileSync(bundle)).digest('hex')
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
const save = state => writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`)
const label = value => {
  assert(value && /^[a-z0-9-]+$/.test(value), 'Labels use lowercase letters, digits and hyphens')
  return value
}

let state
const environment = () => ({
  PATH: process.env.PATH,
  HOME: join(state.scratch, 'home'),
  TERM: 'xterm-256color',
  LANG: 'C.UTF-8',
  ...(state.dockerHost ? { DOCKER_HOST: state.dockerHost } : {}),
})
const run = (file, commandArgs, required = true) => {
  const result = spawnSync(file, commandArgs, {
    env: environment(),
    encoding: 'utf8',
    timeout: 30000,
  })
  if (required)
    assert.equal(
      result.status,
      0,
      `${file} ${commandArgs.join(' ')}\n${result.stderr ?? result.error ?? ''}`,
    )
  return result
}
const tmux = (...commandArgs) => run('tmux', ['-L', state.socket, ...commandArgs]).stdout
const target = () => state.commands?.[state.active]?.pane ?? state.session
const pane = () => tmux('capture-pane', '-p', '-S', '-', '-t', target())
const capture = path => {
  const result = run(
    'tmux',
    ['-L', state.socket, 'capture-pane', '-p', '-S', '-', '-t', target()],
    false,
  )
  writeFileSync(
    path,
    result.status === 0 ? result.stdout : `Pane unavailable: ${result.stderr ?? result.error}\n`,
  )
}
const pause = () => new Promise(resolvePause => setTimeout(resolvePause, 100))
const waitFor = async (predicate, description, seconds = 30) => {
  assert(Number.isFinite(seconds) && seconds > 0, 'Timeout must be positive seconds')
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await pause()
  }
  capture(join(proof, 'failure-pane.txt'))
  throw new Error(`Timed out: ${description}; run doctor, then cleanup (evidence retained)`)
}
const project = () => join(state.scratch, state.projectName)
const data = () => join(state.scratch, 'home', '.devbox')
const commandExited = () =>
  existsSync(join(proof, `${state.active}.exit`)) ||
  run(
    'tmux',
    ['-L', state.socket, 'display-message', '-p', '-t', target(), '#{pane_dead}'],
    false,
  ).stdout?.trim() !== '0'
const currentPrompt = screen => {
  const lines = screen.trimEnd().split('\n')
  const last = lines.at(-1)
  if (/^[^\n]*[^\s]+@[^\s]+.*[$#]\s*$/.test(last)) return last
  // Clack 會原地將已提交的 ◆ 改為 ◇；僅最後一個提示標記仍有效。
  const marker = lines.findLastIndex(line => /^\s*[◆▲◇■]/u.test(line))
  if (marker < 0 || !/^\s*[◆▲]/u.test(lines[marker])) return ''
  return lines[marker]
}

if (action === 'launch') {
  assert(!existsSync(manifest), 'Use a new proof directory for each launch')
  assert(existsSync(bundle), 'Run pnpm build first')
  assert.equal(process.versions.node.split('.')[0], '26', 'Use the repository Node.js 26 runtime')
  assert(args.length === 0 || (args.length === 1 && args[0] === 'docker'))
  if (args[0] === 'docker')
    assert(
      process.env.DOCKER_HOST,
      'Docker journeys require DOCKER_HOST pointing at an exclusively owned disposable daemon',
    )
  mkdirSync(proof, { recursive: true })
  const id = randomUUID().slice(0, 8)
  state = {
    root: realpathSync(root),
    scratch: mkdtempSync(join(tmpdir(), 'devbox-verify-')),
    socket: `devbox-verify-${id}`,
    session: 'verify',
    projectName: `verify-${id}`,
    projects: [`verify-${id}`],
    bundleHash: hash(),
    version: JSON.parse(readFileSync(join(root, 'package.json'))).version,
    dockerHost: args[0] === 'docker' ? process.env.DOCKER_HOST : null,
    active: null,
    commands: {},
    ownedProcesses: [],
    cleaned: false,
  }
  save(state)
  mkdirSync(join(state.scratch, 'home'))
  mkdirSync(project())
  writeFileSync(join(project(), 'user-file.txt'), 'verification-owned project\n')
  tmux(
    'new-session',
    '-d',
    '-s',
    state.session,
    '-x',
    '120',
    '-y',
    '40',
    '-c',
    project(),
    'bash --noprofile --norc',
  )
  tmux('set-option', '-t', state.session, 'history-limit', '20000')
  const serverPid = Number(tmux('display-message', '-p', '-t', state.session, '#{pid}').trim())
  state.server = identity(serverPid)
  state.ownedProcesses = descendants([state.server])
  save(state)
  console.log(`TTY ready; scratch=${state.scratch}; proof=${proof}`)
} else {
  state = JSON.parse(readFileSync(manifest))
  assert.equal(state.root, realpathSync(root), 'Manifest belongs to another checkout')
  if (action !== 'cleanup') assert(!state.cleaned, 'This run was cleaned; launch a new run')

  if (action === 'doctor') {
    assert.equal(hash(), state.bundleHash, 'Bundle changed; launch a fresh run after rebuilding')
    assert.equal(process.versions.node.split('.')[0], '26')
    tmux('has-session', '-t', state.session)
    const cwd = tmux('display-message', '-p', '-t', state.session, '#{pane_current_path}').trim()
    assert.equal(cwd, project(), 'TTY is not in this run’s project directory')
    const version = run(process.execPath, [bundle, '--version']).stdout.trim()
    assert(version.includes(state.version), 'CLI version does not match the launch build')
    const docker = run('docker', ['--version']).stdout.trim()
    const compose = run('docker', ['compose', 'version']).stdout.trim()
    const daemon = state.dockerHost
      ? run('docker', ['info', '--format', '{{.ID}}']).stdout.trim()
      : 'not driven (configuration-only run)'
    console.log(
      JSON.stringify(
        {
          version,
          bundleHash: state.bundleHash,
          cwd,
          home: environment().HOME,
          tty: state.socket,
          docker,
          compose,
          daemon,
          auth: 'none; no Agent credentials loaded',
        },
        null,
        2,
      ),
    )
  } else if (action === 'project') {
    assert(!state.active, 'Finish the current command before switching projects')
    const name = label(args[0])
    assert(name.startsWith('verify-'), 'Scratch project names must start with verify-')
    const directory = join(state.scratch, name)
    if (!state.projects.includes(name)) {
      mkdirSync(directory)
      writeFileSync(join(directory, 'user-file.txt'), 'verification-owned project\n')
      state.projects.push(name)
    }
    state.projectName = name
    save(state)
    tmux(
      'respawn-pane',
      '-k',
      '-t',
      `${state.session}:0`,
      '-c',
      directory,
      'bash --noprofile --norc',
    )
    state.ownedProcesses = descendants(state.ownedProcesses)
    save(state)
    console.log(directory)
  } else if (action === 'open') {
    const [entry, command, ...options] = args
    label(entry)
    assert(!state.active, 'finish the active command before opening another')
    assert(
      ['init', 'config', 'build', 'up', 'down', 'stop', 'sh', 'rm', '--help', '--version'].includes(
        command,
      ),
      'Unsupported user command',
    )
    if (['build', 'up', 'down', 'stop', 'sh', 'rm'].includes(command))
      assert(
        state.dockerHost,
        'Use launch docker with a disposable daemon; HOME alone does not isolate Docker resources',
      )
    assert(!existsSync(join(proof, `${entry}.command.json`)), 'Use a new action label')
    const cli = [process.execPath, bundle, command, ...options]
    writeFileSync(
      join(proof, `${entry}.command.json`),
      `${JSON.stringify({ cwd: project(), argv: cli, featureEntry: entry }, null, 2)}\n`,
    )
    const runner = fileURLToPath(new URL('./command.mjs', import.meta.url))
    const invocation = [process.execPath, runner, proof, entry, ...cli].map(quote).join(' ')
    // 先建立保留 dead pane 的獨立 window，再啟動命令，避免短命令競態。
    const commandPane = tmux(
      'new-window',
      '-d',
      '-P',
      '-F',
      '#{pane_id}',
      '-t',
      state.session,
      '-n',
      entry,
      '-c',
      project(),
      'sleep 2147483647',
    ).trim()
    tmux('set-option', '-p', '-t', commandPane, 'remain-on-exit', 'on')
    state.commands[entry] = { pane: commandPane }
    state.active = entry
    save(state)
    tmux('respawn-pane', '-k', '-t', commandPane, '-c', project(), `exec ${invocation}`)
    state.ownedProcesses = descendants(state.ownedProcesses)
    save(state)
  } else if (action === 'wait') {
    assert(state.active, 'No active command')
    assert(args[0], 'Supply the literal prompt text')
    await waitFor(
      () => {
        assert(!commandExited(), `Command ${state.active} has ended; no active prompt`)
        const prompt = currentPrompt(pane())
        if (!prompt.includes(args[0])) return false
        assert(!commandExited(), `Command ${state.active} has ended; no active prompt`)
        return true
      },
      args[0],
      args[1] === undefined ? 30 : Number(args[1]),
    )
    console.log(pane())
  } else if (action === 'send' || action === 'text') {
    assert(state.active, 'No active command')
    assert(args.length, 'Supply keys or literal text')
    assert(!commandExited(), 'Command has ended')
    tmux('send-keys', '-t', target(), ...(action === 'text' ? ['-l', args.join(' ')] : args))
  } else if (action === 'finish') {
    const entry = label(args[0])
    assert.equal(entry, state.active)
    const exitFile = join(proof, `${entry}.exit`)
    const signalFile = join(proof, `${entry}.signal`)
    const errorFile = join(proof, `${entry}.runner-error.txt`)
    await waitFor(
      () => commandExited() || existsSync(signalFile) || existsSync(errorFile),
      `${entry} to exit`,
      args[1] === undefined ? 300 : Number(args[1]),
    )
    capture(join(proof, `${entry}.pane.txt`))
    state.active = null
    save(state)
    if (existsSync(exitFile)) {
      const code = readFileSync(exitFile, 'utf8').trim()
      console.log(`exit=${code}\n${readFileSync(join(proof, `${entry}.terminal`), 'utf8')}`)
      process.exitCode = Number(code)
    } else {
      const reason = existsSync(signalFile)
        ? `script signal ${readFileSync(signalFile, 'utf8').trim()}`
        : existsSync(errorFile)
          ? `runner error: ${readFileSync(errorFile, 'utf8').trim()}`
          : 'command pane ended'
      const result = { entry, failed: true, reason, cliExitCode: null }
      writeFileSync(
        join(proof, `${entry}.finish-error.json`),
        `${JSON.stringify(result, null, 2)}\n`,
      )
      console.error(`Command ${entry} ended without a CLI exit code: ${reason}; evidence retained`)
      process.exitCode = 1
    }
  } else if (action === 'snapshot') {
    const destination = join(proof, label(args[0]))
    assert(!existsSync(destination), 'Use a new snapshot label')
    mkdirSync(destination)
    for (const name of ['config.yaml', 'projects.yaml']) {
      if (existsSync(join(data(), name))) cpSync(join(data(), name), join(destination, name))
    }
    const registry = existsSync(join(data(), 'projects.yaml'))
      ? parse(readFileSync(join(data(), 'projects.yaml'), 'utf8'))
      : { projects: {} }
    const registration = registry.projects[project()]
    if (registration) {
      assert.equal(basename(registration.identity), registration.identity)
      for (const name of ['config.yaml', 'compose.yaml']) {
        cpSync(
          join(data(), 'projects', registration.identity, name),
          join(destination, `project-${name}`),
        )
      }
    }
    writeFileSync(
      join(destination, 'project-files.json'),
      `${JSON.stringify(readdirSync(project()).sort(), null, 2)}\n`,
    )
    writeFileSync(
      join(destination, 'user-file.txt'),
      readFileSync(join(project(), 'user-file.txt')),
    )
    console.log(destination)
  } else if (action === 'check-init') {
    const snapshot = join(proof, 'after-init')
    const yaml = name => parse(readFileSync(join(snapshot, name), 'utf8'))
    const global = yaml('config.yaml')
    const local = yaml('project-config.yaml')
    const registry = yaml('projects.yaml')
    const compose = yaml('project-compose.yaml')
    assert.deepEqual(global, { version: 1, node: ['24'], agent: [], agent_notifications: false })
    assert.deepEqual(local, { version: 1, node: '24', ports: ['VERIFY_PORT:5173:5173'] })
    assert(registry.projects[project()], 'Missing project registration')
    assert.equal(compose['x-devbox'].project_root, project())
    assert.equal(compose.name, `devbox-${state.projectName}`)
    assert.equal(compose.services.devbox.environment.NODE_VERSION, '24')
    assert.deepEqual(compose.services.devbox.ports, ['${VERIFY_PORT:-5173}:5173'])
    assert(
      compose.services.devbox.volumes.some(
        volume => volume.type === 'bind' && volume.source === project(),
      ),
    )
    assert.deepEqual(JSON.parse(readFileSync(join(snapshot, 'project-files.json'))), [
      'user-file.txt',
    ])
    assert.equal(
      readFileSync(join(snapshot, 'user-file.txt'), 'utf8'),
      'verification-owned project\n',
    )
    assert(!existsSync(join(proof, 'before-init', 'projects.yaml')))
    assert.equal(readFileSync(join(proof, 'init-save.exit'), 'utf8').trim(), '0')
    const result = {
      feature: 'init-save',
      passed: true,
      checks: [
        'global',
        'local',
        'registration',
        'compose-runtime-port-bind',
        'project-unchanged',
        'exit-zero',
      ],
    }
    writeFileSync(join(proof, 'init-save.verdict.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result))
  } else if (action === 'cleanup') {
    const report = {
      started: new Date().toISOString(),
      phases: [],
      errors: [],
      forced: [],
      cleaned: false,
    }
    const attempt = async (phase, operation) => {
      try {
        await operation()
        report.phases.push({ phase, ok: true })
      } catch (error) {
        report.phases.push({ phase, ok: false })
        report.errors.push(`${phase}: ${error.message}`)
      }
    }
    const refresh = () => {
      let owned = state.ownedProcesses ?? []
      for (const entry of Object.keys(state.commands ?? {})) {
        const path = join(proof, `${entry}.processes.json`)
        if (existsSync(path)) owned.push(...JSON.parse(readFileSync(path, 'utf8')))
      }
      state.ownedProcesses = descendants(owned)
      save(state)
      return state.ownedProcesses.filter(living)
    }
    const settle = async seconds => {
      const deadline = Date.now() + seconds * 1000
      while (refresh().length && Date.now() < deadline) await pause()
      return refresh()
    }
    if (!state.cleaned) {
      await attempt('capture-and-interrupt', async () => {
        if (!state.active) return
        capture(join(proof, `${state.active}.cleanup-pane.txt`))
        refresh()
        if (!commandExited()) tmux('send-keys', '-t', target(), 'C-c')
        const deadline = Date.now() + 2000
        while (!commandExited() && Date.now() < deadline) await pause()
      })
      await attempt('stop-owned-processes', async () => {
        refresh()
        // 先關閉本 run 的 TTY server；後續完全以持久化程序身分重試。
        if (state.server && living(state.server)) {
          assert(sameProcess(state.server), 'TTY server identity changed')
          run('tmux', ['-L', state.socket, 'kill-server'], false)
        }
        for (const signal of ['SIGTERM', 'SIGKILL']) {
          const live = refresh()
          for (const owned of live.reverse()) {
            if (!living(owned)) continue
            try {
              process.kill(owned.pid, signal)
              report.forced.push({ pid: owned.pid, start: owned.start, signal })
            } catch (error) {
              if (error.code !== 'ESRCH')
                report.forced.push({
                  pid: owned.pid,
                  start: owned.start,
                  signal,
                  error: error.message,
                })
            }
          }
          if (!(await settle(2)).length) break
        }
        assert.equal(refresh().length, 0, 'Owned processes remain alive')
        assert.notEqual(
          run('tmux', ['-L', state.socket, 'has-session', '-t', state.session], false).status,
          0,
          'TTY still exists',
        )
        state.active = null
        save(state)
      })
      await attempt('docker-down-and-confirm', async () => {
        if (!state.dockerHost) return
        const directory = join(data(), 'projects')
        const failures = []
        for (const entry of existsSync(directory) ? readdirSync(directory) : []) {
          try {
            const compose = join(directory, entry, 'compose.yaml')
            if (!existsSync(compose)) continue
            const definition = parse(readFileSync(compose, 'utf8'))
            const ownedName = basename(definition['x-devbox'].project_root)
            assert(state.projects.includes(ownedName), 'Refusing to clean a foreign project')
            assert.equal(definition['x-devbox'].project_root, join(state.scratch, ownedName))
            assert.equal(
              definition.name,
              `devbox-${ownedName}`,
              'Refusing to clean a foreign Compose stack',
            )
            const down = run('docker', ['compose', '--file', compose, 'down'], false)
            const containers = run(
              'docker',
              ['ps', '-aq', '--filter', `label=com.docker.compose.project=${definition.name}`],
              false,
            )
            const networks = run(
              'docker',
              [
                'network',
                'ls',
                '-q',
                '--filter',
                `label=com.docker.compose.project=${definition.name}`,
              ],
              false,
            )
            const log = [down, containers, networks]
              .map(result => `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ?? ''}`)
              .join('\n')
            writeFileSync(join(proof, `cleanup-docker-${entry}-${Date.now()}.txt`), log)
            assert.equal(down.status, 0, `Docker down failed for ${entry}`)
            assert.equal(containers.status, 0, 'Cannot confirm containers removed')
            assert.equal(networks.status, 0, 'Cannot confirm networks removed')
            assert.equal(containers.stdout.trim(), '', 'Owned containers remain')
            assert.equal(networks.stdout.trim(), '', 'Owned networks remain')
          } catch (error) {
            failures.push(error.message)
          }
        }
        // 即使尚未產生 Compose，也必須確認本次 daemon 可讀，不能假稱清理成功。
        const info = run('docker', ['info', '--format', '{{.ID}}'], false)
        writeFileSync(
          join(proof, `cleanup-daemon-${Date.now()}.txt`),
          `${info.stdout ?? ''}${info.stderr ?? ''}${info.error ?? ''}`,
        )
        if (info.status !== 0) failures.push('Cannot read Docker daemon')
        assert.equal(failures.length, 0, failures.join('\n'))
      })
      await attempt('remove-scratch', async () => {
        assert.equal(report.errors.length, 0, 'Retaining scratch for cleanup retry')
        assert.equal(refresh().length, 0, 'Cannot confirm owned processes stopped')
        assert(state.scratch.startsWith(join(tmpdir(), 'devbox-verify-')))
        rmSync(state.scratch, { recursive: true, force: true })
        state.cleaned = true
        save(state)
      })
    }
    report.cleaned = state.cleaned
    report.finished = new Date().toISOString()
    const content = `${JSON.stringify(report, null, 2)}\n`
    writeFileSync(join(proof, `cleanup-${Date.now()}.json`), content)
    writeFileSync(join(proof, 'cleanup-report.json'), content)
    console.log(content)
    process.exitCode = state.cleaned ? 0 : 1
  } else {
    throw new Error(`Unknown action: ${action}`)
  }
}
