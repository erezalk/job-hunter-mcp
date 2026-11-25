import { McpServer } from '@modelcontextprotocol/server'
import type { Config } from './config.js'
import { ADD_JOB_DESCRIPTION, ADD_JOB_TOOL_NAME, addJobInputSchema, runAddJob } from './addJobTool.js'
import { GET_COMPANIES_DESCRIPTION, GET_COMPANIES_TOOL_NAME, runGetCompanies } from './companiesTool.js'
import {
  GET_EXCLUDED_COMPANIES_DESCRIPTION,
  GET_EXCLUDED_COMPANIES_TOOL_NAME,
  runGetExcludedCompanies,
} from './excludedCompaniesTool.js'
import {
  CV_RESOURCE_DESCRIPTION,
  CV_RESOURCE_NAME,
  CV_RESOURCE_TITLE,
  CV_RESOURCE_URI,
  GET_CV_DESCRIPTION,
  GET_CV_TOOL_NAME,
  readCvResource,
  runGetCv,
} from './cvTool.js'
import { CV_PDF_MIME_TYPE } from './cvClient.js'
import { GET_SEARCH_PROMPT_DESCRIPTION, GET_SEARCH_PROMPT_TOOL_NAME, runGetSearchPrompt } from './searchPromptTool.js'

export const SERVER_VERSION = '1.5.1'

// Sent to the client at initialization; MCP clients such as Claude and Codex add it to the model's context.
export const SERVER_INSTRUCTIONS =
  "Job Hunter tools for the user's job search. Before searching for jobs, always call get_companies (companies and " +
  'positions already on the board, to avoid duplicates) and get_excluded_companies (companies to skip entirely). Then search ' +
  'for relevant positions at companies that are not excluded, evaluate them with the usual matching criteria, and add suitable ' +
  'positions one by one with add_job. Exclusion is a discovery preference only: add_job is never blocked for an excluded company. ' +
  "To evaluate how well a position fits, call get_cv and use its extracted CV text as the primary source of the user's " +
  'background; never invent CV content. When the user asks to run their saved job search, call get_search_prompt and follow ' +
  'the instructions it returns with these tools; get_search_prompt only retrieves the instructions and never acts on its own.'

export function createServer(config: Config, fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: 'job-hunter', version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS })
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
  server.registerTool(
    GET_EXCLUDED_COMPANIES_TOOL_NAME,
    { description: GET_EXCLUDED_COMPANIES_DESCRIPTION, annotations: { readOnlyHint: true } },
    () => runGetExcludedCompanies(config, fetchImpl),
  )
  server.registerTool(
    GET_CV_TOOL_NAME,
    { description: GET_CV_DESCRIPTION, annotations: { readOnlyHint: true } },
    () => runGetCv(config, fetchImpl),
  )
  server.registerTool(
    GET_SEARCH_PROMPT_TOOL_NAME,
    { description: GET_SEARCH_PROMPT_DESCRIPTION, annotations: { readOnlyHint: true } },
    () => runGetSearchPrompt(config, fetchImpl),
  )
  server.registerResource(
    CV_RESOURCE_NAME,
    CV_RESOURCE_URI,
    { title: CV_RESOURCE_TITLE, description: CV_RESOURCE_DESCRIPTION, mimeType: CV_PDF_MIME_TYPE },
    () => readCvResource(config, fetchImpl),
  )
  return server
}
