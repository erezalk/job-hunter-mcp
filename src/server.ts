import { McpServer } from '@modelcontextprotocol/server'
import type { Config } from './config.js'
import { ADD_JOB_DESCRIPTION, ADD_JOB_TOOL_NAME, addJobInputSchema, runAddJob } from './addJobTool.js'

export function createServer(config: Config, fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: 'job-hunter', version: '1.1.0' })
  // The one and only tool.
  server.registerTool(
    ADD_JOB_TOOL_NAME,
    { description: ADD_JOB_DESCRIPTION, inputSchema: addJobInputSchema },
    (input) => runAddJob(config, input, fetchImpl),
  )
  return server
}
