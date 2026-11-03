import { McpServer } from '@modelcontextprotocol/server'
import type { Config } from './config.js'
import { ADD_JOB_DESCRIPTION, ADD_JOB_TOOL_NAME, addJobInputSchema, runAddJob } from './addJobTool.js'
import { GET_COMPANIES_DESCRIPTION, GET_COMPANIES_TOOL_NAME, runGetCompanies } from './companiesTool.js'

export function createServer(config: Config, fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: 'job-hunter', version: '1.2.0' })
  server.registerTool(
    ADD_JOB_TOOL_NAME,
    { description: ADD_JOB_DESCRIPTION, inputSchema: addJobInputSchema },
    (input) => runAddJob(config, input, fetchImpl),
  )
  server.registerTool(
    GET_COMPANIES_TOOL_NAME,
    { description: GET_COMPANIES_DESCRIPTION, annotations: { readOnlyHint: true } },
    () => runGetCompanies(config, fetchImpl),
  )
  return server
}
