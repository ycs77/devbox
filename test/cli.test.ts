import { describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'
import { failure, success } from '../src/result.js'

function terminalOutput() {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    output: {
      stdout: { write: (message: string) => stdout.push(message) },
      stderr: { write: (message: string) => stderr.push(message) },
    },
    stdout,
    stderr,
  }
}

describe('main', () => {
  it('registers a Project and presents the result', async () => {
    const output = terminalOutput()

    const status = await main(
      ['init'],
      {
        isInteractive: () => true,
        initializeProject: async () =>
          success({
            root: '/workspace/non-git-project',
            stateDirectory: '/home/user/.devbox/projects/workspace/non-git-project',
            created: true,
          }),
      },
      output.output,
    )

    expect(status).toBe(0)
    expect(output.stdout).toEqual(['Registered Project: /workspace/non-git-project\n'])
    expect(output.stderr).toEqual([])
  })

  it('shows CAC help for the root and init commands', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const output = terminalOutput()

    expect(await main([], undefined, output.output)).toBe(0)
    expect(await main(['init', '--help'], undefined, output.output)).toBe(0)

    expect(info).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Usage:\n  $ devbox <command> [options]'),
    )
    expect(info).toHaveBeenNthCalledWith(2, expect.stringContaining('Usage:\n  $ devbox init'))
    expect(output.stdout).toEqual([])
    expect(output.stderr).toEqual([])
  })

  it('rejects an unknown command before running init', async () => {
    let initialized = false
    const output = terminalOutput()

    const status = await main(
      ['unknown'],
      {
        initializeProject: async () => {
          initialized = true
          return success({
            root: '/workspace/non-git-project',
            stateDirectory: '/home/user/.devbox/projects/workspace/non-git-project',
            created: true,
          })
        },
      },
      output.output,
    )

    expect(status).toBe(1)
    expect(initialized).toBe(false)
    expect(output.stdout).toEqual([])
    expect(output.stderr).toEqual(['Unused args: `unknown`\n'])
  })

  it('presents an operation failure', async () => {
    const output = terminalOutput()

    const status = await main(
      ['init'],
      {
        isInteractive: () => true,
        initializeProject: async () =>
          failure({
            kind: 'validation',
            code: 'unsupported-host',
            observed: 'Devbox supports only WSL2 linux/amd64.',
            nextAction: 'Run Devbox from WSL2.',
          }),
      },
      output.output,
    )

    expect(status).toBe(1)
    expect(output.stdout).toEqual([])
    expect(output.stderr).toEqual([
      'Devbox supports only WSL2 linux/amd64.\nRun Devbox from WSL2.\n',
    ])
  })

  it('rejects interactive-only init outside a TTY before running the operation', async () => {
    let initialized = false
    const output = terminalOutput()

    const status = await main(
      ['init'],
      {
        isInteractive: () => false,
        initializeProject: async () => {
          initialized = true
          return success({
            root: '/workspace/non-git-project',
            stateDirectory: '/home/user/.devbox/projects/workspace/non-git-project',
            created: true,
          })
        },
      },
      output.output,
    )

    expect(status).toBe(2)
    expect(initialized).toBe(false)
    expect(output.stdout).toEqual([])
    expect(output.stderr[0]).toContain('requires an interactive terminal')
  })

  it('dispatches config -g without invoking Local configuration', async () => {
    let localCalled = false
    const output = terminalOutput()

    const status = await main(
      ['config', '-g'],
      {
        isInteractive: () => true,
        prompt: { confirm: async () => true },
        configureGlobal: async () => success({ scope: 'global', changed: true }),
        configureLocalProject: async () => {
          localCalled = true
          return success({ scope: 'local', root: '/workspace/project', changed: true })
        },
      },
      output.output,
    )

    expect(status).toBe(0)
    expect(localCalled).toBe(false)
    expect(output.stdout).toEqual(['Global configuration updated.\n'])
  })

  it('dispatches update and presents the Platform lock status', async () => {
    const output = terminalOutput()

    const status = await main(
      ['update'],
      {
        isInteractive: () => false,
        updatePlatform: async () =>
          success({
            changed: true,
            lockPath: '/home/user/.devbox/platform-lock.yaml',
            runtimes: { node: ['24'] },
          }),
      },
      output.output,
    )

    expect(status).toBe(0)
    expect(output.stdout).toEqual(['Platform lock updated.\n'])
    expect(output.stderr).toEqual([])
  })

  it('presents an unchanged Platform lock status', async () => {
    const output = terminalOutput()

    const status = await main(
      ['update'],
      {
        updatePlatform: async () =>
          success({
            changed: false,
            lockPath: '/home/user/.devbox/platform-lock.yaml',
            runtimes: { node: ['24'] },
          }),
      },
      output.output,
    )

    expect(status).toBe(0)
    expect(output.stdout).toEqual(['Platform lock is up to date.\n'])
    expect(output.stderr).toEqual([])
  })

  it('presents an update failure with a nonzero status', async () => {
    const output = terminalOutput()

    const status = await main(
      ['update'],
      {
        updatePlatform: async () =>
          failure({
            kind: 'operational',
            code: 'base-resolution-failed',
            observed: 'The official Ubuntu Base input could not be resolved.',
            nextAction: 'Check network access and run devbox update again.',
          }),
      },
      output.output,
    )

    expect(status).toBe(1)
    expect(output.stdout).toEqual([])
    expect(output.stderr).toEqual([
      'The official Ubuntu Base input could not be resolved.\nCheck network access and run devbox update again.\n',
    ])
  })

  it('requires --yes for rm and cleanup outside a TTY', async () => {
    const output = terminalOutput()

    expect(await main(['rm'], { isInteractive: () => false }, output.output)).toBe(2)
    expect(
      await main(['cleanup', '--missing-projects'], { isInteractive: () => false }, output.output),
    ).toBe(2)
    expect(output.stderr).toHaveLength(2)
  })
})
