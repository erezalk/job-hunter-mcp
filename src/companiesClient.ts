import { TIMEOUT_MS } from './addJobClient.js'
import type { Config } from './config.js'

/** A company on the user's board with the distinct titles of all their jobs there. */
export interface CompanyPositions {
  company: string
  positions: string[]
}

export type GetCompaniesOutcome =
  | { kind: 'companies'; companies: CompanyPositions[] }
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

const singleLine = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null

// The companies the integration token's owner already has in Job Hunter, each with its position titles.
// Read-only: no body, no parameters, and in particular nothing that could select a user.
export async function getCompanies(config: Config, fetchImpl: typeof fetch = fetch): Promise<GetCompaniesOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}/api/integrations/companies`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { kind: 'unavailable' }
  }

  if (response.status === 401 || response.status === 403) return { kind: 'auth' }
  if (response.status !== 200) return { kind: 'error' }

  const body: unknown = await response.json().catch(() => null)
  // A 200 that is not an array is a malformed answer, never "no companies".
  if (!Array.isArray(body)) return { kind: 'error' }

  const companies = body.flatMap((entry): CompanyPositions[] => {
    const { company, positions } = (entry ?? {}) as { company?: unknown; positions?: unknown }
    const name = singleLine(company)
    if (name === null) return []
    const titles = Array.isArray(positions) ? positions.map(singleLine).filter((t): t is string => t !== null) : []
    // Only the company name and its distinct titles are passed on; anything else in the entry is dropped.
    return [{ company: name, positions: [...new Set(titles)] }]
  })
  return { kind: 'companies', companies }
}
