import type { Config } from './config.js'

// Fields of the backend's integration Add Job contract: the Add Job fields plus
// an optional, already-calculated fit evaluation. Nothing else is ever sent: in
// particular there is no owner/user field and no source (the backend assigns
// "External AI" itself).
export interface AddJobInput {
  title: string
  companyName?: string | undefined
  description?: string | undefined
  location?: string | undefined
  workModel?: string | undefined
  url?: string | undefined
  salaryMin?: number | undefined
  salaryMax?: number | undefined
  currency?: string | undefined
  fitScore?: number | undefined
  matchingSkills?: string[] | undefined
  missingSkills?: string[] | undefined
  concerns?: string[] | undefined
  evaluationModel?: string | undefined
}

export type AddJobOutcome =
  | { kind: 'created'; title: string; companyName: string | null; statusLabel: string; importedFitScore: number | null }
  | { kind: 'duplicate'; title: string; companyName: string | null }
  | { kind: 'validation'; problems: string[] }
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

const TIMEOUT_MS = 15_000

function pickFields(input: AddJobInput): AddJobInput {
  const {
    title, companyName, description, location, workModel, url, salaryMin, salaryMax, currency,
    fitScore, matchingSkills, missingSkills, concerns, evaluationModel,
  } = input
  return Object.fromEntries(
    Object.entries({
      title, companyName, description, location, workModel, url, salaryMin, salaryMax, currency,
      fitScore, matchingSkills, missingSkills, concerns, evaluationModel,
    }).filter(([, value]) => value !== undefined),
  ) as unknown as AddJobInput
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// Never returns raw backend bodies: only the field-level validation messages
// the backend deliberately produces for the user.
function validationProblems(body: unknown): string[] {
  const fieldErrors = (body as { fieldErrors?: unknown } | null)?.fieldErrors
  const problems = Array.isArray(fieldErrors)
    ? fieldErrors.flatMap((entry) => {
        const field = readString((entry as { field?: unknown })?.field)
        const message = readString((entry as { message?: unknown })?.message)
        return field && message ? [`${field}: ${message}`] : []
      })
    : []
  if (problems.length > 0) return problems
  // Cross-field rule violations (e.g. fit details without a fitScore) come back as a plain 400 message.
  const message = readString((body as { message?: unknown } | null)?.message)
  return message && message !== 'Validation failed' ? [message.replace(/\.$/, '')] : []
}

export async function addJob(
  config: Config,
  input: AddJobInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AddJobOutcome> {
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}/api/integrations/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(pickFields(input)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { kind: 'unavailable' }
  }

  if (response.status === 401 || response.status === 403) return { kind: 'auth' }

  const body: unknown = await response.json().catch(() => null)

  if (response.status === 400) {
    return { kind: 'validation', problems: validationProblems(body) }
  }
  if (response.status === 200 || response.status === 201) {
    const data = (body ?? {}) as Record<string, unknown>
    const title = readString(data.title) ?? input.title
    const companyName = readString(data.companyName)
    if (response.status === 200 && data.created === false) return { kind: 'duplicate', title, companyName }
    const imported = data.importedFitScore
    return {
      kind: 'created',
      title,
      companyName,
      statusLabel: readString(data.statusLabel) ?? 'New',
      importedFitScore: typeof imported === 'number' ? imported : null,
    }
  }
  return { kind: 'error' }
}
