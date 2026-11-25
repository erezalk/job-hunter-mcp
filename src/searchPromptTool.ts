import type { ToolResult } from './addJobTool.js'
import type { Config } from './config.js'
import { getSearchPrompt, type GetSearchPromptOutcome } from './searchPromptClient.js'

export const GET_SEARCH_PROMPT_TOOL_NAME = 'get_search_prompt'

export const GET_SEARCH_PROMPT_DESCRIPTION =
  "Retrieve the user's saved Job Hunter search instructions (Settings → Job Search → Search Prompt) for use in job discovery " +
  '(read-only; takes no arguments). Returns the complete prompt as plain text, exactly as the user wrote it — free-form, ' +
  'possibly Markdown — with nothing added, removed or summarised. Always the latest saved version. ' +
  'This tool only retrieves the instructions: it does not search for jobs, add positions or change anything. ' +
  'When the user asks you to run their saved job search (or to search using their Job Hunter instructions), call it and ' +
  'follow the returned instructions with the other tools: get_cv for their background, get_companies and ' +
  'get_excluded_companies before searching, and add_job for each qualifying position. ' +
  'The prompt always belongs to the owner of the configured Job Hunter integration token; you never need or can choose a user. ' +
  'It can only be edited by the user in Job Hunter, not through this server.'

const MISSING_MESSAGE =
  'No search prompt has been configured in Job Hunter yet. Ask the user to write their job-search instructions in ' +
  'Job Hunter (Settings → Job Search → Search Prompt) and save them, or ask them directly what to search for.'
const UNSUPPORTED_MESSAGE =
  'This Job Hunter backend does not support search prompts yet. Update and restart the Job Hunter backend, then try again.'

export function describeSearchPrompt(outcome: GetSearchPromptOutcome): ToolResult {
  const text = (value: string, isError = false): ToolResult => ({
    content: [{ type: 'text', text: value }],
    ...(isError ? { isError: true } : {}),
  })
  switch (outcome.kind) {
    case 'prompt':
      // The saved text and nothing else.
      return text(outcome.prompt)
    case 'missing':
      return text(MISSING_MESSAGE, true)
    case 'unsupported':
      return text(UNSUPPORTED_MESSAGE, true)
    case 'auth':
      return text('Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.', true)
    case 'unavailable':
      return text('Could not connect to the local Job Hunter backend. Make sure it is running.', true)
    case 'error':
      return text('Job Hunter could not retrieve the search prompt because of an unexpected backend error. Try again later.', true)
  }
}

export async function runGetSearchPrompt(config: Config, fetchImpl: typeof fetch = fetch): Promise<ToolResult> {
  return describeSearchPrompt(await getSearchPrompt(config, fetchImpl))
}
