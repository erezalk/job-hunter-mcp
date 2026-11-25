import { describe, expect, it, vi } from 'vitest'
import { fileNameFromContentDisposition, getCv, getCvFile } from '../src/cvClient.js'
import { CV_RESOURCE_URI, GET_CV_DESCRIPTION, readCvResource, runGetCv } from '../src/cvTool.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

const CV_TEXT = [
  'Jane Example - Senior Backend Engineer',
  'Berlin, Germany',
  '',
  'Experience',
  '• Led the payments platform migration to event sourcing.',
  '  Indented line with  double  spaces',
  'Skills: Java 25, Spring Boot, PostgreSQL',
].join('\n')

const cvBody = {
  fileName: 'Jane_Example_CV.pdf',
  contentType: 'application/pdf',
  fileSizeBytes: 48213,
  uploadedAt: '2026-11-23T13:49:14.123Z',
  extractionStatus: 'SUCCESS',
  extractionWarning: null,
  extractedText: CV_TEXT,
}

function respond(status: number, body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }),
  )
}

// Not valid text in any encoding on purpose: every byte value, so any re-encoding would corrupt it.
const PDF_BYTES = new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...Array.from({ length: 256 }, (_, i) => i), ...Buffer.from('\n%%EOF')])

function respondPdf(bytes: Uint8Array = PDF_BYTES, disposition = "attachment; filename=\"Jane_Example_CV.pdf\"; filename*=UTF-8''Jane_Example_CV.pdf") {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition } }),
  )
}

const text = (result: Awaited<ReturnType<typeof runGetCv>>) => result.content.map((c) => c.text).join('\n')

describe('get_cv request', () => {
  it('GETs the integration endpoint with the Bearer token, no body and nothing that selects a user', async () => {
    const fetchMock = respond(200, cvBody)
    await getCv(config, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/cv')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
  })

  it('uses the configured base URL for both the text and the file', async () => {
    const base = { ...config, baseUrl: 'https://jobs.example.com/hunter' }
    const textMock = respond(200, cvBody)
    await getCv(base, textMock)
    expect(textMock.mock.calls[0]![0]).toBe('https://jobs.example.com/hunter/api/integrations/cv')

    const fileMock = respondPdf()
    await getCvFile(base, fileMock)
    expect(fileMock.mock.calls[0]![0]).toBe('https://jobs.example.com/hunter/api/integrations/cv/file')
  })
})

describe('get_cv results', () => {
  it('returns the structured header followed by the complete extracted text, verbatim', async () => {
    const result = await runGetCv(config, respond(200, cvBody))

    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    expect(text(result)).toBe(
      [
        'CV filename: Jane_Example_CV.pdf',
        'Content type: application/pdf',
        'File size: 48213 bytes',
        'Uploaded at: 2026-11-23T13:49:14.123Z',
        'Text extraction: complete',
        `Original PDF: MCP resource ${CV_RESOURCE_URI} (the exact uploaded file)`,
        '',
        'Extracted CV text:',
        '',
        CV_TEXT,
      ].join('\n'),
    )
  })

  it('never truncates a long CV', async () => {
    const long = Array.from({ length: 2000 }, (_, i) => `Line ${i}: achievement number ${i} with details.`).join('\n')
    const result = await runGetCv(config, respond(200, { ...cvBody, extractedText: long }))
    expect(text(result).endsWith(long)).toBe(true)
  })

  it('never puts the PDF bytes (base64) into the tool result', async () => {
    const fetchMock = respond(200, cvBody)
    const result = await runGetCv(config, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the file endpoint is not called at all
    expect(JSON.stringify(result)).not.toMatch(/JVBERi0|base64|"blob"/)
  })

  it('reports a CV without extractable text with its warning, without inventing content', async () => {
    const result = await runGetCv(
      config,
      respond(200, { ...cvBody, extractionStatus: 'EMPTY', extractionWarning: 'Little or no text could be extracted.', extractedText: '' }),
    )
    expect(result.isError).toBeUndefined()
    const value = text(result)
    expect(value).toContain('Text extraction: little or no text could be extracted')
    expect(value).toContain('Extraction warning: Little or no text could be extracted.')
    expect(value).toContain('Do not guess its content')
    expect(value).toContain(`Original PDF: MCP resource ${CV_RESOURCE_URI}`)
  })

  it('reports a file that could not be read as a PDF', async () => {
    const result = await runGetCv(
      config,
      respond(200, { ...cvBody, extractionStatus: 'FAILED', extractionWarning: 'Could not read this file.', extractedText: '' }),
    )
    expect(text(result)).toContain('Text extraction: failed (the file could not be read as a PDF)')
  })

  it('maps a 404 with CV_NOT_FOUND to the no-CV message', async () => {
    const result = await runGetCv(config, respond(404, { status: 404, message: 'No active CV', code: 'CV_NOT_FOUND' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'No CV has been uploaded to Job Hunter yet. Ask the user to upload their CV in Job Hunter (CV page), then call get_cv again.',
    )
  })

  it('maps any other 404 to "backend too old", never to "no CV"', async () => {
    for (const body of [{ status: 404, message: 'No static resource' }, 'Not Found', '']) {
      const result = await runGetCv(config, respond(404, body))
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('does not support CV retrieval yet')
    }
  })

  it.each([401, 403])('maps %i to the authentication message', async (status) => {
    const result = await runGetCv(config, respond(status, { message: 'whatever' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.')
  })

  it('maps a network failure to the backend-unavailable message', async () => {
    const result = await runGetCv(config, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Could not connect to the local Job Hunter backend. Make sure it is running.')
  })

  it.each([400, 405, 500, 503])('maps an unexpected %i to a generic error without the raw body', async (status) => {
    const result = await runGetCv(config, respond(status, 'java.io.UncheckedIOException at dev.x /data/cv-storage/1.pdf jh_SECRET_TOKEN_VALUE'))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Job Hunter could not retrieve the CV because of an unexpected backend error. Try again later.')
  })

  it('never turns a malformed 200 into an empty CV', async () => {
    for (const body of [{}, [], 'not json', '', null, { fileName: 'cv.pdf', extractionStatus: 'SUCCESS' }, { extractedText: 'x' }]) {
      const result = await runGetCv(config, respond(200, body))
      expect(result.isError).toBe(true)
    }
  })

  it('never leaks the token in any outcome', async () => {
    for (const fetchMock of [
      respond(200, cvBody),
      respond(401, { token: 'jh_SECRET_TOKEN_VALUE' }),
      respond(404, 'jh_SECRET_TOKEN_VALUE'),
      respond(500, 'jh_SECRET_TOKEN_VALUE'),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED jh_SECRET_TOKEN_VALUE')),
    ]) {
      expect(text(await runGetCv(config, fetchMock))).not.toContain('jh_SECRET_TOKEN_VALUE')
    }
  })
})

describe('CV PDF resource', () => {
  it('returns the exact original bytes as a base64 blob with the PDF MIME type and the original file name', async () => {
    const fetchMock = respondPdf()
    const result = await readCvResource(config, fetchMock)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/cv/file')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
    // JSON stays acceptable so the backend can still send its JSON error bodies (e.g. 404 CV_NOT_FOUND).
    expect((init?.headers as Record<string, string>).Accept).toBe('application/pdf, application/json;q=0.9')
    expect(result.contents).toHaveLength(1)
    const [contents] = result.contents
    expect(contents!.uri).toBe(CV_RESOURCE_URI)
    expect(contents!.mimeType).toBe('application/pdf')
    expect(contents!._meta).toEqual({ 'dev.erezalkalay.jobhunter/fileName': 'Jane_Example_CV.pdf' })
    expect(new Uint8Array(Buffer.from(contents!.blob, 'base64'))).toEqual(PDF_BYTES)
  })

  it('decodes a non-ASCII file name from filename*', async () => {
    const result = await readCvResource(
      config,
      respondPdf(PDF_BYTES, "attachment; filename=\"=?UTF-8?Q?R=C3=A9sum=C3=A9.pdf?=\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20J%C3%B6rg%20%E2%80%93%202026.pdf"),
    )
    expect(result.contents[0]!._meta).toEqual({ 'dev.erezalkalay.jobhunter/fileName': 'Résumé Jörg – 2026.pdf' })
  })

  it('throws "resource not found" when no CV was uploaded', async () => {
    await expect(readCvResource(config, respond(404, { code: 'CV_NOT_FOUND' }))).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('No CV has been uploaded'),
    })
  })

  it.each([
    ['auth', respond(401, {}), 'authentication failed'],
    ['unavailable', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')), 'Could not connect'],
    ['backend error', respond(500, 'boom jh_SECRET_TOKEN_VALUE'), 'unexpected backend error'],
    ['not a PDF', respond(200, '<html>proxy</html>', { 'Content-Type': 'text/html' }), 'unexpected backend error'],
  ])('throws a protocol error without the token for %s', async (_name, fetchMock, message) => {
    const error = await readCvResource(config, fetchMock).then(
      () => new Error('expected a rejection'),
      (e: unknown) => e as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toBe('expected a rejection')
    expect(error.message).toContain(message)
    expect(error.message).not.toContain('jh_SECRET_TOKEN_VALUE')
  })
})

describe('Content-Disposition parsing', () => {
  it.each([
    ["attachment; filename=\"cv.pdf\"; filename*=UTF-8''My%20CV.pdf", 'My CV.pdf'],
    ['attachment; filename="My \\"quoted\\" CV.pdf"', 'My "quoted" CV.pdf'],
    ['inline; filename=plain.pdf', 'plain.pdf'],
    ["attachment; filename*=utf-8''%E2%82%AC.pdf", '€.pdf'],
    ["attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%E2%82", 'fallback.pdf'],
    ['attachment; filename="=?UTF-8?Q?R=C3=A9sum=C3=A9.pdf?="', null],
    ['attachment', null],
    [null, null],
  ])('%s -> %s', (header, expected) => {
    expect(fileNameFromContentDisposition(header)).toBe(expected)
  })
})

describe('get_cv description', () => {
  it('tells the model to use the CV as the primary source and never invent content', () => {
    expect(GET_CV_DESCRIPTION).toMatch(/takes no arguments/)
    expect(GET_CV_DESCRIPTION).toMatch(/COMPLETE text extracted from the PDF, verbatim/)
    expect(GET_CV_DESCRIPTION).toMatch(/primary source of the user's professional background/)
    expect(GET_CV_DESCRIPTION).toMatch(/Never invent/)
    expect(GET_CV_DESCRIPTION).toContain(CV_RESOURCE_URI)
  })
})
