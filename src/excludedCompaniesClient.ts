import { TIMEOUT_MS } from './addJobClient.js'
import type { Config } from './config.js'

export type GetExcludedCompaniesOutcome =
  | { kind: 'companies'; names: string[] }
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

const singleLine = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null

// The integration token owner's Excluded Companies (Settings -> Job Search in Job Hunter).
// Read-only: no body, no parameters, and in particular nothing that could select a user.
export async function getExcludedCompanies(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Promise<GetExcludedCompaniesOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}/api/integrations/excluded-companies`, {
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
  // A 200 that is not an array is a malformed answer, never "nothing excluded".
  if (!Array.isArray(body)) return { kind: 'error' }

  // Only non-empty, single-line company names are passed on, each once.
  const names = body.map(singleLine).filter((name): name is string => name !== null)
  return { kind: 'companies', names: [...new Set(names)] }
}
