import { describe, expect, it, vi } from 'vitest'
import { getSearchPrompt } from '../src/searchPromptClient.js'
import { GET_SEARCH_PROMPT_DESCRIPTION, runGetSearchPrompt } from '../src/searchPromptTool.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

/** Free-form text with everything that must survive unchanged. */
const PROMPT = [
  '# Job search — Berlin 🚀',
  '',
  'Find **senior backend** roles that match my CV.',
  '',
  '1. Skip excluded companies.',
  '2. Salary ≥ 85.000 €; remote *or* hybrid.',
  '   - Nested\ttab and  double  spaces',
  '> "Quotes" \\ backslash {braces} <b>not HTML</b>',
  'Windows line\r\nending, Unicode עברית 日本語 👩‍💻, trailing space ',
  '',
  '',
].join('\n')

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const text = (result: Awaited<ReturnType<typeof runGetSearchPrompt>>) => result.content.map((c) => c.text).join('\n')

describe('get_search_prompt request', () => {
  it('GETs the integration endpoint with the Bearer token, no body and nothing that selects a user', async () => {
    const fetchMock = respond(200, { prompt: 'x', updatedAt: null })
    await getSearchPrompt(config, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/search-prompt')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
  })

  it('uses the configured base URL', async () => {
    const fetchMock = respond(200, { prompt: 'x' })
    await getSearchPrompt({ ...config, baseUrl: 'https://jobs.example.com/hunter' }, fetchMock)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jobs.example.com/hunter/api/integrations/search-prompt')
  })
})

describe('get_search_prompt results', () => {
  it('returns the complete prompt verbatim as the only text, with nothing added', async () => {
    const result = await runGetSearchPrompt(config, respond(200, { prompt: PROMPT, updatedAt: '2026-11-23T10:00:00Z' }))

    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: PROMPT }])
  })

  it('never truncates a long prompt', async () => {
    const long = Array.from({ length: 5000 }, (_, i) => `${i + 1}. instruction number ${i + 1}`).join('\n')
    expect(text(await runGetSearchPrompt(config, respond(200, { prompt: long })))).toBe(long)
  })

  it('fetches again on every call, so an edit is returned without restarting', async () => {
    let current = 'Version 1'
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ prompt: current }), { status: 200 }))

    expect(text(await runGetSearchPrompt(config, fetchMock))).toBe('Version 1')
    current = 'Version 2\n\nwith more detail'
    expect(text(await runGetSearchPrompt(config, fetchMock))).toBe('Version 2\n\nwith more detail')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps a 404 with SEARCH_PROMPT_NOT_FOUND to an actionable "no prompt" message', async () => {
    const result = await runGetSearchPrompt(config, respond(404, { status: 404, code: 'SEARCH_PROMPT_NOT_FOUND' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'No search prompt has been configured in Job Hunter yet. Ask the user to write their job-search instructions in ' +
        'Job Hunter (Settings → Job Search → Search Prompt) and save them, or ask them directly what to search for.',
    )
  })

  it('treats a blank prompt as "no prompt"', async () => {
    for (const prompt of ['', '  \n\t ']) {
      const result = await runGetSearchPrompt(config, respond(200, { prompt }))
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('No search prompt has been configured')
    }
  })

  it('maps any other 404 to "backend too old", never to "no prompt"', async () => {
    for (const body of [{ status: 404, message: 'No static resource' }, 'Not Found', '']) {
      const result = await runGetSearchPrompt(config, respond(404, body))
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('does not support search prompts yet')
    }
  })

  it.each([401, 403])('maps %i (invalid, replaced or revoked token) to the authentication message', async (status) => {
    const result = await runGetSearchPrompt(config, respond(status, { message: 'whatever' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.')
  })

  it('maps a network failure to the backend-unavailable message', async () => {
    const result = await runGetSearchPrompt(config, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Could not connect to the local Job Hunter backend. Make sure it is running.')
  })

  it.each([400, 405, 500, 503])('maps an unexpected %i to a generic error without the raw body', async (status) => {
    const result = await runGetSearchPrompt(config, respond(status, 'org.postgresql.util.PSQLException jh_SECRET_TOKEN_VALUE'))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Job Hunter could not retrieve the search prompt because of an unexpected backend error. Try again later.')
  })

  it('never turns a malformed 200 into a prompt', async () => {
    for (const body of [{}, [], 'not json', '', null, { prompt: 42 }, { prompt: ['a'] }, 'Just text']) {
      const result = await runGetSearchPrompt(config, respond(200, body))
      expect(result.isError).toBe(true)
    }
  })

  it('never leaks the token in any outcome', async () => {
    for (const fetchMock of [
      respond(200, { prompt: 'Search' }),
      respond(401, { token: 'jh_SECRET_TOKEN_VALUE' }),
      respond(404, 'jh_SECRET_TOKEN_VALUE'),
      respond(500, 'jh_SECRET_TOKEN_VALUE'),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED jh_SECRET_TOKEN_VALUE')),
    ]) {
      expect(text(await runGetSearchPrompt(config, fetchMock))).not.toContain('jh_SECRET_TOKEN_VALUE')
    }
  })
})

describe('get_search_prompt description', () => {
  it('explains it retrieves the saved instructions for job discovery and does nothing else', () => {
    expect(GET_SEARCH_PROMPT_DESCRIPTION).toMatch(/Retrieve the user's saved Job Hunter search instructions/)
    expect(GET_SEARCH_PROMPT_DESCRIPTION).toMatch(/for use in job discovery/)
    expect(GET_SEARCH_PROMPT_DESCRIPTION).toMatch(/takes no arguments/)
    expect(GET_SEARCH_PROMPT_DESCRIPTION).toMatch(/only retrieves the instructions: it does not search for jobs, add positions or change anything/)
    for (const tool of ['get_cv', 'get_companies', 'get_excluded_companies', 'add_job']) {
      expect(GET_SEARCH_PROMPT_DESCRIPTION).toContain(tool)
    }
  })
})
