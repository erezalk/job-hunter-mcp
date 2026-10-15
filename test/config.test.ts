import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('defaults the base URL to the local backend', () => {
    expect(loadConfig({ JOB_HUNTER_TOKEN: 'jh_x' })).toEqual({ baseUrl: 'http://localhost:8080', token: 'jh_x' })
  })

  it('uses the configured base URL and strips trailing slashes', () => {
    expect(loadConfig({ JOB_HUNTER_BASE_URL: 'https://jobs.example.com/', JOB_HUNTER_TOKEN: 'jh_x' }).baseUrl).toBe(
      'https://jobs.example.com',
    )
  })

  it('treats an unfilled Claude Desktop placeholder as missing', () => {
    expect(() => loadConfig({ JOB_HUNTER_TOKEN: '${user_config.token}' })).toThrow(ConfigError)
    expect(loadConfig({ JOB_HUNTER_BASE_URL: '${user_config.base_url}', JOB_HUNTER_TOKEN: 'jh_x' }).baseUrl).toBe(
      'http://localhost:8080',
    )
  })

  it.each([undefined, '', '   '])('rejects a missing token (%j)', (token) => {
    expect(() => loadConfig({ JOB_HUNTER_TOKEN: token })).toThrow(/JOB_HUNTER_TOKEN is not set/)
  })

  it('rejects an invalid base URL without echoing the token', () => {
    const attempt = () => loadConfig({ JOB_HUNTER_BASE_URL: 'not a url', JOB_HUNTER_TOKEN: 'jh_secret' })
    expect(attempt).toThrow(/JOB_HUNTER_BASE_URL/)
    expect(attempt).not.toThrow(/jh_secret/)
  })

  it('rejects non-http base URLs', () => {
    expect(() => loadConfig({ JOB_HUNTER_BASE_URL: 'ftp://x', JOB_HUNTER_TOKEN: 'jh_x' })).toThrow(/http/)
  })
})
