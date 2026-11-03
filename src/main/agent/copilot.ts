import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  agentModelSchema,
  type AgentPayload,
  type AgentStatus,
} from '@shared/agent'
import { toolNames, toolNameSchema, type McpLaunch } from '@shared/mcp'
import type { AgentAdapter, AgentTurn } from './AgentAdapter'
import {
  agentEnvironment,
  firstNative,
  runProcess,
  type ProcessRunner,
} from './process'
import { classifyError, JsonlDecoder } from './protocol'

// Copilot updates itself often, so instead of pinning a version the launch
// contract is checked against `--help` before every status/turn (ADR-032).
const requiredOptions = [
  '--output-format',
  '--available-tools',
  '--additional-mcp-config',
  '--allow-tool',
  '--no-custom-instructions',
  '--disable-builtin-mcps',
  '--no-ask-user',
  '--no-auto-update',
]
export function copilotArguments(
  sessionId?: string,
  mcp?: McpLaunch,
  model?: string,
): string[] {
  return [
    '--output-format',
    'json',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    '--no-ask-user',
    '--no-auto-update',
    '--disable-client-telemetry',
    '--log-level',
    'none',
    // Only ai_db tools exist for the model; a name that matches nothing leaves zero
    // tools (an empty list would mean "no restriction"). Variadic options are
    // always followed by another flag so they cannot swallow a later value.
    '--available-tools',
    ...(mcp ? toolNames.map((name) => `ai_db-${name}`) : ['ai_db-none']),
    ...(mcp
      ? [
          '--additional-mcp-config',
          JSON.stringify({
            mcpServers: {
              ai_db: {
                type: 'local',
                command: mcp.executable,
                args: [mcp.script],
                tools: ['*'],
              },
            },
          }),
          '--allow-tool',
          'ai_db',
        ]
      : []),
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--resume', sessionId] : []),
  ]
}

// Native copilot.exe only: PATH (absolute entries) and the WinGet install locations.
export async function findCopilot(
  source: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const binary = process.platform === 'win32' ? 'copilot.exe' : 'copilot'
  const candidates = (source.PATH ?? source.Path ?? '')
    .split(delimiter)
    .filter((path) => isAbsolute(path))
    .map((directory) => join(directory, binary))
  if (process.platform === 'win32') {
    const winget = join(
      source.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'Microsoft',
      'WinGet',
    )
    candidates.push(join(winget, 'Links', binary))
    const packages = await readdir(join(winget, 'Packages')).catch(() => [])
    for (const name of packages)
      if (name.startsWith('GitHub.Copilot_'))
        candidates.push(join(winget, 'Packages', name, binary))
  }
  return firstNative(candidates)
}

// `copilot help config` lists accepted values under the `model` setting as `- "id"` lines.
export function copilotModels(help: string): string[] {
  const start = help.indexOf('`model`:')
  if (start < 0) return []
  const models: string[] = []
  for (const line of help.slice(start).split(/\r?\n/).slice(1)) {
    const match = /^\s*-\s*"([^"]+)"\s*$/.exec(line)
    if (!match) break
    if (agentModelSchema.safeParse(match[1]).success) models.push(match[1]!)
  }
  return models.slice(0, 50)
}

const loginSchema = z.object({ host: z.string(), login: z.string() }).strict()
const configSchema = z
  .object({
    loggedInUsers: z
      .array(loginSchema.extend({ kind: z.string() }).strict())
      .max(16)
      .optional(),
    lastLoggedInUser: loginSchema.optional(),
  })
  .passthrough()
// The CLI keeps tokens in the OS credential store and only the account names in
// config.json. The app home receives those names, never a token, so the user's
// own MCP servers, plugins and instructions are not loaded.
export async function prepareCopilotHome(
  home: string,
  userHome = join(homedir(), '.copilot'),
): Promise<string | undefined> {
  let parsed: z.infer<typeof configSchema>
  try {
    const text = await readFile(join(userHome, 'config.json'), 'utf8')
    parsed = configSchema.parse(JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')))
  } catch {
    return undefined
  }
  if (!parsed.lastLoggedInUser) return undefined
  await mkdir(home, { recursive: true })
  await writeFile(
    join(home, 'config.json'),
    JSON.stringify({
      loggedInUsers: parsed.loggedInUsers ?? [],
      lastLoggedInUser: parsed.lastLoggedInUser,
    }),
  )
  return parsed.lastLoggedInUser.login
}

const record = z.object({ type: z.string() }).passthrough()
// Copilot names the server's tools `ai_db-<tool>`; anything else is out of scope.
export function decodeCopilotEvent(
  input: unknown,
  calls: Map<string, string>,
  allowMcp: boolean,
): AgentPayload[] {
  const event = record.parse(input)
  const data = record.partial({ type: true }).parse(event.data ?? {})
  const scoped = (server: unknown, tool: unknown) => {
    if (!allowMcp || server !== 'ai_db') throw new Error('Unscoped tool call')
    return toolNameSchema.parse(tool)
  }
  switch (event.type) {
    case 'assistant.message': {
      for (const request of z
        .array(record.partial({ type: true }))
        .max(64)
        .parse(data.toolRequests ?? []))
        scoped(request.mcpServerName, request.mcpToolName)
      const text = z
        .string()
        .max(128_000)
        .parse(data.content ?? '')
      return text ? [{ type: 'text', text }] : []
    }
    case 'tool.execution_start': {
      const name = scoped(data.mcpServerName, data.mcpToolName)
      calls.set(z.string().max(200).parse(data.toolCallId), name)
      return [{ type: 'tool', name, status: 'started' }]
    }
    case 'tool.execution_complete': {
      const name = calls.get(z.string().max(200).parse(data.toolCallId))
      if (!name) throw new Error('Unknown tool call')
      return [{ type: 'tool', name, status: 'completed' }]
    }
    case 'result': {
      const sessionId = z.string().uuid().parse(event.sessionId)
      if (event.exitCode !== 0)
        return [
          {
            type: 'error',
            code: 'process',
            message:
              'CLI request failed. Check login and subscription usage in the official CLI.',
          },
        ]
      return [
        { type: 'session', sessionId },
        { type: 'done', outcome: 'completed' },
      ]
    }
  }
  if (event.type.startsWith('tool.')) throw new Error('Unexpected tool event')
  if (/error/i.test(event.type))
    return [
      {
        type: 'error',
        code: classifyError(JSON.stringify(data).slice(0, 4096)),
        message:
          'CLI request failed. Check login and subscription usage in the official CLI.',
      },
    ]
  // Session, model, usage and streaming deltas carry nothing the UI needs.
  return []
}

export class CopilotAdapter implements AgentAdapter {
  private active?: AbortController
  private pending?: Promise<void>
  private closing = false
  private readonly lifetime = new AbortController()
  constructor(
    private readonly cwd: string,
    private readonly runner: ProcessRunner = runProcess,
    private readonly locate: () => Promise<string | undefined> = findCopilot,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly userHome?: string,
  ) {}
  private get home(): string {
    return join(this.cwd, 'copilot-home')
  }
  private env(extra?: Record<string, string>): NodeJS.ProcessEnv {
    // Allowlisted variables only: no GitHub tokens or BYOK provider settings pass through.
    return {
      ...agentEnvironment(this.environment),
      COPILOT_HOME: this.home,
      COPILOT_AUTO_UPDATE: 'false',
      ...extra,
    }
  }
  async detect(): Promise<AgentStatus> {
    return this.inspectAuth()
  }
  async inspectAuth(signal?: AbortSignal): Promise<AgentStatus> {
    const status: AgentStatus = {
      provider: 'copilot',
      installed: false,
      available: false,
      auth: 'unavailable',
      reason:
        'Install the official GitHub Copilot CLI, then sign in with copilot login in your terminal.',
    }
    if (this.closing)
      return { ...status, reason: 'Assistant is shutting down.' }
    const executable = await this.locate()
    if (!executable) return status
    status.installed = true
    status.auth = 'unknown'
    try {
      await mkdir(this.cwd, { recursive: true })
      const common = {
        executable,
        cwd: this.cwd,
        env: this.env(),
        timeoutMs: 10_000,
        signal: signal
          ? AbortSignal.any([signal, this.lifetime.signal])
          : this.lifetime.signal,
      }
      const version = await this.runner({ ...common, args: ['--version'] })
      status.version = /(\d+\.\d+\.\d+)/.exec(version.stdout)?.[1]
      const help = await this.runner({ ...common, args: ['--help'] })
      if (
        version.code !== 0 ||
        help.code !== 0 ||
        requiredOptions.some((option) => !help.stdout.includes(option))
      )
        return {
          ...status,
          reason:
            'This Copilot CLI lacks the required isolation options. Update the official CLI.',
        }
      if (!(await prepareCopilotHome(this.home, this.userHome)))
        return {
          ...status,
          reason:
            'GitHub Copilot sign-in was not found. Run copilot login in your terminal.',
        }
      const config = await this.runner({ ...common, args: ['help', 'config'] })
      return {
        ...status,
        available: true,
        auth: 'subscription',
        reason:
          'GitHub Copilot sign-in found. Copilot premium request limits apply.',
        models: config.code === 0 ? copilotModels(config.stdout) : [],
      }
    } catch {
      return {
        ...status,
        reason:
          'CLI inspection failed or timed out. Check the official CLI in your terminal.',
      }
    }
  }
  start(turn: AgentTurn, emit: (event: AgentPayload) => void): Promise<void> {
    if (this.active || this.closing)
      return Promise.reject(new Error('Assistant unavailable or busy'))
    const controller = new AbortController()
    this.active = controller
    const abort = (): void => controller.abort()
    turn.signal.addEventListener('abort', abort, { once: true })
    if (turn.signal.aborted) controller.abort()
    this.pending = this.run(turn, controller.signal, emit).finally(() => {
      turn.signal.removeEventListener('abort', abort)
      this.active = undefined
      this.pending = undefined
    })
    return this.pending
  }
  resume(
    turn: AgentTurn & { sessionId: string },
    emit: (event: AgentPayload) => void,
  ): Promise<void> {
    return this.start(turn, emit)
  }
  private async run(
    turn: AgentTurn,
    signal: AbortSignal,
    emit: (event: AgentPayload) => void,
  ): Promise<void> {
    let completed = false
    let failed = false
    let success = false
    let sessionId: string | undefined
    try {
      if (signal.aborted) return
      const status = await this.inspectAuth(signal)
      if (signal.aborted) return
      if (!status.available) {
        emit({ type: 'error', code: 'auth', message: status.reason })
        return
      }
      const executable = await this.locate()
      if (!executable) throw new Error('CLI disappeared')
      const calls = new Map<string, string>()
      const parser = new JsonlDecoder((raw) => {
        if (completed || failed) throw new Error('Event after terminal result')
        for (const event of decodeCopilotEvent(raw, calls, !!turn.mcp)) {
          if (event.type === 'session') {
            if (turn.sessionId && event.sessionId !== turn.sessionId)
              throw new Error('Invalid session transition')
            sessionId = event.sessionId
          } else if (event.type === 'done') {
            completed = true
            continue
          } else if (event.type === 'error') failed = true
          emit(event)
          if (failed) throw new Error('Provider reported failure')
        }
      })
      const result = await this.runner({
        executable,
        args: copilotArguments(turn.sessionId, turn.mcp, turn.model),
        cwd: this.cwd,
        // The MCP relay inherits this environment for its capability token.
        env: this.env(turn.mcp?.environment),
        timeoutMs: 120_000,
        signal,
        input: turn.prompt,
        stdout: (chunk) => parser.push(chunk),
      })
      if (signal.aborted) return
      parser.finish()
      if (result.code !== 0 || !completed || !sessionId || failed) {
        if (!failed)
          emit({
            type: 'error',
            code: classifyError(result.stderr),
            message:
              'CLI did not complete successfully. Check login, usage limits and CLI compatibility.',
          })
        return
      }
      success = true
    } catch (error) {
      if (!signal.aborted && !failed)
        emit({
          type: 'error',
          code:
            error instanceof Error && error.message === 'timeout'
              ? 'timeout'
              : 'protocol',
          message:
            'CLI stopped: timeout, invalid stream or output limit. No automatic retry.',
        })
    } finally {
      if (signal.aborted) emit({ type: 'done', outcome: 'cancelled' })
      else emit({ type: 'done', outcome: success ? 'completed' : 'failed' })
    }
  }
  cancel(): void {
    this.active?.abort()
  }
  async dispose(): Promise<void> {
    this.closing = true
    this.lifetime.abort()
    this.active?.abort()
    await this.pending?.catch(() => undefined)
  }
}
