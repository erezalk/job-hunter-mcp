import { TIMEOUT_MS } from './addJobClient.js'
import type { Config } from './config.js'

/** The integration token owner's active CV, as GET /api/integrations/cv returns it. */
export interface CvText {
  fileName: string
  contentType: string
  fileSizeBytes: number | null
  uploadedAt: string | null
  /** SUCCESS, EMPTY (little or no text, e.g. a scanned PDF) or FAILED (unreadable file). */
  extractionStatus: string
  extractionWarning: string | null
  /** Verbatim text extracted by the backend when the CV was uploaded; may be empty. */
  extractedText: string
}

/** The original uploaded file, byte for byte. */
export interface CvFile {
  bytes: Uint8Array
  fileName: string
  contentType: string
}

/** Failures shared by both requests. */
export type CvFailure =
  | { kind: 'missing' } // the user has not uploaded a CV
  | { kind: 'unsupported' } // a backend that predates the CV integration endpoints
  | { kind: 'auth' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

export type GetCvOutcome = { kind: 'cv'; cv: CvText } | CvFailure
export type GetCvFileOutcome = { kind: 'file'; file: CvFile } | CvFailure

export const CV_PDF_MIME_TYPE = 'application/pdf'
const FALLBACK_FILE_NAME = 'cv.pdf'

const singleLine = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.replace(/\s+/g, ' ').trim() : null

// Read-only GETs: no body, no parameters, and in particular nothing that could select a user or another CV.
async function request(config: Config, path: string, accept: string, fetchImpl: typeof fetch): Promise<Response | null> {
  try {
    return await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return null
  }
}

// A 404 is "no CV" only when the backend says so; any other 404 is a backend without these endpoints.
async function failure(response: Response): Promise<CvFailure> {
  if (response.status === 401 || response.status === 403) return { kind: 'auth' }
  if (response.status === 404) {
    const body: unknown = await response.json().catch(() => null)
    return (body as { code?: unknown } | null)?.code === 'CV_NOT_FOUND' ? { kind: 'missing' } : { kind: 'unsupported' }
  }
  return { kind: 'error' }
}

export async function getCv(config: Config, fetchImpl: typeof fetch = fetch): Promise<GetCvOutcome> {
  const response = await request(config, '/api/integrations/cv', 'application/json', fetchImpl)
  if (response === null) return { kind: 'unavailable' }
  if (response.status !== 200) return failure(response)

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  // A 200 without the essential fields is a malformed answer, never an empty CV.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { kind: 'error' }
  const { extractedText, extractionStatus } = body
  if (typeof extractedText !== 'string' || typeof extractionStatus !== 'string') return { kind: 'error' }

  return {
    kind: 'cv',
    cv: {
      fileName: singleLine(body.fileName) ?? FALLBACK_FILE_NAME,
      contentType: singleLine(body.contentType) ?? CV_PDF_MIME_TYPE,
      fileSizeBytes: typeof body.fileSizeBytes === 'number' ? body.fileSizeBytes : null,
      uploadedAt: singleLine(body.uploadedAt),
      extractionStatus,
      extractionWarning: singleLine(body.extractionWarning),
      // Passed on verbatim: the CV text is never trimmed, rewritten or shortened here.
      extractedText,
    },
  }
}

export async function getCvFile(config: Config, fetchImpl: typeof fetch = fetch): Promise<GetCvFileOutcome> {
  // JSON must stay acceptable: the backend answers errors (e.g. "no CV", 404 + CV_NOT_FOUND) with a JSON body,
  // and a PDF-only Accept header would make it fail to write that body at all.
  const response = await request(config, '/api/integrations/cv/file', `${CV_PDF_MIME_TYPE}, application/json;q=0.9`, fetchImpl)
  if (response === null) return { kind: 'unavailable' }
  if (response.status !== 200) return failure(response)

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  // Anything but a PDF (e.g. an HTML error page from a proxy) is never passed off as the CV.
  if (contentType !== CV_PDF_MIME_TYPE) return { kind: 'error' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch {
    return { kind: 'error' }
  }
  const fileName = fileNameFromContentDisposition(response.headers.get('content-disposition')) ?? FALLBACK_FILE_NAME
  return { kind: 'file', file: { bytes, fileName, contentType: CV_PDF_MIME_TYPE } }
}

/**
 * The file name from a Content-Disposition header: the RFC 5987 `filename*` form
 * (UTF-8, percent-encoded; the backend always sends it) wins over plain `filename`.
 */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header)?.[1]?.trim()
  if (extended) {
    const match = /^([\w!#$%&+^`{}~-]+)'[^']*'(.*)$/.exec(extended.replace(/^"|"$/g, ''))
    if (match && /^utf-8$/i.test(match[1]!)) {
      try {
        const decoded = singleLine(decodeURIComponent(match[2]!))
        if (decoded) return decoded
      } catch {
        // Malformed percent-encoding: fall back to the plain parameter.
      }
    }
  }
  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)?.[1]
  const plain = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(header)?.[1]
  // An RFC 2047 encoded-word (=?UTF-8?Q?...?=) is only a legacy fallback; without filename* it is not decoded.
  const name = singleLine(plain)
  return name && !name.startsWith('=?') ? name : null
}
