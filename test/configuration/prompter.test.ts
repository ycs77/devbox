import { Readable, Writable } from 'node:stream'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  confirm,
  editGlobal,
  editLocal,
  selectConfigurationScope,
  selectNodeReplacement,
} from '../../src/configuration/prompter.js'
import { InterruptedError } from '../../src/result.js'

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

describe('configuration interaction', () => {
  it('allows Global selections to be cleared', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const editing = editGlobal(
      { version: 1, node: ['24'], agent: ['codex'], agent_notifications: true },
      { runtimes: { node: ['24', '22'] }, agents: ['codex'] },
      options,
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
    const rendered = output.chunks.join('')
    expect(rendered).toContain('Workspace Docker image')
    expect(rendered).not.toContain(
      'Add runtimes and agents to the shared image. They are available to every project and increase the image size.',
    )
  })

  it('selects the Global configuration scope', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const selection = selectConfigurationScope(options)

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })

    await expect(selection).resolves.toBe('global')
    expect(output.chunks.join('')).toContain('Current project')
    expect(output.chunks.join('')).toContain('Workspace Docker image')
  })

  it('selects the configured Node Runtime for Local configuration', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const editing = editLocal(
      { version: 1, node: null, ports: [] },
      { version: 1, node: ['24'], agent: [], agent_notifications: true },
      options,
    )

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })
    await new Promise<void>(resolve => setImmediate(resolve))
    input.emit('keypress', '', { name: 'return' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({ version: 1, node: '24', ports: [] })
  })

  it('explains how to enter and submit multiline port mappings', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const editing = editLocal(
      { version: 1, node: null, ports: [] },
      { version: 1, node: ['24'], agent: [], agent_notifications: true },
      options,
    )

    input.emit('keypress', '', { name: 'return' })
    await waitForImmediate()
    const rendered = stripVTControlCharacters(output.chunks.join('')).replace(/\s+/g, ' ')

    input.emit('keypress', '', { name: 'return' })
    input.emit('keypress', '', { name: 'return' })
    await editing

    expect(rendered).toContain('one mapping per line')
    expect(rendered).toContain('press Enter twice to submit')
  })

  it('prepopulates Local ports in the multiline editor', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const editing = editLocal(
      { version: 1, node: null, ports: ['APP_PORT:5173:5173'] },
      { version: 1, node: ['24'], agent: [], agent_notifications: true },
      options,
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
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const editing = selectNodeReplacement(
      { version: 1, node: '24', ports: ['APP_PORT:5173:5173'] },
      { version: 1, node: ['22'], agent: [], agent_notifications: true },
      options,
    )

    input.emit('keypress', '', { name: 'down' })
    input.emit('keypress', '', { name: 'return' })

    await expect(editing).resolves.toEqual({
      version: 1,
      node: '22',
      ports: ['APP_PORT:5173:5173'],
    })
  })

  it('renders confirmation details before asking for approval', async () => {
    const input = new PromptInput()
    const output = new PromptOutput()
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const confirmation = confirm(
      'Save Project configuration?',
      {
        title: 'Review configuration',
        sections: [
          {
            title: 'Project: /workspace/example',
            current: 'node 24',
            next: 'node 22',
          },
        ],
      },
      options,
    )

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
    const options = {
      signal: new AbortController().signal,
      input,
      output,
    }
    const confirmation = confirm('Continue?', undefined, options)

    input.emit('keypress', '', { name: 'escape' })

    await expect(confirmation).rejects.toBeInstanceOf(InterruptedError)
  })

  it('keeps concurrent confirmations and their cancellation isolated by I/O', async () => {
    const firstInput = new PromptInput()
    const firstOutput = new PromptOutput()
    const firstController = new AbortController()
    const secondInput = new PromptInput()
    const secondOutput = new PromptOutput()
    const first = confirm('Save first Project?', undefined, {
      signal: firstController.signal,
      input: firstInput,
      output: firstOutput,
    })
    const second = confirm('Save second Project?', undefined, {
      signal: new AbortController().signal,
      input: secondInput,
      output: secondOutput,
    })
    const interrupted = expect(first).rejects.toBeInstanceOf(InterruptedError)

    firstController.abort()
    await interrupted
    secondInput.emit('keypress', '', { name: 'right' })
    secondInput.emit('keypress', '', { name: 'return' })

    await expect(second).resolves.toBe(false)
    expect(firstOutput.chunks.join('')).toContain('Save first Project?')
    expect(firstOutput.chunks.join('')).not.toContain('Save second Project?')
    expect(secondOutput.chunks.join('')).toContain('Save second Project?')
    expect(secondOutput.chunks.join('')).not.toContain('Save first Project?')
  })
})
