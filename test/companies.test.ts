import { describe, expect, it, vi } from 'vitest'
import { getCompanies } from '../src/companiesClient.js'
import { runGetCompanies } from '../src/companiesTool.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const text = (result: Awaited<ReturnType<typeof runGetCompanies>>) => result.content.map((c) => c.text).join('\n')

describe('get_companies request', () => {
  it('GETs the integration endpoint with the Bearer token, no body and nothing that selects a user', async () => {
    const fetchMock = respond(200, { companies: [] })
    await getCompanies(config, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/companies')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
  })

  it('uses the configured base URL', async () => {
    const fetchMock = respond(200, { companies: [] })
    await getCompanies({ ...config, baseUrl: 'https://jobs.example.com/hunter' }, fetchMock)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jobs.example.com/hunter/api/integrations/companies')
  })
})

describe('get_companies results', () => {
  it('lists the company names in the backend order', async () => {
    const result = await runGetCompanies(
      config,
      respond(200, { companies: [{ name: 'Acme' }, { name: 'beta Inc' }, { name: 'Zeta Corp' }] }),
    )
    expect(result.isError).toBeUndefined()
    expect(text(result)).toBe('Companies already in Job Hunter (3):\n- Acme\n- beta Inc\n- Zeta Corp')
  })

  it('says so when there are no companies (not an error)', async () => {
    const result = await runGetCompanies(config, respond(200, { companies: [] }))
    expect(result.isError).toBeUndefined()
    expect(text(result)).toBe('No companies exist in Job Hunter yet.')
  })

  it('keeps one company per line and ignores malformed entries', async () => {
    const result = await runGetCompanies(
      config,
      respond(200, { companies: [{ name: 'Multi\nLine  Co' }, { name: '' }, { name: 7 }, null, {}, { name: 'Acme' }] }),
    )
    expect(text(result)).toBe('Companies already in Job Hunter (2):\n- Multi Line Co\n- Acme')
  })

  it('never turns a malformed 200 into "no companies"', async () => {
    for (const body of [{}, { companies: 'Acme' }, { companies: null }, 'not json', '']) {
      const result = await runGetCompanies(config, respond(200, body))
      expect(result.isError).toBe(true)
      expect(text(result)).toBe('Job Hunter could not list the companies because of an unexpected backend error. Try again later.')
    }
  })

  it.each([401, 403])('maps %i to the authentication message', async (status) => {
    const result = await runGetCompanies(config, respond(status, { message: 'whatever' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
    )
  })

  it('maps a network failure to the backend-unavailable message', async () => {
    const result = await runGetCompanies(config, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Could not connect to the local Job Hunter backend. Make sure it is running.')
  })

  it.each([400, 404, 500, 503])('maps an unexpected %i to a generic error without the raw body', async (status) => {
    const result = await runGetCompanies(config, respond(status, 'org.postgresql.util.PSQLException at com.x.Repo jh_SECRET_TOKEN_VALUE'))
    expect(result.isError).toBe(true)
    expect(text(result)).not.toMatch(/PSQL|at com\.|jh_SECRET/)
  })

  it('never leaks the token in any outcome', async () => {
    for (const fetchMock of [
      respond(200, { companies: [{ name: 'Acme' }] }),
      respond(401, { token: 'jh_SECRET_TOKEN_VALUE' }),
      respond(500, 'jh_SECRET_TOKEN_VALUE'),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED jh_SECRET_TOKEN_VALUE')),
    ]) {
      expect(text(await runGetCompanies(config, fetchMock))).not.toContain('jh_SECRET_TOKEN_VALUE')
    }
  })
})
