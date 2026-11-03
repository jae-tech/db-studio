import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentPayload, AgentStatus } from '@shared/agent'
import type { AgentAdapter, AgentTurn } from '@main/agent/AgentAdapter'
import { decodeEvent, JsonlDecoder } from '@main/agent/protocol'
import {
  agentEnvironment,
  findCodex,
  runProcess,
  type ProcessRunner,
  type RunOptions,
  type RunResult,
} from '@main/agent/process'
import { codexArguments, CodexAdapter, codexModels } from '@main/agent/codex'
import {
  CopilotAdapter,
  copilotArguments,
  copilotModels,
  decodeCopilotEvent,
  prepareCopilotHome,
} from '@main/agent/copilot'
import { AgentService } from '@main/agent/service'

const thread = randomUUID()
const response = [
  { type: 'thread.started', thread_id: thread },
  { type: 'turn.started' },
  {
    type: 'item.completed',
    item: { type: 'agent_message', text: '안녕 🌳 SELECT 42' },
  },
  { type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 4 } },
]
let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ai-db-agent-unit-'))
})
afterAll(async () => {
  const target = resolve(directory)
  if (
    target.startsWith(resolve(tmpdir())) &&
    basename(target).startsWith('ai-db-agent-unit-')
  )
    await rm(target, { recursive: true, force: true })
})

describe('bounded JSONL and provider normalization', () => {
  it('decodes UTF-8 across every byte split, CRLF, and final line without newline', () => {
    const bytes = Buffer.from(
      response.map((value) => JSON.stringify(value)).join('\r\n'),
    )
    for (let split = 0; split <= bytes.length; split++) {
      const events: AgentPayload[] = []
      const decoder = new JsonlDecoder((raw) =>
        events.push(...decodeEvent('codex', raw)),
      )
      decoder.push(bytes.subarray(0, split))
      decoder.push(bytes.subarray(split))
      decoder.finish()
      expect(events).toEqual([
        { type: 'session', sessionId: thread },
        { type: 'text', text: '안녕 🌳 SELECT 42' },
        { type: 'usage', inputTokens: 12, outputTokens: 4 },
        { type: 'done', outcome: 'completed' },
      ])
    }
  })
  it('rejects malformed, oversized and unknown records', () => {
    expect(() =>
      new JsonlDecoder(() => {}).push(Buffer.from('bad\n')),
    ).toThrow()
    expect(() =>
      new JsonlDecoder(() => {}).push(Buffer.alloc(262_145, 65)),
    ).toThrow()
    const parser = new JsonlDecoder(() => {})
    expect(() => parser.push(Buffer.alloc(1_048_577))).toThrow()
    expect(() => decodeEvent('codex', { type: 'new.event' })).toThrow()
    expect(() =>
      decodeEvent('codex', { type: 'thread.started', thread_id: '../session' }),
    ).toThrow()
    expect(() =>
      decodeEvent('codex', {
        type: 'turn.completed',
        usage: { input_tokens: -1, output_tokens: 2 },
      }),
    ).toThrow()
    expect(() =>
      new JsonlDecoder(() => {}).push(Buffer.from('{}\n'.repeat(2049))),
    ).toThrow('event count')
  })
  it('accepts only the known disabled Code Mode startup notice, not arbitrary CLI errors', () => {
    expect(
      decodeEvent('codex', {
        type: 'item.completed',
        item: {
          type: 'error',
          message:
            'Code Mode is unavailable because code_mode_host is disabled. Code mode requires a host.',
        },
      }),
    ).toEqual([])
    expect(
      decodeEvent('codex', {
        type: 'item.completed',
        item: { type: 'error', message: '401 Unauthorized private-value' },
      }),
    ).toEqual([
      {
        type: 'error',
        code: 'auth',
        message:
          'CLI reported an error. Check authentication and subscription usage in the official CLI.',
      },
    ])
  })
  it.each([
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'web_search',
    'future_tool',
  ])('rejects unexpected %s tool events', (type) => {
    expect(() =>
      decodeEvent('codex', {
        type: 'item.started',
        item: { type, command: 'sensitive' },
      }),
    ).toThrow()
  })
  it('normalizes Copilot JSONL, scoping tools to ai_db only', () => {
    const calls = new Map<string, string>()
    expect(
      decodeCopilotEvent(
        {
          type: 'assistant.message',
          data: {
            content: '',
            toolRequests: [
              { mcpServerName: 'ai_db', mcpToolName: 'db_list_tables' },
            ],
          },
        },
        calls,
        true,
      ),
    ).toEqual([])
    expect(
      decodeCopilotEvent(
        {
          type: 'tool.execution_start',
          data: {
            toolCallId: 't1',
            mcpServerName: 'ai_db',
            mcpToolName: 'db_list_tables',
            arguments: { secret: 'never forwarded' },
          },
        },
        calls,
        true,
      ),
    ).toEqual([{ type: 'tool', name: 'db_list_tables', status: 'started' }])
    expect(
      decodeCopilotEvent(
        {
          type: 'tool.execution_complete',
          data: { toolCallId: 't1', result: { content: 'rows?' } },
        },
        calls,
        true,
      ),
    ).toEqual([{ type: 'tool', name: 'db_list_tables', status: 'completed' }])
    expect(
      decodeCopilotEvent(
        { type: 'assistant.message', data: { content: 'Hello' } },
        calls,
        true,
      ),
    ).toEqual([{ type: 'text', text: 'Hello' }])
    expect(
      decodeCopilotEvent(
        { type: 'result', sessionId: thread, exitCode: 0 },
        calls,
        true,
      ),
    ).toEqual([
      { type: 'session', sessionId: thread },
      { type: 'done', outcome: 'completed' },
    ])
    // Another server, a built-in tool, or any tool without a DB scope is refused.
    for (const [data, allow] of [
      [{ mcpServerName: 'rea', mcpToolName: 'db_list_tables' }, true],
      [{ mcpServerName: undefined, toolName: 'powershell' }, true],
      [{ mcpServerName: 'ai_db', mcpToolName: 'db_list_tables' }, false],
    ] as const)
      expect(() =>
        decodeCopilotEvent(
          { type: 'tool.execution_start', data: { toolCallId: 'x', ...data } },
          new Map(),
          allow,
        ),
      ).toThrow()
    expect(() =>
      decodeCopilotEvent(
        { type: 'tool.execution_complete', data: { toolCallId: 'unknown' } },
        new Map(),
        true,
      ),
    ).toThrow()
  })
  it('decodes Copilot UTF-8 JSONL one byte at a time', () => {
    const events: AgentPayload[] = []
    const decoder = new JsonlDecoder((value) =>
      events.push(...decodeCopilotEvent(value, new Map(), false)),
    )
    const bytes = Buffer.from(
      JSON.stringify({
        type: 'assistant.message',
        data: { content: '한글 🌳' },
      }) + '\r\n',
    )
    for (const byte of bytes) decoder.push(Buffer.from([byte]))
    decoder.finish()
    expect(events).toEqual([{ type: 'text', text: '한글 🌳' }])
  })
  it.each([
    ['429 quota exceeded', 'limit'],
    ['unauthorized 401', 'auth'],
    ['process failed', 'process'],
  ])('redacts %s failures', (message, code) => {
    const events = decodeEvent('codex', {
      type: 'turn.failed',
      error: { message: `${message} secret-password` },
    })
    expect(events[0]).toMatchObject({ type: 'error', code })
    expect(JSON.stringify(events)).not.toContain('secret-password')
  })
})

function fakeRunner(stream = response, result: Partial<RunResult> = {}) {
  return vi.fn<ProcessRunner>(async (options) => {
    if (options.args[0] === '--version')
      return { code: 0, stdout: 'codex-cli 0.165.0\n', stderr: '' }
    if (options.args.includes('--help'))
      return {
        code: 0,
        stdout: '--ignore-user-config --ignore-rules',
        stderr: '',
      }
    if (options.args[0] === 'login')
      return { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }
    for (const value of stream)
      options.stdout?.(Buffer.from(JSON.stringify(value) + '\n'))
    return { code: 0, stdout: '', stderr: '', ...result }
  })
}
function adapter(
  runner: ProcessRunner = fakeRunner(),
  env: NodeJS.ProcessEnv = {},
) {
  return new CodexAdapter(directory, runner, async () => process.execPath, env)
}
const turn = () => ({
  prompt: 'Return only SELECT 42',
  signal: new AbortController().signal,
})

describe('CLI policy and adapter', () => {
  it.each(['0.164.0', '0.166.0'])(
    'fails closed for unverified CLI version %s',
    async (version) => {
      const runner = fakeRunner()
      runner.mockImplementationOnce(async () => ({
        code: 0,
        stdout: `codex-cli ${version}\n`,
        stderr: '',
      }))
      expect(await adapter(runner).detect()).toMatchObject({
        available: false,
        version,
      })
      expect(runner.mock.calls).toHaveLength(1)
    },
  )
  it('allows only fixed environment names, not keys, loaders, PATH or endpoints', () => {
    expect(
      agentEnvironment({
        HOME: 'home',
        SystemRoot: 'win',
        CODEX_HOME: 'auth-location',
        OPENAI_API_KEY: 'secret',
        ANTHROPIC_API_KEY: 'secret',
        OPENAI_BASE_URL: 'evil',
        NODE_OPTIONS: '--require evil',
        PATH: 'evil',
        DATABASE_PASSWORD: 'secret',
        OMX_MODE: 'active',
      }),
    ).toEqual({
      HOME: 'home',
      SystemRoot: 'win',
      CODEX_HOME: 'auth-location',
      NO_COLOR: '1',
    })
  })
  it('never resolves relative PATH entries or shell wrappers', async () => {
    expect(
      await findCodex({ PATH: '.', APPDATA: join(directory, 'missing') }),
    ).toBeUndefined()
  })
  it('uses stdin and fixed restrictive launch args for start and UUID resume', () => {
    const args = codexArguments(thread)
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('--ignore-rules')
    expect(args).toContain('forced_login_method="chatgpt"')
    expect(args).toContain('sandbox_mode="read-only"')
    expect(args).toContain('approval_policy="never"')
    expect(args).toContain('model_provider="openai"')
    expect(args).toContain('mcp_servers={}')
    expect(args).toContain('web_search="disabled"')
    expect(args.slice(-3)).toEqual(['resume', thread, '-'])
    for (const feature of [
      'shell_tool',
      'hooks',
      'plugins',
      'apps',
      'multi_agent',
    ]) {
      const index = args.indexOf(feature)
      expect(index).toBeGreaterThan(0)
      expect(args[index - 1]).toBe('--disable')
    }
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).not.toContain('--last')
  })
  it('inspects CLI auth, emits normalized stream and exactly one completion', async () => {
    const runner = fakeRunner()
    const subject = adapter(runner)
    const events: AgentPayload[] = []
    expect(await subject.detect()).toMatchObject({
      available: true,
      auth: 'subscription',
      version: '0.165.0',
    })
    await subject.start(turn(), (event) => events.push(event))
    expect(events.filter((event) => event.type === 'done')).toEqual([
      { type: 'done', outcome: 'completed' },
    ])
    expect(runner.mock.calls.at(-1)?.[0]).toMatchObject({
      input: 'Return only SELECT 42',
      cwd: directory,
      timeoutMs: 120_000,
    })
    expect(runner.mock.calls.at(-1)?.[0].args).not.toContain(
      'Return only SELECT 42',
    )
    await subject.resume({ ...turn(), sessionId: thread }, () => {})
    expect(runner.mock.calls.at(-1)?.[0].args.slice(-3)).toEqual([
      'resume',
      thread,
      '-',
    ])
    await subject.dispose()
  })
  it('rejects missing, unsupported or API-authenticated CLI without requests', async () => {
    const missing = new CodexAdapter(
      directory,
      fakeRunner(),
      async () => undefined,
      {},
    )
    expect(await missing.detect()).toMatchObject({
      installed: false,
      available: false,
    })
    const runner = fakeRunner()
    expect(
      await adapter(runner, { CODEX_API_KEY: 'do-not-emit' }).detect(),
    ).toMatchObject({ available: false, auth: 'api-key' })
    expect(runner).not.toHaveBeenCalled()
    runner.mockImplementationOnce(async () => ({
      code: 0,
      stdout: 'codex-cli 0.999.0',
      stderr: '',
    }))
    expect(await adapter(runner).detect()).toMatchObject({ available: false })
    const apiRunner: ProcessRunner = async (options) =>
      options.args[0] === 'login'
        ? { code: 0, stdout: '', stderr: 'Logged in using an API key: secret' }
        : fakeRunner()(options)
    expect(await adapter(apiRunner).detect()).toMatchObject({
      available: false,
      auth: 'api-key',
    })
  })
  it.each([
    { stream: response.slice(0, -1), result: {} },
    { stream: response, result: { code: 1 } },
    { stream: [...response, response[1]!], result: {} },
  ])(
    'does not treat incomplete/nonzero/extra output as success',
    async ({ stream, result }) => {
      const events: AgentPayload[] = []
      await adapter(fakeRunner(stream, result)).start(turn(), (event) =>
        events.push(event),
      )
      expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed' })
      expect(events.some((event) => event.type === 'error')).toBe(true)
    },
  )
  it('reports rate limits and never automatically retries', async () => {
    const runner = fakeRunner([
      { type: 'turn.failed', error: { message: '429 quota exceeded' } },
    ] as unknown as typeof response)
    const events: AgentPayload[] = []
    await adapter(runner).start(turn(), (event) => events.push(event))
    expect(events[0]).toMatchObject({ type: 'error', code: 'limit' })
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'failed' })
    expect(runner.mock.calls.filter(([options]) => options.input)).toHaveLength(
      1,
    )
  })
  it('normalizes a process timeout as failure, not cancellation', async () => {
    const runner: ProcessRunner = async (options) => {
      if (options.input) throw new Error('timeout')
      return fakeRunner()(options)
    }
    const events: AgentPayload[] = []
    await adapter(runner).start(turn(), (event) => events.push(event))
    expect(events).toEqual([
      {
        type: 'error',
        code: 'timeout',
        message:
          'CLI stopped: timeout, invalid stream or output limit. No automatic retry.',
      },
      { type: 'done', outcome: 'failed' },
    ])
  })
  it('refuses concurrent turns and cancels/disposes an active stream', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const runner: ProcessRunner = async (options) => {
      if (!options.input) return fakeRunner()(options)
      started()
      return new Promise((_, reject) =>
        options.signal!.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        ),
      )
    }
    const subject = adapter(runner)
    const events: AgentPayload[] = []
    const pending = subject.start(turn(), (event) => events.push(event))
    await ready
    await expect(subject.start(turn(), () => {})).rejects.toThrow('busy')
    await subject.dispose()
    await pending
    expect(events.at(-1)).toEqual({ type: 'done', outcome: 'cancelled' })
    await expect(subject.start(turn(), () => {})).rejects.toThrow()
  })
  it('cancels authentication probes before any prompt is sent', async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const runner = vi.fn<ProcessRunner>(async (options) => {
      started()
      return new Promise((_, reject) =>
        options.signal!.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true },
        ),
      )
    })
    const subject = adapter(runner)
    const events: AgentPayload[] = []
    const pending = subject.start(turn(), (event) => events.push(event))
    await ready
    subject.cancel()
    await pending
    expect(events).toEqual([{ type: 'done', outcome: 'cancelled' }])
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0]?.[0].input).toBeUndefined()
    await subject.dispose()
  })
  it('isolates Copilot: only ai_db tools, no user config, prompt on stdin', () => {
    const none = copilotArguments()
    expect(none).toEqual(
      expect.arrayContaining([
        '--no-custom-instructions',
        '--disable-builtin-mcps',
        '--no-ask-user',
        '--no-auto-update',
      ]),
    )
    // An empty --available-tools list would mean "no restriction".
    expect(none[none.indexOf('--available-tools') + 1]).toBe('ai_db-none')
    expect(none.join(' ')).not.toMatch(/--allow-all|--yolo|-p\b/)
    const launch = {
      executable: 'C:/node.exe',
      script: 'C:/mcp-stdio.js',
      environment: { AI_DB_MCP_TOKEN: 'secret-token' },
    }
    const args = copilotArguments(thread, launch, 'gpt-5')
    expect(args.join(' ')).not.toContain('secret-token')
    expect(args).toContain('ai_db-db_propose_sql')
    expect(args.slice(-4)).toEqual(['--model', 'gpt-5', '--resume', thread])
    const config = JSON.parse(
      args[args.indexOf('--additional-mcp-config') + 1]!,
    ) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(config.mcpServers)).toEqual(['ai_db'])
  })
  it('copies only Copilot account names into the app home and fails closed without a login', async () => {
    const user = join(directory, 'copilot-user')
    const home = join(directory, 'copilot-home')
    const { mkdir, writeFile, readFile } = await import('node:fs/promises')
    await mkdir(user, { recursive: true })
    expect(await prepareCopilotHome(home, user)).toBeUndefined()
    await writeFile(
      join(user, 'config.json'),
      `// managed\n${JSON.stringify({
        loggedInUsers: [
          { host: 'https://github.com', login: 'octo', kind: 'githubDotCom' },
        ],
        lastLoggedInUser: { host: 'https://github.com', login: 'octo' },
        installedPlugins: [{ name: 'should-not-copy' }],
        token: 'should-not-copy',
      })}`,
    )
    expect(await prepareCopilotHome(home, user)).toBe('octo')
    const copied = await readFile(join(home, 'config.json'), 'utf8')
    expect(copied).not.toContain('should-not-copy')
    const subject = new CopilotAdapter(
      directory,
      async () => ({ code: 0, stdout: '', stderr: '' }),
      async () => undefined,
    )
    expect(await subject.inspectAuth()).toMatchObject({
      provider: 'copilot',
      installed: false,
      available: false,
    })
    await subject.dispose()
  })
})

class StubAdapter implements AgentAdapter {
  turns: AgentTurn[] = []
  async detect(): Promise<AgentStatus> {
    return {
      provider: 'codex',
      installed: true,
      auth: 'subscription',
      available: true,
      reason: 'test double',
    }
  }
  inspectAuth() {
    return this.detect()
  }
  async start(value: AgentTurn, emit: (event: AgentPayload) => void) {
    this.turns.push(value)
    emit({ type: 'session', sessionId: thread })
    emit({ type: 'done', outcome: 'completed' })
  }
  resume(
    value: AgentTurn & { sessionId: string },
    emit: (event: AgentPayload) => void,
  ) {
    return this.start(value, emit)
  }
  cancel() {}
  async dispose() {}
}
describe('Main-owned sessions and request routing', () => {
  it('requires consent, closes every capability and starts a new session when database scope changes', async () => {
    const codex = new StubAdapter()
    const events: AgentEvent[] = []
    let generation = 'generation-1'
    const close = vi.fn(async () => {})
    const open = vi.fn(async () => ({
      key: generation,
      launch: {
        executable: process.execPath,
        script: 'fixture',
        environment: {},
      },
      close,
    }))
    const subject = new AgentService(
      { codex, copilot: new StubAdapter() },
      (event) => events.push(event),
      open,
    )
    const context = { connectionId: randomUUID(), shareSchema: true }
    const request = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
      context,
    }
    expect(() =>
      subject.start({
        ...request,
        context: { ...context, shareSchema: false },
      }),
    ).toThrow()
    subject.start(request)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('done'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      context.connectionId,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    subject.start({ ...request, requestId: randomUUID(), resume: true })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2))
    expect(codex.turns[1]?.sessionId).toBe(thread)
    generation = 'generation-2'
    subject.start({ ...request, requestId: randomUUID(), resume: true })
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(3))
    expect(codex.turns[2]?.sessionId).toBeUndefined()
    subject.start({
      ...request,
      requestId: randomUUID(),
      resume: true,
      context: undefined,
    })
    await vi.waitFor(() => expect(codex.turns).toHaveLength(4))
    expect(codex.turns[3]?.sessionId).toBeUndefined()
    expect(codex.turns[3]?.mcp).toBeUndefined()
    await subject.dispose()
  })
  it('invalidates the resumable session after a failed turn', async () => {
    const codex = new StubAdapter()
    const events: AgentEvent[] = []
    const subject = new AgentService(
      { codex, copilot: new StubAdapter() },
      (event) => events.push(event),
    )
    const request = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
    }
    subject.start(request)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('done'))
    codex.start = async (_turn, emit) => {
      emit({ type: 'done', outcome: 'failed' })
    }
    events.length = 0
    subject.start({ ...request, requestId: randomUUID(), resume: true })
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' }),
    )
    expect(() => subject.start({ ...request, resume: true })).toThrow(
      'No resumable',
    )
    await subject.dispose()
  })
  it('binds resume to provider and Main-owned session, then resets', async () => {
    const codex = new StubAdapter()
    const events: AgentEvent[] = []
    const subject = new AgentService(
      { codex, copilot: new StubAdapter() },
      (event) => events.push(event),
    )
    const request = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
    }
    subject.start(request)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('done'))
    expect(events[0]).toMatchObject({
      requestId: request.requestId,
      provider: 'codex',
    })
    subject.start({ ...request, requestId: randomUUID(), resume: true })
    await vi.waitFor(() => expect(codex.turns).toHaveLength(2))
    expect(codex.turns[1]?.sessionId).toBe(thread)
    expect(() =>
      subject.start({ ...request, provider: 'copilot', resume: true }),
    ).toThrow('No resumable')
    subject.reset('codex')
    expect(() => subject.start({ ...request, resume: true })).toThrow(
      'No resumable',
    )
    await subject.dispose()
    expect(() => subject.start(request)).toThrow()
  })
  it('rejects injected args, session IDs, provider, oversized prompts and SQL execution bridges', () => {
    const subject = new AgentService(
      { codex: new StubAdapter(), copilot: new StubAdapter() },
      () => {},
    )
    const request = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
    }
    for (const invalid of [
      { ...request, args: ['--dangerously-bypass-approvals-and-sandbox'] },
      { ...request, sessionId: thread },
      { ...request, provider: 'shell' },
      { ...request, prompt: 'x'.repeat(16_001) },
      { ...request, prompt: ' ' },
    ])
      expect(() => subject.start(invalid)).toThrow()
  })
  it('blocks concurrent provider switches, ignores stale cancellation, and handles pre-spawn cancellation', async () => {
    const codex = new StubAdapter()
    const events: AgentEvent[] = []
    const subject = new AgentService(
      { codex, copilot: new StubAdapter() },
      (event) => events.push(event),
    )
    const request = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
    }
    subject.start(request)
    expect(() => subject.start({ ...request, provider: 'copilot' })).toThrow(
      'busy',
    )
    await subject.cancel({ requestId: randomUUID() })
    await subject.cancel({ requestId: request.requestId })
    expect(codex.turns).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'cancelled' })
    await subject.dispose()
  })
})

describe('real shell-free process transport (Node fixture, not AI)', () => {
  const options = (code: string): RunOptions => ({
    executable: process.execPath,
    args: ['-e', code],
    cwd: directory,
    env: agentEnvironment(process.env),
    timeoutMs: 5000,
  })
  it('uses stdin without shell interpolation and supports nonzero exits', async () => {
    const result = await runProcess({
      ...options(
        'process.stdin.on("data", b => process.stdout.write(b)); process.stdin.on("end", () => process.exit(3))',
      ),
      input: '$(not-a-command); "한글"',
    })
    expect(result.code).toBe(3)
    expect(result.stdout).toBe('$(not-a-command); "한글"')
  })
  it('kills a timed-out process and supports request cancellation', async () => {
    await expect(
      runProcess({ ...options('setInterval(() => {}, 1000)'), timeoutMs: 80 }),
    ).rejects.toThrow('timeout')
    const controller = new AbortController()
    const pending = runProcess({
      ...options('setInterval(() => {}, 1000)'),
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
  })
  it('kills oversized output and invalid streaming callbacks', async () => {
    await expect(
      runProcess(
        options(
          'process.stdout.write("x".repeat(1048577)); setInterval(() => {}, 1000)',
        ),
      ),
    ).rejects.toThrow('limit')
    await expect(
      runProcess({
        ...options('process.stdout.write("bad"); setInterval(() => {}, 1000)'),
        stdout: () => {
          throw new Error('invalid')
        },
      }),
    ).rejects.toThrow('Invalid')
  })
  it('rejects relative executables and missing absolute executables', async () => {
    await expect(
      runProcess({ ...options(''), executable: 'node' }),
    ).rejects.toThrow('Absolute')
    await expect(
      runProcess({
        ...options(''),
        executable: join(directory, 'missing.exe'),
      }),
    ).rejects.toThrow('start')
  })
})
describe('model selection (ADR-032)', () => {
  it('passes a validated model only as a quoted config value', async () => {
    const { agentRequestSchema } = await import('@shared/agent')
    const base = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hi',
      resume: false,
    }
    expect(
      agentRequestSchema.safeParse({ ...base, model: 'gpt-5-codex' }).success,
    ).toBe(true)
    for (const model of ['--yolo', 'a b', 'x"y', '../m', ''])
      expect(agentRequestSchema.safeParse({ ...base, model }).success).toBe(
        false,
      )
    const args = codexArguments(undefined, undefined, 'gpt-5-codex')
    expect(args.slice(0, 3)).toEqual(['exec', '-c', 'model="gpt-5-codex"'])
    expect(codexArguments().join(' ')).not.toContain('model=')
  })
})
describe('CLI model catalogs (ADR-032)', () => {
  it('reads Copilot model ids from help config and stops at the next setting', () => {
    expect(
      copilotModels(
        `x
  \`model\`: AI model to use
    - "claude-sonnet-5.5"
    - "gpt-5.5"
    - "bad model"

  \`contextTier\`: ...
    - "default"`,
      ),
    ).toEqual(['claude-sonnet-5.5', 'gpt-5.5'])
    expect(copilotModels('no model section')).toEqual([])
  })
  it('reads only listed Codex models from its cache, in priority order', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const home = await mkdtemp(join(tmpdir(), 'aidb-codex-models-'))
    try {
      expect(await codexModels({ CODEX_HOME: home })).toEqual([])
      await writeFile(
        join(home, 'models_cache.json'),
        JSON.stringify({
          models: [
            { slug: 'b-model', visibility: 'list', priority: 2 },
            { slug: 'hidden', visibility: 'hide', priority: 0 },
            { slug: 'a-model', visibility: 'list', priority: 1 },
            { slug: '--flag', visibility: 'list', priority: 3 },
          ],
        }),
      )
      expect(await codexModels({ CODEX_HOME: home })).toEqual([
        'a-model',
        'b-model',
      ])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
