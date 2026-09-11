import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createConfigurationPrompter } from '../../src/configuration/prompter.js'
import { InterruptedError } from '../../src/project/index.js'

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
      { version: 1, node: ['24'], agent: ['codex'], agent_notifications: true },
      { runtimes: { node: ['24', '22'] }, agents: ['codex'] },
    )

    input.emit('keypress', '', { name: 'space' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'space' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      node: [],
      agent: [],
      agent_notifications: true,
    })
    expect(output.chunks.join('')).toContain('Workspace Docker image')
  })

  it('selects the Global configuration scope', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const selection = prompt.selectConfigurationScope()

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })

    await expect(selection).resolves.toBe('global')
    expect(output.chunks.join('')).toContain('Current project')
    expect(output.chunks.join('')).toContain('Workspace Docker image')
  })

  it('selects the configured Node Runtime for Local configuration', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const editing = prompt.editLocal!(
      { version: 1, node: null, ports: [] },
      { runtimes: { node: ['24', '22'] }, agents: [] },
      { version: 1, node: ['24'], agent: [], agent_notifications: true },
    )

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'return' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({ version: 1, node: '24', ports: [] })
    expect(output.chunks.join('')).toContain('Project configuration')
  })

  it('prepopulates Local ports in the multiline editor', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const editing = prompt.editLocal!(
      { version: 1, node: null, ports: ['APP_PORT:5173:5173'] },
      { runtimes: { node: ['24', '22'] }, agents: [] },
      { version: 1, node: ['24'], agent: [], agent_notifications: true },
    )

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'return' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      node: '24',
      ports: ['APP_PORT:5173:5173'],
    })
    expect(output.chunks.join('')).toContain('Published ports')
  })

  it('preserves Local ports while selecting a Global Node replacement', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const editing = prompt.editLocal!(
      { version: 1, node: '24', ports: ['APP_PORT:5173:5173'] },
      { runtimes: { node: ['24', '22'] }, agents: [] },
      { version: 1, node: ['22'], agent: [], agent_notifications: true },
      false,
    )

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      node: '22',
      ports: ['APP_PORT:5173:5173'],
    })
    expect(output.chunks.join('')).toContain('container starts')
  })

  it('renders confirmation details before asking for approval', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const prompt = createConfigurationPrompter({
      signal: new AbortController().signal,
      input,
      output,
    })
    const confirmation = prompt.confirm('Save Project configuration?', {
      title: 'Review configuration',
      sections: [
        {
          title: 'Project: /workspace/example',
          current: 'node 24',
          next: 'node 22',
        },
      ],
    })

    input.emit('keypress', '', { name: 'return' })

    await expect(confirmation).resolves.toBe(true)
    expect(output.chunks.join('')).toContain('Review configuration')
    expect(output.chunks.join('')).toContain('Project: /workspace/example')
    expect(output.chunks.join('')).toContain('Current')
    expect(output.chunks.join('')).toContain('New')
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
