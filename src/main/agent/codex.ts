import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentPayload, AgentStatus } from '@shared/agent'
import type { AgentAdapter, AgentTurn } from './AgentAdapter'
import {
  agentEnvironment,
  findCodex,
  runProcess,
  type ProcessRunner,
} from './process'
import { classifyError, decodeEvent, JsonlDecoder } from './protocol'
import { toolNames, type McpLaunch } from '@shared/mcp'
import { agentModelSchema } from '@shared/agent'

const modelCache = z.object({
  models: z
    .array(
      z
        .object({
          slug: z.string(),
          visibility: z.string().optional(),
          priority: z.number().optional(),
        })
        .passthrough(),
    )
    .max(500),
})
// Reads the model list Codex itself caches; a missing/invalid cache just yields none.
export async function codexModels(
  environment: NodeJS.ProcessEnv,
): Promise<string[]> {
  try {
    const home = environment.CODEX_HOME || join(homedir(), '.codex')
    const cache = modelCache.parse(
      JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8')),
    )
    return cache.models
      .filter((model) => model.visibility === 'list')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((model) => model.slug)
      .filter((slug) => agentModelSchema.safeParse(slug).success)
      .slice(0, 50)
  } catch {
    return []
  }
}

export const VERIFIED_CODEX_VERSION = '0.165.0'
const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'hooks',
  'plugins',
  'remote_plugin',
  'apps',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'computer_use',
  'image_generation',
  'view_image',
  'memories',
  'code_mode',
  'code_mode_host',
  'goals',
  'sleep_tool',
]
export function codexArguments(
  sessionId?: string,
  mcp?: McpLaunch,
  model?: string,
): string[] {
  return [
    'exec',
    // Validated by agentModelSchema; JSON quoting keeps it a TOML string value.
    ...(model ? ['-c', `model=${JSON.stringify(model)}`] : []),
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--json',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    '-c',
    'forced_login_method="chatgpt"',
    '-c',
    'model_provider="openai"',
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    mcp
      ? `mcp_servers={ai_db={command=${JSON.stringify(mcp.executable)},args=[${JSON.stringify(mcp.script)}],env_vars=["AI_DB_MCP_ADDRESS","AI_DB_MCP_TOKEN","ELECTRON_RUN_AS_NODE"],enabled_tools=${JSON.stringify(toolNames)},required=true,default_tools_approval_mode="auto",tool_timeout_sec=15}}`
      : 'mcp_servers={}',
    '-c',
    'notify=[]',
    ...disabledFeatures
      .filter((feature) => !(mcp && feature === 'code_mode_host'))
      .flatMap((feature) => ['--disable', feature]),
    ...(mcp ? ['--enable', 'code_mode_host'] : []),
    ...(sessionId ? ['resume', sessionId, '-'] : ['-']),
  ]
}

export class CodexAdapter implements AgentAdapter {
  private active?: AbortController
  private pending?: Promise<void>
  private closing = false
  private readonly lifetime = new AbortController()
  constructor(
    private readonly cwd: string,
    private readonly runner: ProcessRunner = runProcess,
    private readonly locate: () => Promise<string | undefined> = findCodex,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async detect(): Promise<AgentStatus> {
    return this.inspectAuth()
  }
  async inspectAuth(signal?: AbortSignal): Promise<AgentStatus> {
    const status: AgentStatus = {
      provider: 'codex',
      installed: false,
      available: false,
      auth: 'unavailable',
      reason:
        'Install the official Codex CLI, then sign in with ChatGPT in your terminal.',
    }
    if (this.closing)
      return { ...status, reason: 'Assistant is shutting down.' }
    const executable = await this.locate()
    if (!executable) return status
    status.installed = true
    status.auth = 'unknown'
    if (
      Object.entries(this.environment).some(
        ([key, value]) =>
          /^(OPENAI_API_KEY|CODEX_API_KEY|AZURE_OPENAI_API_KEY)$/i.test(key) &&
          value,
      )
    ) {
      return {
        ...status,
        auth: 'api-key',
        reason:
          'API-key environment detected. This app does not use API billing. Remove it from the app environment and use ChatGPT login.',
      }
    }
    try {
      await mkdir(this.cwd, { recursive: true })
      const common = {
        executable,
        cwd: this.cwd,
        env: agentEnvironment(this.environment),
        timeoutMs: 10_000,
        signal: signal
          ? AbortSignal.any([signal, this.lifetime.signal])
          : this.lifetime.signal,
      }
      const version = await this.runner({ ...common, args: ['--version'] })
      const match = /^codex-cli (\d+\.\d+\.\d+)\s*$/.exec(version.stdout.trim())
      status.version = match?.[1]
      if (version.code !== 0 || status.version !== VERIFIED_CODEX_VERSION)
        return {
          ...status,
          reason: `Only Codex CLI ${VERIFIED_CODEX_VERSION} has a verified restricted launch contract. Other versions are disabled.`,
        }
      const help = await this.runner({ ...common, args: ['exec', '--help'] })
      if (
        help.code !== 0 ||
        !help.stdout.includes('--ignore-user-config') ||
        !help.stdout.includes('--ignore-rules')
      )
        return {
          ...status,
          reason: 'Required CLI isolation options are unavailable.',
        }
      const auth = await this.runner({ ...common, args: ['login', 'status'] })
      const output = `${auth.stdout}\n${auth.stderr}`.trim()
      if (/API key/i.test(output))
        return {
          ...status,
          auth: 'api-key',
          reason:
            'API-key CLI authentication is not supported. Use the official CLI ChatGPT login; no automatic fallback.',
        }
      if (auth.code !== 0 || output !== 'Logged in using ChatGPT')
        return {
          ...status,
          reason:
            'ChatGPT authentication could not be verified. Run codex login in your terminal.',
        }
      return {
        ...status,
        available: true,
        auth: 'subscription',
        reason:
          'ChatGPT login verified. Only your message is sent; no DB context or tools. CLI usage limits apply.',
        models: await codexModels(this.environment),
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
      const parser = new JsonlDecoder((raw) => {
        if (completed || failed) throw new Error('Event after terminal result')
        for (const event of decodeEvent('codex', raw, turn.mcp !== undefined)) {
          if (event.type === 'session') {
            if (
              sessionId ||
              (turn.sessionId && event.sessionId !== turn.sessionId)
            )
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
        args: codexArguments(turn.sessionId, turn.mcp, turn.model),
        cwd: this.cwd,
        env: {
          ...agentEnvironment(this.environment),
          ...turn.mcp?.environment,
        },
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
    this.cancel()
    await this.pending
  }
}
