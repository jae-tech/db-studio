import { createServer, type Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import type { McpLaunch, SqlProposal } from '@shared/mcp'
import { JsonlDecoder } from '../agent/protocol'
import { MetadataCache, type MetadataScope } from './metadata'
import { ToolSession } from './session'
import { McpProtocol } from './protocol'

export type AgentToolScope = {
  key: string
  launch: McpLaunch
  close(): Promise<void>
}
const envelope = z
  .object({ token: z.string().length(64), request: z.unknown() })
  .strict()
export async function openMcpScope(
  scope: MetadataScope,
  cache: MetadataCache,
  signal: AbortSignal,
  propose: (value: SqlProposal) => void,
  runtime: { executable: string; script: string; electron: boolean },
): Promise<AgentToolScope> {
  scope.assertCurrent()
  if (signal.aborted) throw new Error('Scope cancelled')
  const secret = randomBytes(32)
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\ai-db-mcp-${randomBytes(24).toString('hex')}`
      : join(tmpdir(), `aidb-mcp-${randomBytes(24).toString('hex')}.sock`)
  const lifetime = new AbortController()
  const combined = AbortSignal.any([signal, lifetime.signal])
  const session = new ToolSession(scope, cache, combined, propose)
  const sockets = new Set<Socket>()
  let busy = false
  let closed = false
  const server = createServer((socket) => {
    if (closed || sockets.size >= 2) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.setTimeout(130000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    const protocol = new McpProtocol(session)
    let queued = 0
    let chain = Promise.resolve()
    const decoder = new JsonlDecoder((value) => {
      const parsed = envelope.parse(value)
      const provided = Buffer.from(parsed.token, 'hex')
      if (
        provided.length !== secret.length ||
        !timingSafeEqual(provided, secret)
      )
        throw new Error('Invalid capability')
      if (++queued > 8) throw new Error('Too many pending requests')
      chain = chain
        .then(async () => {
          if (closed || socket.destroyed || combined.aborted) return
          scope.assertCurrent()
          if (busy) throw new Error('Concurrent metadata request refused')
          busy = true
          try {
            const response = await protocol.handle(parsed.request)
            if (
              response !== undefined &&
              !socket.destroyed &&
              !combined.aborted
            )
              socket.write(JSON.stringify(response) + '\n')
          } finally {
            busy = false
          }
        })
        .catch(() => {
          socket.destroy()
        })
        .finally(() => {
          queued--
        })
    })
    socket.on('data', (chunk: Buffer) => {
      try {
        decoder.push(chunk)
      } catch {
        socket.destroy()
      }
    })
    socket.on('end', () => {
      socket.destroy()
    })
  })
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    lifetime.abort()
    clearTimeout(expiry)
    signal.removeEventListener('abort', abort)
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const abort = (): void => {
    void close()
  }
  const expiry = setTimeout(abort, 130000)
  expiry.unref()
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => reject(error)
      server.once('error', fail)
      server.listen(
        { path: address, readableAll: false, writableAll: false },
        () => {
          server.removeListener('error', fail)
          resolve()
        },
      )
    })
    server.on('error', abort)
    server.unref()
    if (process.platform !== 'win32') await chmod(address, 0o600)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      await close()
      throw new Error('Scope cancelled')
    }
    return {
      key: scope.key,
      launch: {
        ...runtime,
        environment: {
          AI_DB_MCP_ADDRESS: address,
          AI_DB_MCP_TOKEN: secret.toString('hex'),
          ...(runtime.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
