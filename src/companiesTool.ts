import type { ToolResult } from './addJobTool.js'
import { getCompanies, type GetCompaniesOutcome } from './companiesClient.js'
import type { Config } from './config.js'

export const GET_COMPANIES_TOOL_NAME = 'get_companies'

export const GET_COMPANIES_DESCRIPTION =
  "List the companies and positions already on the user's Job Hunter board, used to avoid duplicate jobs: " +
  'each company with the titles of all its job positions there (read-only; takes no arguments). Returns a JSON array like ' +
  '[{"company": "Acme", "positions": ["Senior Backend Engineer", "Platform Engineer"]}]: each company appears once, ' +
  'with no position title repeated, and nothing else (no ids, URLs, statuses or scores). ' +
  'Every job on the board is included whatever its status (New, applied, interviewing, offer, Rejected, Archived or Low Match), ' +
  'so a listed company or position may be one the user already rejected or that was a low match. ' +
  "The list always belongs to the owner of the configured Job Hunter integration token; you never need or can choose a user. " +
  'Call it before every job search, together with get_excluded_companies, to identify companies already on the board and to avoid ' +
  'suggesting or adding positions that are already there (do not call add_job for a company + title already listed). ' +
  'Being listed here does NOT mean a company should be skipped: the user may want more positions there. ' +
  'Companies the user wants skipped entirely come from get_excluded_companies, whether or not they have jobs on the board. ' +
  'It does no filtering itself: you decide what to exclude from the user\'s request (whole companies, or only the listed positions), ' +
  'and should compare names and titles case-insensitively and allow for minor variants ' +
  '(e.g. "Acme" vs "Acme Inc.", "Sr. Backend Engineer" vs "Senior Backend Engineer").'

export function describeCompanies(outcome: GetCompaniesOutcome): ToolResult {
  const text = (value: string, isError = false): ToolResult => ({
    content: [{ type: 'text', text: value }],
    ...(isError ? { isError: true } : {}),
  })
  switch (outcome.kind) {
    case 'companies':
      return text(JSON.stringify(outcome.companies, null, 2))
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
