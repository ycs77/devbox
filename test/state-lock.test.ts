import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { success } from '../src/result.js'
import { StateLockInterruptedError, withStateLocks } from '../src/state-lock.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'devbox-lock-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('withStateLocks', () => {
  it('holds Global and Project markers under the configured Devbox home and releases them', async () => {
    const devboxHome = await temporaryDirectory()
    const firstProject = join(devboxHome, 'projects', 'z-project')
    const secondProject = join(devboxHome, 'projects', 'a-project')
    const entered = deferred()
    const release = deferred()

    const running = withStateLocks(
      {
        devboxHome,
        global: true,
        projectRoots: [firstProject, secondProject],
      },
      async () => {
        entered.resolve()
        await release.promise
        return success('complete')
      },
    )

    await entered.promise
    expect(await readdir(join(devboxHome, 'locks'))).toHaveLength(3)

    release.resolve()
    await expect(running).resolves.toEqual({ ok: true, value: 'complete' })
    await expect(readdir(join(devboxHome, 'locks'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns an immediate typed failure identifying a busy Global scope', async () => {
    const devboxHome = await temporaryDirectory()
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () => {
      entered.resolve()
      await release.promise
      return success(undefined)
    })
    await entered.promise

    const busy = await withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () =>
      success('should not run'),
    )
    expect(busy).toMatchObject({
      ok: false,
      error: {
        kind: 'operational',
        code: 'command-lock-busy',
      },
    })
    if (busy.ok === false) {
      expect(busy.error.observed).toContain('Global')
      expect(busy.error.nextAction).toContain('no Devbox process')
    }

    release.resolve()
    await running
  })

  it('does not block an unrelated Project scope when Global is omitted', async () => {
    const devboxHome = await temporaryDirectory()
    const firstProject = join(devboxHome, 'projects', 'first')
    const secondProject = join(devboxHome, 'projects', 'second')
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks(
      { devboxHome, global: false, projectRoots: [firstProject] },
      async () => {
        entered.resolve()
        await release.promise
        return success(undefined)
      },
    )
    await entered.promise

    await expect(
      withStateLocks({ devboxHome, global: false, projectRoots: [secondProject] }, async () =>
        success('unrelated project ran'),
      ),
    ).resolves.toEqual({ ok: true, value: 'unrelated project ran' })

    release.resolve()
    await running
  })

  it('releases acquired markers when a later Project scope is busy', async () => {
    const devboxHome = await temporaryDirectory()
    const projectRoot = join(devboxHome, 'projects', 'busy')
    const entered = deferred()
    const release = deferred()
    const running = withStateLocks(
      { devboxHome, global: false, projectRoots: [projectRoot] },
      async () => {
        entered.resolve()
        await release.promise
        return success(undefined)
      },
    )
    await entered.promise

    const busy = await withStateLocks(
      { devboxHome, global: true, projectRoots: [projectRoot] },
      async () => success('should not run'),
    )

    expect(busy).toMatchObject({
      ok: false,
      error: { kind: 'operational', code: 'command-lock-busy' },
    })
    await expect(
      withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () =>
        success('Global marker was rolled back'),
      ),
    ).resolves.toEqual({ ok: true, value: 'Global marker was rolled back' })

    release.resolve()
    await running
  })

  it('releases markers when the protected operation throws', async () => {
    const devboxHome = await temporaryDirectory()

    await expect(
      withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () => {
        throw new Error('operation failed')
      }),
    ).rejects.toThrow('operation failed')

    await expect(
      withStateLocks({ devboxHome, global: true, projectRoots: [] }, async () =>
        success('retryable'),
      ),
    ).resolves.toEqual({ ok: true, value: 'retryable' })
  })

  it('throws interruption before acquiring a marker when cancellation is already requested', async () => {
    const devboxHome = await temporaryDirectory()
    const controller = new AbortController()
    controller.abort()

    await expect(
      withStateLocks(
        { devboxHome, global: true, projectRoots: [], signal: controller.signal },
        async () => success('should not run'),
      ),
    ).rejects.toBeInstanceOf(StateLockInterruptedError)
  })
})
