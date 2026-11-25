import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { Client } from '@modelcontextprotocol/client'
import { beforeAll, describe, expect, it } from 'vitest'

// Runs the real bundled server over real stdio, exactly like Claude Desktop does.
describe('bundled stdio server', () => {
  beforeAll(() => {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' })
  }, 60_000)

  it('starts, initializes and lists add_job, get_companies, get_excluded_companies, get_cv, get_search_prompt and the CV resource; stdout stays pure protocol', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['bundle/server/index.js'],
      env: { PATH: process.env.PATH ?? '', JOB_HUNTER_BASE_URL: 'http://localhost:1', JOB_HUNTER_TOKEN: 'jh_x' },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(transport)
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['add_job', 'get_companies', 'get_excluded_companies', 'get_cv', 'get_search_prompt'])
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual(['jobhunter://cv/current.pdf'])

    const result = await client.callTool({ name: 'add_job', arguments: { title: 'Dev' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Could not connect to the local Job Hunter backend')

    const companies = await client.callTool({ name: 'get_companies', arguments: {} })
    expect(companies.isError).toBe(true)
    expect(JSON.stringify(companies.content)).toContain('Could not connect to the local Job Hunter backend')

    const excluded = await client.callTool({ name: 'get_excluded_companies', arguments: {} })
    expect(excluded.isError).toBe(true)
    expect(JSON.stringify(excluded.content)).toContain('Could not connect to the local Job Hunter backend')

    const cv = await client.callTool({ name: 'get_cv', arguments: {} })
    expect(cv.isError).toBe(true)
    expect(JSON.stringify(cv.content)).toContain('Could not connect to the local Job Hunter backend')
    await expect(client.readResource({ uri: 'jobhunter://cv/current.pdf' })).rejects.toThrow(/Could not connect/)

    const prompt = await client.callTool({ name: 'get_search_prompt', arguments: {} })
    expect(prompt.isError).toBe(true)
    expect(JSON.stringify(prompt.content)).toContain('Could not connect to the local Job Hunter backend')
    await client.close()
  }, 30_000)

  it('exits with a clear stderr message and no stdout when the token is missing', () => {
    let stdout = ''
    let stderr = ''
    try {
      execFileSync('node', [resolve('bundle/server/index.js')], {
        env: { PATH: process.env.PATH ?? '' },
        cwd: '/tmp',
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      const e = err as { stdout: string; stderr: string; status: number }
      stdout = e.stdout
      stderr = e.stderr
      expect(e.status).toBe(1)
    }
    expect(stdout).toBe('')
    expect(stderr).toContain('JOB_HUNTER_TOKEN is not set')
  })
})
