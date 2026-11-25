# Job Hunter — MCP server

A local **stdio** [MCP](https://modelcontextprotocol.io) server that lets Claude Desktop, Codex and other MCP clients add jobs to a Job Hunter Board, see which companies and positions are already in the account, read the user's CV and read the user's saved job-search instructions. It exposes exactly five tools, `add_job` and the read-only `get_companies`, `get_excluded_companies`, `get_cv` and `get_search_prompt`, plus one read-only resource (the original CV PDF), and talks only to your own Job Hunter backend (`job-hunter-server`). Step-by-step setup: [SETUP.md](SETUP.md). To run Job Hunter itself, use the **Quick Start with Docker** in the `job-hunter-server` README; this server then talks to the Dockerized backend at `http://localhost:8080`.

## How it works

```
Claude Desktop ──stdio──► job-hunter-mcp ──POST /api/integrations/jobs───────► job-hunter-server   (add_job)
                                         ──GET  /api/integrations/companies──►                   (get_companies)
                                         ──GET  /api/integrations/excluded-companies──►          (get_excluded_companies)
                                         ──GET  /api/integrations/cv─────────►                   (get_cv: metadata + extracted text)
                                         ──GET  /api/integrations/cv/file────►                   (resource jobhunter://cv/current.pdf)
                                         ──GET  /api/integrations/search-prompt─►                (get_search_prompt)
                                           Authorization: Bearer jh_…
```

- Claude Desktop starts the server from a `.mcpb` extension; there is no HTTP server inside. stdout carries only the MCP protocol; diagnostics go to stderr.
- The backend authenticates the request with a personal integration token and runs the same "add job and track" logic as the Board's Add Job button: the job is created (or found as a duplicate among that user's own jobs) and lands in **New** on the Board of the user who owns the token; it is never matched against, or attached to, another user's jobs. The tool has no user/owner field, and the job's Source is set to "External AI" by the backend.
- The token is generated in Job Hunter (Settings → Claude / MCP), shown once, and stored server-side only as a SHA-256 digest. A user can have several tokens at once, typically one per client (e.g. "Claude Desktop" and "Codex"), each with an optional name; each one can be renamed, regenerated (new secret, same token) or revoked without affecting the others, and none expires. Each MCP server process uses exactly one token (`JOB_HUNTER_TOKEN`). It is accepted on `/api/integrations/**` only and permits exactly five things: adding a job, reading the account's company names with their job titles, reading the account's excluded company names, reading the account's active CV (extracted text and original PDF), and reading the account's saved search prompt — it cannot read the Board, jobs, other settings or keys, and cannot change the search prompt.
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

Read-only, **no arguments**. Returns the token owner's **Excluded Companies** (Job Hunter: Settings → Job Search) as a plain JSON array of names, e.g. `["PPRO", "Flix", "Example Company"]` (`[]` when nothing is excluded). Claude and Codex are told to skip these companies entirely during job searches, whether or not they already have jobs on the board. The list is a discovery preference only: it never changes the Board and `add_job` is never blocked for an excluded company. It can only be edited in the Job Hunter UI; this server has no tool to change it.

`get_companies` and `get_excluded_companies` answer different questions: the first lists what is already on the board (to avoid duplicate jobs), the second lists companies not to consider at all. The tool descriptions and the server's MCP instructions ask the client to call both before every job search, then search other companies, evaluate positions and add suitable ones with `add_job`.

## The `get_cv` tool and the CV resource

Read-only, **no arguments**. Returns the token owner's **active CV** — the one uploaded, replaced and previewed on Job Hunter's CV page (there is no second copy) — so Claude or Codex can use it as the primary source when evaluating job fit (e.g. for `add_job`'s `fitScore`). It is fetched from the backend on every call, so a replaced CV is returned immediately.

The result is a single text block (nothing else, in particular no base64 PDF):

```
CV filename: Jane_Example_CV.pdf
Content type: application/pdf
File size: 48213 bytes
Uploaded at: 2026-11-23T13:49:14.348174Z
Text extraction: complete
Original PDF: MCP resource jobhunter://cv/current.pdf (the exact uploaded file)

Extracted CV text:

[the complete extracted text, verbatim]
```

- The text is the one Job Hunter extracted with Apache PDFBox when the CV was uploaded (the same text the CV page shows); it is passed on complete and unmodified — never summarised, rewritten or truncated by the server.
- A scanned/image-only PDF (little or no text) or a file that cannot be read as a PDF is reported in the `Text extraction` line, with Job Hunter's warning, and the model is told not to guess the content. No CV uploaded, authentication, connection and backend errors are tool errors (`isError`), worded like the other tools; a backend that predates this feature is reported as such instead of as "no CV".

**The original PDF** is a static MCP resource, `jobhunter://cv/current.pdf` (`resources/list` / `resources/read`). Reading it fetches the current file from the backend and returns the exact uploaded bytes as a base64 `blob` with `mimeType: application/pdf`; the original file name is in the contents' `_meta["dev.erezalkalay.jobhunter/fileName"]` (and in the `get_cv` text). Nothing is written to disk, no URL or local path is exposed, and listing the resource never contacts the backend.

**Client compatibility (verified November 2026).** The extracted text in the normal tool result is the reliable path and works in every MCP client. The PDF resource is standards-compliant, but whether a client hands the PDF to the model as a document is up to the client and is **not** verified for either client:
- **Codex** (0.171) can list and read MCP resources itself (`list_mcp_resources` / `read_mcp_resource`), but there is no evidence it turns a PDF blob into a document for the model; it most likely sees base64. Rely on `get_cv`'s text.
- **Claude Desktop** lets you attach MCP resources manually; there are open reports of PDF blobs from MCP resources being ignored. Rely on `get_cv`'s text.

The PDF is therefore deliberately **not** embedded in the tool result (that would put a large base64 blob into the model's context, and some hosts reject embedded PDF resources in tool results).

Backend endpoints used (bearer token, owner = token user, no parameters): `GET /api/integrations/cv` (JSON: `fileName`, `contentType`, `fileSizeBytes`, `uploadedAt`, `extractionStatus` = `SUCCESS` | `EMPTY` | `FAILED`, `extractionWarning`, `extractedText`) and `GET /api/integrations/cv/file` (`application/pdf`, `Content-Disposition: attachment` with the original name, RFC 5987 encoded). Both answer `404` with `code: "CV_NOT_FOUND"` when no CV was uploaded.

## The `get_search_prompt` tool

Read-only, **no arguments**. Returns the token owner's **Search Prompt** — the free-text job-search instructions written in Job Hunter under **Settings → Job Search → Search Prompt** — as plain text, exactly as saved: every line break, Markdown character and Unicode character is kept, and nothing is added, removed or summarised (the tool result is the prompt and nothing else). It is fetched from the backend on every call and never cached, so an edit saved in the UI is returned on the next call without rebuilding or restarting this server.

The tool only **retrieves** the instructions; it never searches for jobs, adds positions or changes anything. The intended workflow, when you ask your MCP client to run your saved search:

1. `get_search_prompt` — your instructions
2. `get_cv` — your background
3. `get_companies` and `get_excluded_companies` — what is already on the board and what to skip
4. search for positions as the instructions say, verify them and evaluate fit against the CV
5. `add_job` for each qualifying position

No prompt saved yet → a tool error telling the model to ask you to write one in Settings → Job Search → Search Prompt (or to ask you directly). Authentication, connection and backend errors are worded like the other tools; a backend that predates this feature is reported as such. Backend endpoint: `GET /api/integrations/search-prompt` (bearer token, owner = token user, no parameters) returns `{"prompt": "…", "updatedAt": "…"}`, or `404` with `code: "SEARCH_PROMPT_NOT_FOUND"` when none is saved. The prompt can only be edited in the Job Hunter UI; there is no write tool.

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
