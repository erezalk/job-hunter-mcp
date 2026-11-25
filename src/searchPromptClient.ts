import { TIMEOUT_MS } from './addJobClient.js'
import type { Config } from './config.js'

export type GetSearchPromptOutcome =
  | { kind: 'prompt'; prompt: string }
  | { kind: 'missing' } // the user has not configured a search prompt
  | { kind: 'unsupported' } // a backend that predates the search-prompt endpoint
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

// The integration token owner's saved Search Prompt (Settings -> Job Search in Job Hunter).
// Fetched from the backend on every call (nothing is cached here; Node's fetch has no HTTP cache),
// so an edit in the UI is returned at once without restarting this server.
// Read-only: no body, no parameters, and in particular nothing that could select a user.
export async function getSearchPrompt(config: Config, fetchImpl: typeof fetch = fetch): Promise<GetSearchPromptOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}/api/integrations/search-prompt`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { kind: 'unavailable' }
  }

  if (response.status === 401 || response.status === 403) return { kind: 'auth' }
  if (response.status === 404) {
    // "No prompt" only when the backend says so; any other 404 is a backend without this endpoint.
    const body: unknown = await response.json().catch(() => null)
    return (body as { code?: unknown } | null)?.code === 'SEARCH_PROMPT_NOT_FOUND' ? { kind: 'missing' } : { kind: 'unsupported' }
  }
  if (response.status !== 200) return { kind: 'error' }

  const body: unknown = await response.json().catch(() => null)
  const prompt = (body as { prompt?: unknown } | null)?.prompt
  // A 200 without a text prompt is a malformed answer.
  if (typeof prompt !== 'string') return { kind: 'error' }
  // Passed on verbatim: never trimmed, rewritten or shortened here.
  return prompt.trim() === '' ? { kind: 'missing' } : { kind: 'prompt', prompt }
}
