import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../src/server.js'

const config = { baseUrl: 'http://localhost:8080', token: 'jh_SECRET_TOKEN_VALUE' }

async function connect(fetchImpl: typeof fetch = fetch) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createServer(config, fetchImpl).connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return client
}

describe('MCP server', () => {
  it('exposes exactly five tools: add_job and the read-only get_companies, get_excluded_companies, get_cv and get_search_prompt', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((t) => t.name)).toEqual(['add_job', 'get_companies', 'get_excluded_companies', 'get_cv', 'get_search_prompt'])
  })

  it('reports the server version', async () => {
    expect((await connect()).getServerVersion()).toEqual({ name: 'job-hunter', version: '1.5.1' })
  })

  it('tells the client get_search_prompt only retrieves the saved instructions', async () => {
    const instructions = (await connect()).getInstructions()
    expect(instructions).toMatch(/call get_search_prompt and follow the instructions it returns/)
    expect(instructions).toMatch(/get_search_prompt only retrieves the instructions and never acts on its own/)
  })

  it('registers get_search_prompt as a read-only tool that takes no arguments', async () => {
    const { tools } = await (await connect()).listTools()
    const tool = tools.find((t) => t.name === 'get_search_prompt')!

    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tool.description).toMatch(/saved Job Hunter search instructions/)
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties ?? {})).toEqual([])
    expect(schema.required ?? []).toEqual([])
  })

  it('returns the saved prompt verbatim through a normal get_search_prompt call, re-fetched on every call', async () => {
    let prompt = '# Search\n\n1. Java roles in Berlin\n2. Skip agencies'
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ prompt, updatedAt: null }), { status: 200 }))
    const client = await connect(fetchMock)

    const first = await client.callTool({ name: 'get_search_prompt', arguments: {} })
    expect(first.isError).toBeFalsy()
    expect(first.content).toEqual([{ type: 'text', text: '# Search\n\n1. Java roles in Berlin\n2. Skip agencies' }])
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/api/integrations/search-prompt')

    prompt = 'Updated in the UI'
    const second = await client.callTool({ name: 'get_search_prompt', arguments: {} })
    expect(second.content).toEqual([{ type: 'text', text: 'Updated in the UI' }])
    // Retrieving the prompt never calls anything else (no search, no add_job).
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      'http://localhost:8080/api/integrations/search-prompt',
      'http://localhost:8080/api/integrations/search-prompt',
    ])
  })

  it('reports a missing prompt, authentication and backend failures from get_search_prompt as tool errors', async () => {
    const cases: [Response, string][] = [
      [new Response(JSON.stringify({ code: 'SEARCH_PROMPT_NOT_FOUND' }), { status: 404 }), 'No search prompt has been configured'],
      [new Response('{}', { status: 401 }), 'Job Hunter authentication failed'],
      [new Response('boom', { status: 500 }), 'could not retrieve the search prompt'],
    ]
    for (const [response, message] of cases) {
      const client = await connect(vi.fn<typeof fetch>().mockResolvedValue(response))
      const result = await client.callTool({ name: 'get_search_prompt', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(message)
    }
  })

  it('tells the client to use get_cv as the source for fit evaluation', async () => {
    expect((await connect()).getInstructions()).toMatch(/call get_cv and use its extracted CV text as the primary source/)
  })

  it('registers get_cv as a read-only tool that takes no arguments', async () => {
    const { tools } = await (await connect()).listTools()
    const tool = tools.find((t) => t.name === 'get_cv')!

    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tool.description).toMatch(/primary source of the user's professional background/)
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties ?? {})).toEqual([])
    expect(schema.required ?? []).toEqual([])
  })

  it('returns the CV header and full extracted text through a normal get_cv tool call', async () => {
    const cv = {
      fileName: 'Jane_Example_CV.pdf', contentType: 'application/pdf', fileSizeBytes: 1234, uploadedAt: '2026-11-23T10:00:00Z',
      extractionStatus: 'SUCCESS', extractionWarning: null, extractedText: 'Jane Example\nSenior Backend Engineer\nJava, Spring',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(cv), { status: 200 }))
    const client = await connect(fetchMock)
    const result = await client.callTool({ name: 'get_cv', arguments: {} })

    expect(result.isError).toBeFalsy()
    const content = result.content as { type: string; text: string }[]
    expect(content).toHaveLength(1)
    expect(content[0]!.type).toBe('text')
    expect(content[0]!.text).toMatch(/^CV filename: Jane_Example_CV\.pdf\nContent type: application\/pdf\n/)
    expect(content[0]!.text).toMatch(/\n\nExtracted CV text:\n\nJane Example\nSenior Backend Engineer\nJava, Spring$/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/api/integrations/cv')
  })

  it('reports missing CVs, authentication and backend failures from get_cv as tool errors', async () => {
    const cases: [Response, string][] = [
      [new Response(JSON.stringify({ code: 'CV_NOT_FOUND' }), { status: 404 }), 'No CV has been uploaded'],
      [new Response('{}', { status: 401 }), 'Job Hunter authentication failed'],
      [new Response('boom', { status: 500 }), 'could not retrieve the CV'],
    ]
    for (const [response, message] of cases) {
      const client = await connect(vi.fn<typeof fetch>().mockResolvedValue(response))
      const result = await client.callTool({ name: 'get_cv', arguments: {} })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(message)
    }
  })

  it('lists the original CV PDF as an MCP resource and serves its exact bytes via resources/read', async () => {
    const pdf = new Uint8Array([...Buffer.from('%PDF-1.4\n'), 0, 1, 2, 253, 254, 255, ...Buffer.from('%%EOF')])
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(pdf, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename*=UTF-8''Jane_Example_CV.pdf" },
      }),
    )
    const client = await connect(fetchMock)

    const { resources } = await client.listResources()
    expect(resources).toEqual([
      expect.objectContaining({ uri: 'jobhunter://cv/current.pdf', name: 'cv', mimeType: 'application/pdf' }),
    ])
    expect(fetchMock).not.toHaveBeenCalled() // listing never touches the backend

    const read = await client.readResource({ uri: 'jobhunter://cv/current.pdf' })
    const contents = read.contents[0] as { uri: string; mimeType: string; blob: string; _meta: Record<string, unknown> }
    expect(contents.uri).toBe('jobhunter://cv/current.pdf')
    expect(contents.mimeType).toBe('application/pdf')
    expect(contents._meta['dev.erezalkalay.jobhunter/fileName']).toBe('Jane_Example_CV.pdf')
    expect(new Uint8Array(Buffer.from(contents.blob, 'base64'))).toEqual(pdf)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/api/integrations/cv/file')
  })

  it('answers resources/read with an error when there is no CV or the token is rejected', async () => {
    const missing = await connect(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 'CV_NOT_FOUND' }), { status: 404 })))
    await expect(missing.readResource({ uri: 'jobhunter://cv/current.pdf' })).rejects.toThrow(/No CV has been uploaded/)

    const unauthorized = await connect(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(unauthorized.readResource({ uri: 'jobhunter://cv/current.pdf' })).rejects.toThrow(/authentication failed/)
  })

  it('tells the client to call both read-only tools before searching for jobs', async () => {
    const instructions = (await connect()).getInstructions()
    expect(instructions).toMatch(/always call get_companies .* and get_excluded_companies/)
    expect(instructions).toMatch(/add_job is never blocked for an excluded company/)
  })

  it('registers get_excluded_companies as a read-only tool that takes no arguments', async () => {
    const { tools } = await (await connect()).listTools()
    const tool = tools.find((t) => t.name === 'get_excluded_companies')!

    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tool.description).toMatch(/skipped entirely during job searches/)
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties ?? {})).toEqual([])
    expect(schema.required ?? []).toEqual([])
  })

  it('offers no tool that edits the exclusion list', async () => {
    const { tools } = await (await connect()).listTools()
    const writeTools = tools.filter((t) => /exclu/i.test(t.name) && t.name !== 'get_excluded_companies')
    expect(writeTools).toEqual([])
  })

  it('calls the excluded-companies endpoint through get_excluded_companies and returns the names', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(['PPRO', 'Flix', 'Example Company']), { status: 200 }))
    const client = await connect(fetchMock)
    const result = await client.callTool({ name: 'get_excluded_companies', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: '["PPRO","Flix","Example Company"]' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/api/integrations/excluded-companies')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET')
  })

  it('reports authentication and backend failures from get_excluded_companies as tool errors', async () => {
    const unauthorized = await connect(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))
    const auth = await unauthorized.callTool({ name: 'get_excluded_companies', arguments: {} })
    expect(auth.isError).toBe(true)
    expect(JSON.stringify(auth.content)).toContain('Job Hunter authentication failed')

    const failing = await connect(vi.fn<typeof fetch>().mockResolvedValue(new Response('boom', { status: 500 })))
    const error = await failing.callTool({ name: 'get_excluded_companies', arguments: {} })
    expect(error.isError).toBe(true)
    expect(JSON.stringify(error.content)).toContain('could not list the excluded companies')
  })

  it('does not block add_job for an excluded company', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/excluded-companies')
        ? new Response(JSON.stringify(['Flix']), { status: 200 })
        : new Response(JSON.stringify({ created: true, title: 'Dev', companyName: 'Flix', statusLabel: 'New' }), { status: 201 }),
    )
    const client = await connect(fetchMock)
    await client.callTool({ name: 'get_excluded_companies', arguments: {} })
    const result = await client.callTool({ name: 'add_job', arguments: { title: 'Dev', companyName: 'Flix' } })

    expect(result.content).toEqual([{ type: 'text', text: 'Added: Dev - Flix. Status: New.' }])
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:8080/api/integrations/jobs')
  })

  it('registers get_companies as a read-only tool that takes no arguments', async () => {
    const { tools } = await (await connect()).listTools()
    const tool = tools.find((t) => t.name === 'get_companies')!

    expect(tool.annotations?.readOnlyHint).toBe(true)
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties ?? {})).toEqual([])
    expect(schema.required ?? []).toEqual([])
  })

  it('calls the companies endpoint through get_companies and returns each company with its positions', async () => {
    const companies = [
      { company: 'Acme', positions: ['Backend Engineer', 'Platform Engineer'] },
      { company: 'Beta', positions: ['Java Developer'] },
    ]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(companies), { status: 200 }))
    const client = await connect(fetchMock)
    const result = await client.callTool({ name: 'get_companies', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(companies, null, 2) }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/api/integrations/companies')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET')
  })

  it('reports authentication failures from get_companies as a tool error', async () => {
    const client = await connect(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })))
    const result = await client.callTool({ name: 'get_companies', arguments: {} })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Job Hunter authentication failed')
  })

  it('keeps add_job with the Add Job fields and no owner field', async () => {
    const { tools } = await (await connect()).listTools()
    const addJobTool = tools.find((t) => t.name === 'add_job')!

    const schema = addJobTool.inputSchema as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        'companyName', 'concerns', 'currency', 'description', 'evaluationModel', 'fitScore', 'location',
        'matchingSkills', 'missingSkills', 'salaryMax', 'salaryMin', 'title', 'url', 'workModel',
      ].sort(),
    )
    // Only the title is required; every evaluation field is optional and Source is not exposed at all.
    expect(schema.required).toEqual(['title'])
    for (const forbidden of ['userId', 'user', 'username', 'email', 'password', 'owner', 'token', 'source']) {
      expect(schema.properties).not.toHaveProperty(forbidden)
    }
  })

  it('calls the backend through the tool and returns the friendly text', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New' }), { status: 201 }),
    )
    const client = await connect(fetchMock)
    const result = await client.callTool({ name: 'add_job', arguments: { title: 'Dev', companyName: 'Acme' } })

    expect(result.content).toEqual([{ type: 'text', text: 'Added: Dev - Acme. Status: New.' }])
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ title: 'Dev', companyName: 'Acme' })
  })

  it('maps the optional evaluation fields to the backend request and reports the imported fit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ created: true, title: 'Dev', companyName: 'Acme', statusLabel: 'New', importedFitScore: 92 }),
        { status: 201 },
      ),
    )
    const client = await connect(fetchMock)
    const args = {
      title: 'Dev',
      companyName: 'Acme',
      fitScore: 92,
      matchingSkills: ['Java', '5+ years of Java (10+ years total)'],
      missingSkills: ['Kubernetes'],
      concerns: ['On-call'],
      evaluationModel: 'Claude Opus 5.5',
    }
    const result = await client.callTool({ name: 'add_job', arguments: args })

    expect(result.content).toEqual([{ type: 'text', text: 'Added: Dev - Acme. Status: New. Imported fit: 92%.' }])
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual(args)
  })

  it.each([
    ['above 100', { fitScore: 101 }],
    ['below 0', { fitScore: -1 }],
    ['fractional', { fitScore: 92.5 }],
    ['non-numeric', { fitScore: 'high' }],
    ['non-array skills', { fitScore: 50, matchingSkills: 'Java' }],
  ])('rejects an invalid fitScore/list (%s) before touching the backend', async (_name, extra) => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = await connect(fetchMock)
    const result = await client
      .callTool({ name: 'add_job', arguments: { title: 'Dev', ...extra } })
      .catch((e: unknown) => ({ isError: true, e }))
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a call without a title before touching the backend', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = await connect(fetchMock)
    const result = await client.callTool({ name: 'add_job', arguments: {} }).catch((e: unknown) => ({ isError: true, e }))
    expect(result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
