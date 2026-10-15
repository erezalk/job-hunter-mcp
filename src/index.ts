import { existsSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { ConfigError, loadConfig } from './config.js'
import { createServer } from './server.js'

// stdout belongs to the MCP protocol; every diagnostic goes to stderr.
const log = (message: string) => process.stderr.write(`[job-hunter-mcp] ${message}\n`)

async function main() {
  // Development convenience only (Inspector / terminal runs). Never overrides real environment variables.
  if (existsSync('.env')) {
    try {
      process.loadEnvFile('.env')
    } catch {
      log('Could not read .env; ignoring it.')
    }
  }

  const config = loadConfig(process.env)
  const server = createServer(config)
  await server.connect(new StdioServerTransport())
  log(`Started. Backend: ${config.baseUrl}`)
}

main().catch((err: unknown) => {
  log(err instanceof ConfigError ? err.message : 'Failed to start the MCP server.')
  process.exit(1)
})
