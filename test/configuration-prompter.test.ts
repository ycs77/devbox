import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createConfigurationPrompter } from '../src/configuration-prompter.js'
import { InterruptedError } from '../src/project.js'

class PromptInput extends Readable {
  _read(): void {}
}

class PromptOutput extends Writable {
  readonly chunks: string[] = []
  readonly columns = 80
  readonly isTTY = false

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString())
    callback()
  }
}

describe('createConfigurationPrompter', () => {
  it('allows Global selections to be cleared', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const editing = prompt.editGlobal!(
      { version: 1, runtimes: { node: ['24'] }, agents: ['codex'] },
      { runtimes: { node: ['24', '22'] }, agents: ['codex'] },
    )

    input.emit('keypress', '', { name: 'space' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'space' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      runtimes: { node: [] },
      agents: [],
    })
  })

  it('validates Local ports before returning the configuration', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const editing = prompt.editLocal!(
      { version: 1, toolchain: { node: null }, ports: [] },
      { runtimes: { node: ['24', '22'] }, agents: [] },
      { version: 1, runtimes: { node: ['24'] }, agents: [] },
    )

    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '1', { name: '1' })
    input.emit('keypress', '', { name: 'return' })
    input.emit('keypress', ':', { name: ':' })
    input.emit('keypress', '1', { name: '1' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      toolchain: { node: null },
      ports: [{ host: 1, container: 1 }],
    })
    expect(output.chunks.join('')).toContain(
      'Enter host:container pairs with ports from 1 to 65535.',
    )
  })

  it('renders confirmation details before asking for approval', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const confirmation = prompt.confirm('Save Local configuration?', {
      title: 'Local configuration changes',
      content: 'Current: node 24\nNext: node 22',
    })

    input.emit('keypress', '', { name: 'return' })

    await expect(confirmation).resolves.toBe(true)
    expect(output.chunks.join('')).toContain('Local configuration changes')
    expect(output.chunks.join('')).toContain('Current: node 24')
  })

  it('maps prompt cancellation to command interruption', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const confirmation = prompt.confirm('Continue?')

    input.emit('keypress', '', { name: 'escape' })

    await expect(confirmation).rejects.toBeInstanceOf(InterruptedError)
  })
})
