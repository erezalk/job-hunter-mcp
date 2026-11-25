import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError } from '@modelcontextprotocol/server'
import type { ToolResult } from './addJobTool.js'
import type { Config } from './config.js'
import { CV_PDF_MIME_TYPE, getCv, getCvFile, type CvFailure, type CvText, type GetCvOutcome } from './cvClient.js'

export const GET_CV_TOOL_NAME = 'get_cv'

/** The original uploaded PDF, exposed as an MCP resource (resources/read), never as a URL or local path. */
export const CV_RESOURCE_URI = 'jobhunter://cv/current.pdf'
export const CV_RESOURCE_NAME = 'cv'
export const CV_RESOURCE_TITLE = 'Job Hunter CV (original PDF)'
export const CV_RESOURCE_DESCRIPTION =
  "The user's current CV exactly as uploaded to Job Hunter (application/pdf, base64 blob). " +
  'Always the latest uploaded version; its original file name is in _meta and in the get_cv result.'

/** Namespaced key of the original file name in the resource contents' _meta. */
export const CV_FILE_NAME_META_KEY = 'dev.erezalkalay.jobhunter/fileName'

export const GET_CV_DESCRIPTION =
  "Retrieve the user's CV (resume) from Job Hunter: the CV the user uploaded there, always the latest version " +
  '(read-only; takes no arguments). Returns plain text with the original file name, content type, file size, upload time, ' +
  'the text-extraction status, and the COMPLETE text extracted from the PDF, verbatim (not summarised). ' +
  "Use this text as the primary source of the user's professional background, skills and experience when evaluating " +
  'whether a job position fits (e.g. for the fitScore, matchingSkills, missingSkills and concerns of add_job). ' +
  'Never invent, embellish or assume CV content that is not in the text; if the result says the text could not be extracted, ' +
  'say so instead of guessing. ' +
  `The original PDF file itself is also available, unmodified, as the MCP resource ${CV_RESOURCE_URI} for clients that can read ` +
  'MCP resources; the extracted text here is the reliable way to read the CV. ' +
  'The CV always belongs to the owner of the configured Job Hunter integration token; you never need or can choose a user. ' +
  'It can only be uploaded or replaced by the user in Job Hunter (CV page), not through this server.'

const AUTH_MESSAGE = 'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.'
const UNAVAILABLE_MESSAGE = 'Could not connect to the local Job Hunter backend. Make sure it is running.'
const MISSING_MESSAGE =
  'No CV has been uploaded to Job Hunter yet. Ask the user to upload their CV in Job Hunter (CV page), then call get_cv again.'
const UNSUPPORTED_MESSAGE =
  'This Job Hunter backend does not support CV retrieval yet. Update and restart the Job Hunter backend, then try again.'
const ERROR_MESSAGE = 'Job Hunter could not retrieve the CV because of an unexpected backend error. Try again later.'

function failureMessage(failure: CvFailure): string {
  switch (failure.kind) {
    case 'missing':
      return MISSING_MESSAGE
    case 'unsupported':
      return UNSUPPORTED_MESSAGE
    case 'auth':
      return AUTH_MESSAGE
    case 'unavailable':
      return UNAVAILABLE_MESSAGE
    case 'error':
      return ERROR_MESSAGE
  }
}

function extractionLine(cv: CvText): string {
  switch (cv.extractionStatus) {
    case 'SUCCESS':
      return 'Text extraction: complete'
    case 'EMPTY':
      return 'Text extraction: little or no text could be extracted (for example a scanned, image-only PDF)'
    case 'FAILED':
      return 'Text extraction: failed (the file could not be read as a PDF)'
    default:
      return `Text extraction: ${cv.extractionStatus}`
  }
}

export function formatCv(cv: CvText): string {
  const header = [
    `CV filename: ${cv.fileName}`,
    `Content type: ${cv.contentType}`,
    ...(cv.fileSizeBytes !== null ? [`File size: ${cv.fileSizeBytes} bytes`] : []),
    ...(cv.uploadedAt !== null ? [`Uploaded at: ${cv.uploadedAt}`] : []),
    extractionLine(cv),
    ...(cv.extractionWarning !== null ? [`Extraction warning: ${cv.extractionWarning}`] : []),
    `Original PDF: MCP resource ${CV_RESOURCE_URI} (the exact uploaded file)`,
  ]
  const body =
    cv.extractedText.trim().length > 0
      ? cv.extractedText
      : '(No text could be extracted from this CV. Do not guess its content: ask the user to upload a text-based PDF ' +
        'in Job Hunter, or to share the relevant details.)'
  return `${header.join('\n')}\n\nExtracted CV text:\n\n${body}`
}

export function describeCv(outcome: GetCvOutcome): ToolResult {
  if (outcome.kind === 'cv') {
    return { content: [{ type: 'text', text: formatCv(outcome.cv) }] }
  }
  return { content: [{ type: 'text', text: failureMessage(outcome) }], isError: true }
}

export async function runGetCv(config: Config, fetchImpl: typeof fetch = fetch): Promise<ToolResult> {
  return describeCv(await getCv(config, fetchImpl))
}

/**
 * resources/read of {@link CV_RESOURCE_URI}: the original bytes, base64-encoded as the
 * MCP blob, with the PDF MIME type and the original file name (in _meta). Fetched
 * from the backend on every read, so a replaced CV is served immediately; nothing is
 * written to disk.
 */
export async function readCvResource(config: Config, fetchImpl: typeof fetch = fetch) {
  const outcome = await getCvFile(config, fetchImpl)
  if (outcome.kind !== 'file') {
    if (outcome.kind === 'missing') throw new ResourceNotFoundError(CV_RESOURCE_URI, MISSING_MESSAGE)
    throw new ProtocolError(ProtocolErrorCode.InternalError, failureMessage(outcome))
  }
  return {
    contents: [
      {
        uri: CV_RESOURCE_URI,
        mimeType: CV_PDF_MIME_TYPE,
        blob: Buffer.from(outcome.file.bytes).toString('base64'),
        _meta: { [CV_FILE_NAME_META_KEY]: outcome.file.fileName },
      },
    ],
  }
}
