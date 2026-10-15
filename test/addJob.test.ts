import { describe, expect, it, vi } from 'vitest'
import { addJob } from '../src/addJobClient.js'
import { runAddJob } from '../src/addJobTool.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const text = (result: Awaited<ReturnType<typeof runAddJob>>) => result.content.map((c) => c.text).join('\n')

describe('add_job request mapping', () => {
  it('POSTs only the Add Job fields with the Bearer token and no owner field', async () => {
    const fetchMock = respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New' })
    await addJob(
      config,
      {
        title: 'Dev',
        companyName: 'Acme',
        location: undefined,
        salaryMin: 100,
        // A caller smuggling extra fields must not get them forwarded.
        ...({ userId: 7, email: 'a@b.c' } as object),
      },
      fetchMock,
    )

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://localhost:8080/api/integrations/jobs')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jh_SECRET_TOKEN_VALUE')
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'Dev', companyName: 'Acme', salaryMin: 100 })
  })
})

describe('add_job evaluation fields', () => {
  it('forwards the optional evaluation fields and never a source or owner', async () => {
    const fetchMock = respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New' })
    await addJob(
      config,
      {
        title: 'Dev',
        fitScore: 0,
        matchingSkills: ['Java'],
        missingSkills: [],
        concerns: undefined,
        evaluationModel: 'Claude Opus 5.5',
        ...({ source: 'Manual', userId: 7 } as object),
      },
      fetchMock,
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      title: 'Dev',
      fitScore: 0,
      matchingSkills: ['Java'],
      missingSkills: [],
      evaluationModel: 'Claude Opus 5.5',
    })
  })

  it('sends exactly the old payload when no evaluation is supplied', async () => {
    const fetchMock = respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New' })
    await addJob(config, { title: 'Dev', companyName: 'Acme' }, fetchMock)
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ title: 'Dev', companyName: 'Acme' })
  })

  it('reports the imported fit concisely, and nothing extra when none was imported', async () => {
    const withFit = await runAddJob(
      config,
      { title: 'Dev', fitScore: 92 },
      respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New', importedFitScore: 92 }),
    )
    expect(text(withFit)).toBe('Added: Dev - Acme. Status: New. Imported fit: 92%.')

    const withoutFit = await runAddJob(
      config,
      { title: 'Dev' },
      respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New', importedFitScore: null }),
    )
    expect(text(withoutFit)).toBe('Added: Dev - Acme. Status: New.')
  })

  it('does not claim an imported fit for a duplicate', async () => {
    const result = await runAddJob(
      config,
      { title: 'Dev', fitScore: 92 },
      respond(200, { created: false, title: 'Dev', companyName: 'Acme', importedFitScore: null }),
    )
    expect(text(result)).toBe('Job was not added because it already exists. (Dev - Acme)')
  })

  it('surfaces the backend explanation when evaluation fields are inconsistent', async () => {
    const result = await runAddJob(
      config,
      { title: 'Dev', matchingSkills: ['Java'] },
      respond(400, { message: 'fitScore is required when matchingSkills, missingSkills, concerns or evaluationModel are provided.', fieldErrors: [] }),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('fitScore is required when matchingSkills')
  })
})

describe('add_job results', () => {
  it('reports success concisely', async () => {
    const result = await runAddJob(config, { title: 'Dev' }, respond(201, { created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New' }))
    expect(result.isError).toBeUndefined()
    expect(text(result)).toBe('Added: Dev - Acme. Status: New.')
  })

  it('reports a duplicate (backend 200, created=false) as a friendly non-error', async () => {
    const result = await runAddJob(config, { title: 'Dev' }, respond(200, { created: false, title: 'Dev', companyName: 'Acme' }))
    expect(result.isError).toBeUndefined()
    expect(text(result)).toContain('Job was not added because it already exists.')
  })

  it('reports validation problems from the backend field errors', async () => {
    const result = await runAddJob(
      config,
      { title: '' },
      respond(400, { message: 'Validation failed', fieldErrors: [{ field: 'title', message: 'must not be blank' }] }),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('title: must not be blank')
  })

  it.each([401, 403])('maps %i to the authentication message', async (status) => {
    const result = await runAddJob(config, { title: 'Dev' }, respond(status, { message: 'whatever' }))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
    )
  })

  it('maps a network failure to the backend-unavailable message', async () => {
    const result = await runAddJob(config, { title: 'Dev' }, vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    expect(result.isError).toBe(true)
    expect(text(result)).toBe('Could not connect to the local Job Hunter backend. Make sure it is running.')
  })

  it('hides raw backend bodies, stack traces and the token on unexpected errors', async () => {
    const result = await runAddJob(
      config,
      { title: 'Dev' },
      respond(500, 'org.postgresql.util.PSQLException at com.x.Repo jh_SECRET_TOKEN_VALUE'),
    )
    expect(result.isError).toBe(true)
    expect(text(result)).not.toMatch(/PSQL|at com\.|jh_SECRET/)
  })

  it('never leaks the token in any outcome', async () => {
    for (const fetchMock of [
      respond(401, { token: 'jh_SECRET_TOKEN_VALUE' }),
      respond(400, { fieldErrors: [] }),
      respond(500, 'jh_SECRET_TOKEN_VALUE'),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED jh_SECRET_TOKEN_VALUE')),
    ]) {
      expect(text(await runAddJob(config, { title: 'Dev' }, fetchMock))).not.toContain('jh_SECRET_TOKEN_VALUE')
    }
  })
})
