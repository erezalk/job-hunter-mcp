# Job Hunter — MCP server

A local **stdio** [MCP](https://modelcontextprotocol.io) server that lets Claude Desktop add jobs to a Job Hunter Board and see which companies and positions are already in the account. It exposes exactly three tools, `add_job` and the read-only `get_companies` and `get_excluded_companies`, and talks only to your own Job Hunter backend (`job-hunter-server`). Step-by-step setup: [SETUP.md](SETUP.md). To run Job Hunter itself, use the **Quick Start with Docker** in the `job-hunter-server` README; this server then talks to the Dockerized backend at `http://localhost:8080`.

## How it works

```
Claude Desktop ──stdio──► job-hunter-mcp ──POST /api/integrations/jobs───────► job-hunter-server   (add_job)
                                         ──GET  /api/integrations/companies──►                   (get_companies)
                                         ──GET  /api/integrations/excluded-companies──►          (get_excluded_companies)
                                           Authorization: Bearer jh_…
```

- Claude Desktop starts the server from a `.mcpb` extension; there is no HTTP server inside. stdout carries only the MCP protocol; diagnostics go to stderr.
- The backend authenticates the request with a personal integration token and runs the same "add job and track" logic as the Board's Add Job button: the job is created (or found as a duplicate among that user's own jobs) and lands in **New** on the Board of the user who owns the token; it is never matched against, or attached to, another user's jobs. The tool has no user/owner field, and the job's Source is set to "External AI" by the backend.
- The token is generated in Job Hunter (Settings → Claude / MCP), shown once, and stored server-side only as a SHA-256 digest. A user can have several tokens at once, typically one per client (e.g. "Claude Desktop" and "Codex"), each with an optional name; each one can be renamed, regenerated (new secret, same token) or revoked without affecting the others, and none expires. Each MCP server process uses exactly one token (`JOB_HUNTER_TOKEN`). It is accepted on `/api/integrations/**` only and permits exactly three things: adding a job, reading the account's company names with their job titles, and reading the account's excluded company names — it cannot read the Board, jobs, CV, settings or keys.
- The server holds no validation, normalization or duplicate rules of its own; the backend decides. Results are returned to Claude as short text: for `add_job` added, already exists (not an error), validation problems, authentication failed, backend unreachable, or unexpected error; `get_companies` returns the companies with their positions as JSON, or the authentication / unreachable / unexpected-error messages. Raw backend responses and the token are never returned or logged.

## The `add_job` tool

| Field | Notes |
|---|---|
| `title` | Required |
| `companyName`, `description`, `location`, `workModel`, `url`, `salaryMin`, `salaryMax`, `currency` | Optional; the tool description tells Claude to omit anything it does not actually know |
| `fitScore` | Optional integer 0–100 — an evaluation Claude has already made against the user's CV |
| `matchingSkills`, `missingSkills`, `concerns` | Optional lists; only together with `fitScore` (`missingSkills` is shown as "Gaps") |
| `evaluationModel` | Optional model name; only together with `fitScore` |

An evaluation is stored as an **External AI** match on the new ticket. Job Hunter does not call its own AI provider for it and does not apply the Low Match threshold — the job stays in New. It is only stored for a newly created ticket (a duplicate never gets its match overwritten). **Re-evaluate** in the ticket later replaces it with the configured provider's result and applies the normal threshold rule.

## The `get_companies` tool

Read-only, **no arguments**. Returns the companies on the token owner's Job Hunter board, each once with the titles of all its job positions (no title repeated), sorted alphabetically (case-insensitive), whatever the status of the jobs (New, in progress, Offer, Rejected, Archived, Low Match). Nothing else is returned: no ids, URLs, statuses, scores or other users' data, and the tool cannot choose a user. It exists so that during job discovery Claude can identify companies already on the board and avoid rediscovering positions that are already there; the tool does no filtering itself — Claude decides what to exclude from your request.

Example result (the tool returns this JSON as text):

```json
[
  {
    "company": "N26",
    "positions": [
      "Senior Backend Engineer"
    ]
  },
  {
    "company": "Scalable Capital",
    "positions": [
      "Senior Java Backend Engineer",
      "Senior Kotlin Developer"
    ]
  }
]
```

An empty account gives `[]`. Authentication, connection and backend errors are reported as tool errors in the same wording as `add_job`.

## The `get_excluded_companies` tool

Read-only, **no arguments**. Returns the token owner's **Excluded Companies** (Job Hunter: Settings → Job Discovery) as a plain JSON array of names, e.g. `["PPRO", "Flix", "Example Company"]` (`[]` when nothing is excluded). Claude and Codex are told to skip these companies entirely during job searches, whether or not they already have jobs on the board. The list is a discovery preference only: it never changes the Board and `add_job` is never blocked for an excluded company. It can only be edited in the Job Hunter UI; this server has no tool to change it.

`get_companies` and `get_excluded_companies` answer different questions: the first lists what is already on the board (to avoid duplicate jobs), the second lists companies not to consider at all. The tool descriptions and the server's MCP instructions ask the client to call both before every job search, then search other companies, evaluate positions and add suitable ones with `add_job`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `JOB_HUNTER_BASE_URL` | `http://localhost:8080` | Job Hunter backend URL |
| `JOB_HUNTER_TOKEN` | *(required)* | Integration token (`jh_…`) |

In Claude Desktop both come from the extension settings (the token field is marked sensitive and kept in the OS secure storage). A local `.env` (copy `.env.example`) is only a convenience for development runs such as the MCP Inspector.

## Building the extension

Normal users do not need Node.js or npm: Docker builds `job-hunter-mcp.mcpb` for you (the file is not committed to Git).

```bash
docker build -f Dockerfile.pack --output type=local,dest=. .
```

Claude Desktop runs the installed extension itself; see [SETUP.md](SETUP.md) for the host requirements.

## Development

Requires Node.js 20+ (contributors only).

```bash
npm install
npm run typecheck
npm run lint
npm test          # tool registration, request mapping, result text, no token leak, real stdio run
npm run build     # bundles src/ into bundle/server/index.js (esbuild, no runtime node_modules)
npm run pack      # build + pack bundle/ into job-hunter-mcp.mcpb
npm run inspect   # build + MCP Inspector against the bundled server (uses .env)
```

`bundle/manifest.json` is the extension manifest (keep its `version` in sync with `package.json` and `src/server.ts`). `bundle/server/` and `*.mcpb` are build output and are not committed.
