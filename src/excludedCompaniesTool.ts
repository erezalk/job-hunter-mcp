import type { ToolResult } from './addJobTool.js'
import { getExcludedCompanies, type GetExcludedCompaniesOutcome } from './excludedCompaniesClient.js'
import type { Config } from './config.js'

export const GET_EXCLUDED_COMPANIES_TOOL_NAME = 'get_excluded_companies'

export const GET_EXCLUDED_COMPANIES_DESCRIPTION =
  "List the companies the user has excluded from job discovery in Job Hunter (read-only; takes no arguments). " +
  'Returns a JSON array of company names, e.g. ["PPRO", "Flix", "Example Company"], or [] when nothing is excluded. ' +
  'These companies must be skipped entirely during job searches: do not search them, suggest their positions, ' +
  'or add their jobs with add_job, regardless of whether they already have jobs on the board. ' +
  'This is different from get_companies, which lists the companies and positions already on the board (to avoid duplicate jobs); ' +
  'an excluded company may or may not be on the board, and a board company is not excluded unless it is listed here. ' +
  'Call BOTH get_companies and get_excluded_companies before every job search. Workflow: ' +
  '1) get_companies to identify existing companies and positions; ' +
  '2) get_excluded_companies to identify companies to skip entirely; ' +
  '3) search for relevant positions at other companies; ' +
  '4) evaluate them with the usual matching criteria; ' +
  '5) add suitable positions with add_job. ' +
  'Compare names case-insensitively and allow for minor variants (e.g. "Flix" also covers "Flix SE" and "FlixBus"). ' +
  'Exclusion is a discovery preference, not a restriction: if the user explicitly asks to add a specific job at an excluded company, ' +
  'add_job still works. The list always belongs to the owner of the configured Job Hunter integration token; ' +
  'it can only be edited by the user in Job Hunter (Settings → Job Search → Excluded Companies), not through this server.'

export function describeExcludedCompanies(outcome: GetExcludedCompaniesOutcome): ToolResult {
  const text = (value: string, isError = false): ToolResult => ({
    content: [{ type: 'text', text: value }],
    ...(isError ? { isError: true } : {}),
  })
  switch (outcome.kind) {
    case 'companies':
      return text(JSON.stringify(outcome.names))
    case 'auth':
      return text(
        'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
        true,
      )
    case 'unavailable':
      return text('Could not connect to the local Job Hunter backend. Make sure it is running.', true)
    case 'error':
      return text(
        'Job Hunter could not list the excluded companies because of an unexpected backend error. Try again later.',
        true,
      )
  }
}

export async function runGetExcludedCompanies(config: Config, fetchImpl: typeof fetch = fetch): Promise<ToolResult> {
  return describeExcludedCompanies(await getExcludedCompanies(config, fetchImpl))
}
