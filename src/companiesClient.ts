import { TIMEOUT_MS } from './addJobClient.js'
import type { Config } from './config.js'

export type GetCompaniesOutcome =
  | { kind: 'companies'; names: string[] }
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

// Names of the companies the integration token's owner already has in Job Hunter.
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
  const companies = (body as { companies?: unknown } | null)?.companies
  // A 200 without a companies array is a malformed answer, never "no companies".
  if (!Array.isArray(companies)) return { kind: 'error' }

  const names = companies.flatMap((entry) => {
    const name = (entry as { name?: unknown } | null)?.name
    // Single-line names only: the list is rendered as one company per line.
    return typeof name === 'string' && name.trim().length > 0 ? [name.replace(/\s+/g, ' ').trim()] : []
  })
  return { kind: 'companies', names }
}
