import { describe, expect, it, vi } from 'vitest'
import { getExcludedCompanies } from '../src/excludedCompaniesClient.js'
import { GET_EXCLUDED_COMPANIES_DESCRIPTION, runGetExcludedCompanies } from '../src/excludedCompaniesTool.js'
import { GET_COMPANIES_DESCRIPTION } from '../src/companiesTool.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const text = (result: Awaited<ReturnType<typeof runGetExcludedCompanies>>) => result.content.map((c) => c.text).join('\n')

describe('get_excluded_companies request', () => {
  it('GETs the integration endpoint with the Bearer token, no body and nothing that selects a user', async () => {
    const fetchMock = respond(200, [])
    await getExcludedCompanies(config, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/excluded-companies')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
  })

  it('uses the configured base URL', async () => {
    const fetchMock = respond(200, [])
    await getExcludedCompanies({ ...config, baseUrl: 'https://jobs.example.com/hunter' }, fetchMock)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jobs.example.com/hunter/api/integrations/excluded-companies')
  })
})

describe('get_excluded_companies results', () => {
  it('returns a simple JSON array of company names in the backend order', async () => {
    const result = await runGetExcludedCompanies(config, respond(200, ['PPRO', 'Flix', 'Example Company']))
    expect(result.isError).toBeUndefined()
    expect(text(result)).toBe('["PPRO","Flix","Example Company"]')
    expect(JSON.parse(text(result))).toEqual(['PPRO', 'Flix', 'Example Company'])
  })

  it('returns an empty array when nothing is excluded (not an error)', async () => {
    const result = await runGetExcludedCompanies(config, respond(200, []))
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(text(result))).toEqual([])
  })

  it('keeps only non-empty single-line names, each once, dropping anything else', async () => {
    const result = await runGetExcludedCompanies(
      config,
      respond(200, ['Multi\nLine  Co', ' Flix ', 'Flix', '', '   ', 7, null, { name: 'Obj' }, ['Nested']]),
    )
    expect(JSON.parse(text(result))).toEqual(['Multi Line Co', 'Flix'])
  })

  it('never turns a malformed 200 into "nothing excluded"', async () => {
    for (const body of [{}, { companies: [] }, 'not json', '', null, 'Flix']) {
      const result = await runGetExcludedCompanies(config, respond(200, body))
      expect(result.isError).toBe(true)
      expect(text(result)).toBe(
        'Job Hunter could not list the excluded companies because of an unexpected backend error. Try again later.',
      )
    }
  })

  it.each([401, 403])('maps %i to the authentication message', async (status) => {
    const result = await runGetExcludedCompanies(config, respond(status, { message: 'whatever' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
    )
  })

  it('maps a network failure to the backend-unavailable message', async () => {
    const result = await runGetExcludedCompanies(
      config,
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Could not connect to the local Job Hunter backend. Make sure it is running.')
  })

  it.each([400, 404, 405, 500, 503])('maps an unexpected %i to a generic error without the raw body', async (status) => {
    const result = await runGetExcludedCompanies(
      config,
      respond(status, 'org.postgresql.util.PSQLException at com.x.Repo jh_SECRET_TOKEN_VALUE'),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).not.toMatch(/PSQL|at com\.|jh_SECRET/)
  })

  it('never leaks the token in any outcome', async () => {
    for (const fetchMock of [
      respond(200, ['Flix']),
      respond(401, { token: 'jh_SECRET_TOKEN_VALUE' }),
      respond(500, 'jh_SECRET_TOKEN_VALUE'),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED jh_SECRET_TOKEN_VALUE')),
    ]) {
      expect(text(await runGetExcludedCompanies(config, fetchMock))).not.toContain('jh_SECRET_TOKEN_VALUE')
    }
  })
})

describe('discovery guidance in the tool descriptions', () => {
  it('get_excluded_companies says to skip these companies and to call both tools before searching', () => {
    expect(GET_EXCLUDED_COMPANIES_DESCRIPTION).toMatch(/skipped entirely during job searches/)
    expect(GET_EXCLUDED_COMPANIES_DESCRIPTION).toMatch(/Call BOTH get_companies and get_excluded_companies before every job search/)
    expect(GET_EXCLUDED_COMPANIES_DESCRIPTION).toMatch(/regardless of whether they already have jobs on the board/)
    expect(GET_EXCLUDED_COMPANIES_DESCRIPTION).toMatch(/add_job still works/)
  })

  it('get_companies explains it is about duplicates, not exclusion', () => {
    expect(GET_COMPANIES_DESCRIPTION).toMatch(/already on the user's Job Hunter board, used to avoid duplicate jobs/)
    expect(GET_COMPANIES_DESCRIPTION).toMatch(/get_excluded_companies/)
  })
})
