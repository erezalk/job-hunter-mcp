import type { ToolResult } from './addJobTool.js'
import { getCompanies, type GetCompaniesOutcome } from './companiesClient.js'
import type { Config } from './config.js'

export const GET_COMPANIES_TOOL_NAME = 'get_companies'

export const GET_COMPANIES_DESCRIPTION =
  "List the names of the companies that already exist in the user's Job Hunter account (read-only; takes no arguments). " +
  'A company is listed once if the user has at least one job there, whatever that job\'s status ' +
  '(New, applied, interviewing, offer, Rejected, Archived or Low Match). ' +
  "The list always belongs to the owner of the configured Job Hunter integration token; you never need or can choose a user. " +
  'Use it during job discovery when the user wants to avoid companies they have already considered. ' +
  'It only returns the existing companies: you decide which ones to exclude from the user\'s request, ' +
  'and should compare names case-insensitively and allow for minor spelling variants (e.g. "Acme" vs "Acme Inc.").'

export function describeCompanies(outcome: GetCompaniesOutcome): ToolResult {
  const text = (value: string, isError = false): ToolResult => ({
    content: [{ type: 'text', text: value }],
    ...(isError ? { isError: true } : {}),
  })
  switch (outcome.kind) {
    case 'companies':
      return text(
        outcome.names.length === 0
          ? 'No companies exist in Job Hunter yet.'
          : `Companies already in Job Hunter (${outcome.names.length}):\n${outcome.names.map((name) => `- ${name}`).join('\n')}`,
      )
    case 'auth':
      return text(
        'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
        true,
      )
    case 'unavailable':
      return text('Could not connect to the local Job Hunter backend. Make sure it is running.', true)
    case 'error':
      return text('Job Hunter could not list the companies because of an unexpected backend error. Try again later.', true)
  }
}

export async function runGetCompanies(config: Config, fetchImpl: typeof fetch = fetch): Promise<ToolResult> {
  return describeCompanies(await getCompanies(config, fetchImpl))
}
