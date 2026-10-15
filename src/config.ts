export interface Config {
  baseUrl: string
  token: string
}

export class ConfigError extends Error {}

// Claude Desktop leaves an unfilled ${user_config.x} placeholder literally in the env.
const isUnset = (value: string | undefined): value is undefined =>
  value === undefined || value.trim() === '' || value.includes('${')

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rawBase = isUnset(env.JOB_HUNTER_BASE_URL) ? 'http://localhost:8080' : env.JOB_HUNTER_BASE_URL!.trim()
  const token = env.JOB_HUNTER_TOKEN
  if (isUnset(token)) {
    throw new ConfigError(
      'JOB_HUNTER_TOKEN is not set. Generate a token in Job Hunter (Settings -> Claude / MCP) and enter it in the extension settings.',
    )
  }

  let url: URL
  try {
    url = new URL(rawBase)
  } catch {
    throw new ConfigError('JOB_HUNTER_BASE_URL is not a valid URL (example: http://localhost:8080).')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('JOB_HUNTER_BASE_URL must start with http:// or https://.')
  }
  return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), token: token.trim() }
}
