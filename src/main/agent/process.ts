import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'

export function agentEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  const allowed = [
    'SystemRoot',
    'WINDIR',
    'USERPROFILE',
    'HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'CODEX_HOME',
  ]
  for (const key of allowed) {
    const entry = Object.entries(source).find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    )
    if (entry?.[1]) result[key] = entry[1]
  }
  result.NO_COLOR = '1'
  return result
}

// Never execute .cmd/.ps1 wrappers or resolve relative PATH entries / the workspace.
export async function findCodex(
  source: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const directories = (source.PATH ?? source.Path ?? '')
    .split(delimiter)
    .filter((path) => isAbsolute(path))
  const binary = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = directories.map((directory) => join(directory, binary))
  if (process.platform === 'win32' && ['x64', 'arm64'].includes(process.arch)) {
    const target = `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`
    const roots = [
      ...directories,
      join(source.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm'),
    ]
    for (const root of roots) {
      candidates.push(
        join(
          root,
          'node_modules',
          '@openai',
          'codex',
          'node_modules',
          '@openai',
          `codex-win32-${process.arch}`,
          'vendor',
          target,
          'bin',
          binary,
        ),
      )
      candidates.push(
        join(
          root,
          'node_modules',
          '@openai',
          'codex',
          'vendor',
          target,
          'bin',
          binary,
        ),
      )
    }
  }
  return firstNative(candidates)
}
// Never resolve to a binary inside the app workspace (or a relative path).
export async function firstNative(
  candidates: string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      const executable = await realpath(candidate)
      const fromWorkspace = relative(process.cwd(), executable)
      if (
        !fromWorkspace ||
        (fromWorkspace !== '..' &&
          !fromWorkspace.startsWith(`..${sep}`) &&
          !isAbsolute(fromWorkspace))
      )
        continue
      return executable
    } catch {
      /* Try only the next explicit native binary. */
    }
  }
  return undefined
}

export type RunOptions = {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  timeoutMs: number
  input?: string
  stdout?: (chunk: Buffer) => void
}
export type RunResult = { code: number | null; stdout: string; stderr: string }
export type ProcessRunner = (options: RunOptions) => Promise<RunResult>

export const runProcess: ProcessRunner = (options) =>
  new Promise((resolve, reject) => {
    if (!isAbsolute(options.executable) || !isAbsolute(options.cwd)) {
      reject(new Error('Absolute process paths required'))
      return
    }
    if (options.signal?.aborted) {
      reject(new Error('cancelled'))
      return
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(options.executable, options.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      reject(new Error('CLI could not start'))
      return
    }
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let failure: Error | undefined
    let stopping = false
    let fallback: ReturnType<typeof setTimeout> | undefined
    const stop = (error: Error): void => {
      if (stopping) return
      stopping = true
      failure = error
      if (process.platform === 'win32' && child.pid && process.env.SystemRoot) {
        const killer = spawn(
          join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
            env: options.env,
          },
        )
        killer.on('error', () => {
          child.kill()
        })
      } else child.kill('SIGTERM')
      fallback = setTimeout(() => child.kill('SIGKILL'), 2000)
      fallback.unref()
    }
    const abort = (): void => stop(new Error('cancelled'))
    const timer = setTimeout(
      () => stop(new Error('timeout')),
      options.timeoutMs,
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopping) return
      bytes += chunk.length
      if (bytes > 1_048_576) {
        stop(new Error('CLI output limit exceeded'))
        return
      }
      try {
        if (options.stdout) options.stdout(chunk)
        else stdout += chunk.toString('utf8')
      } catch {
        stop(new Error('Invalid or oversized CLI stream'))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 1_048_576) stop(new Error('CLI output limit exceeded'))
      // Diagnostics can contain paths, prompt fragments or credentials; never emit them.
      if (stderr.length < 16_384)
        stderr += chunk.toString('utf8').slice(0, 16_384 - stderr.length)
    })
    child.stdin.on('error', () => {
      /* EPIPE is followed by exit/error; do not crash Main. */
    })
    child.on('error', () => {
      failure ??= new Error('CLI could not start')
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (fallback) clearTimeout(fallback)
      options.signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolve({ code, stdout, stderr })
    })
    child.stdin.end(options.input ?? '')
    if (options.signal?.aborted) abort()
  })
