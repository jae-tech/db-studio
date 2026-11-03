import { connect } from 'node:net'
import { JsonlDecoder } from './agent/protocol'

// The CLI starts this small stdio relay. Only Main owns DB access and scope.
const address = process.env.AI_DB_MCP_ADDRESS
const token = process.env.AI_DB_MCP_TOKEN
if (
  !address ||
  !token ||
  !/^[a-f0-9]{64}$/.test(token) ||
  !(
    address.startsWith('\\\\.\\pipe\\ai-db-mcp-') ||
    (process.platform !== 'win32' && address.endsWith('.sock'))
  )
) {
  process.exitCode = 1
} else {
  const socket = connect(address)
  const finish = (): void => {
    socket.destroy()
    process.stdin.destroy()
  }
  socket.on('error', () => {
    process.exitCode = 1
    finish()
  })
  socket.on('close', finish)
  process.stdout.on('error', finish)
  const requests = new JsonlDecoder((request) => {
    if (!socket.write(JSON.stringify({ token, request }) + '\n'))
      process.stdin.pause()
  })
  const responses = new JsonlDecoder((response) => {
    if (!process.stdout.write(JSON.stringify(response) + '\n')) socket.pause()
  })
  socket.on('drain', () => process.stdin.resume())
  process.stdout.on('drain', () => socket.resume())
  process.stdin.on('data', (chunk: Buffer) => {
    try {
      requests.push(chunk)
    } catch {
      process.exitCode = 1
      finish()
    }
  })
  socket.on('data', (chunk: Buffer) => {
    try {
      responses.push(chunk)
    } catch {
      process.exitCode = 1
      finish()
    }
  })
  process.stdin.on('end', finish)
  process.stdin.on('error', finish)
  process.on('SIGTERM', finish)
  process.on('SIGINT', finish)
}
