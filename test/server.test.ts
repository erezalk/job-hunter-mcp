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
  it('exposes exactly one tool, add_job, with the Add Job fields and no owner field', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((t) => t.name)).toEqual(['add_job'])

    const schema = tools[0]!.inputSchema as { properties: Record<string, unknown>; required?: string[] }
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
