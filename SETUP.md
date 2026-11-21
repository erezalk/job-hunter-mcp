# Job Hunter + Claude Desktop: setup

Goal: ask Claude Desktop to "add these jobs to my Job Hunter Board" and see them appear in the **New** column of your Board.

Paths below assume the three repositories (`job-hunter-server`, `job-hunter-web`, `job-hunter-mcp`) are cloned side by side in one folder.

**Host requirements for normal use: Git, Docker Desktop and Claude Desktop. No Java, Maven, Node.js, npm or PostgreSQL.**

## 1. Start Job Hunter

Follow **Quick Start with Docker** in the `job-hunter-server` README. In short:

```bash
cd job-hunter-server
docker compose up --build        # web UI: http://localhost:3000, backend API: http://localhost:8080
```

Contributors who run the backend/frontend from source instead should use "Manual development" in the same README.

## 2. Generate a token

1. Open http://localhost:3000 (Docker setup; `http://localhost:5173` with the manual dev server) and log in.
2. Go to **Settings → Claude / MCP**, optionally enter a name such as `Claude Desktop`, and click **Generate token**.
3. Click **Copy**. The token starts with `jh_` and is shown **only once**; if you lose it, use **Regenerate** on that token to get a new secret.

Jobs added with this token go to the Board of the account that generated it, and `get_companies` lists that account's companies with their positions. The token does not expire; it works until you revoke or regenerate it.

You can have several tokens at the same time. Give each client its own (for example one named `Claude Desktop` and one named `Codex`): renaming, regenerating or revoking one token never affects the others.

## 3. Build the extension

The `.mcpb` file is build output and is not committed to Git, so you build it once. With Docker, no Node.js or npm is needed on your machine:

```bash
cd job-hunter-mcp
docker build -f Dockerfile.pack --output type=local,dest=. .    # creates job-hunter-mcp.mcpb in this folder
```

Contributors with Node.js 20+ can use `npm install && npm run pack` instead (same result).

Node.js is **not** needed to run the extension: it is a self-contained bundle (`server/index.js`, no `node_modules`) that Claude Desktop starts itself. The manifest declares a `node` server, which Claude Desktop runs with the Node.js runtime it ships with, according to the MCPB specification. This has not been verified on a computer without Node.js installed; if Claude Desktop ever reports that Node.js is missing, install Node.js 20+ as a fallback.

## 4. Install it in Claude Desktop

1. Open the `.mcpb` file with Claude Desktop (double-click it, drag it into the window, or use the extension install option in Claude Desktop's settings).
2. When asked, enter:
   - **Job Hunter backend URL**: `http://localhost:8080` (the backend port the Docker stack publishes on your machine; if you changed `API_HOST_PORT`, use that port)
   - **Job Hunter integration token**: the token from step 2
3. Make sure the extension is enabled, then start a new chat.

The token is stored by Claude Desktop in the OS secure storage; you never paste it into a chat. To change it later, open the extension's settings in Claude Desktop.

To update after rebuilding, install the new `.mcpb` over the existing extension (same name, higher version); the saved settings are normally kept. Start a new chat afterwards.

## 5. Try it

> Add this job to my Job Hunter Board: "TEST Backend Engineer" at "TEST Company".

Expected reply: `Added: TEST Backend Engineer - TEST Company. Status: New.` Asking again gives `Job was not added because it already exists.` Delete the test ticket from the Board afterwards.

With an evaluation:

> Compare this posting with my CV and add it to my Job Hunter Board, including your fit score, matching skills and gaps.

The ticket's **AI match** section then shows the score labelled **External AI** (plus the model name if Claude passed one), and Source shows External AI. Job Hunter does not re-evaluate it and does not move a low score to Low Match; **Re-evaluate** in the ticket replaces it with Job Hunter's configured provider result.

To see which companies you already have (useful to avoid them during job discovery):

> List the companies I already have in Job Hunter, then find me new backend roles at other companies.

Claude calls `get_companies` (read-only, no arguments), which returns every company on your board with the titles of its positions, regardless of job status, and uses them to exclude companies or positions itself.

To skip companies in every job search, add them in Job Hunter under **Settings → Job Discovery → Excluded Companies**. Claude calls `get_excluded_companies` (read-only, no arguments) together with `get_companies` before searching and leaves those companies out. This never changes your Board, and you can still add a job at an excluded company yourself (or ask Claude to add a specific one).

## What must be running

| Component | Needed for `add_job`, `get_companies` and `get_excluded_companies` |
|---|---|
| Docker stack (`docker compose up`) | Yes: the `backend` and `postgres` containers |
| `web` container (http://localhost:3000) | Only to manage the token, edit Excluded Companies or look at the Board |
| job-hunter-mcp | Started by Claude Desktop |

(Manual development: PostgreSQL, the backend on port 8080 and optionally the frontend.)

## Other MCP clients (e.g. Codex)

Any MCP client that can start a local stdio server can use the same server with **its own token**. Build once (`npm install && npm run build` creates `bundle/server/index.js`; or unpack it from `job-hunter-mcp.mcpb`, which is a zip archive), then configure the client to run `node /absolute/path/to/server/index.js` with the environment variables `JOB_HUNTER_BASE_URL` (e.g. `http://localhost:8080`) and `JOB_HUNTER_TOKEN` (a token generated for that client). For Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.job-hunter]
command = "node"
args = ["/absolute/path/to/job-hunter-mcp/bundle/server/index.js"]
env = { JOB_HUNTER_BASE_URL = "http://localhost:8080", JOB_HUNTER_TOKEN = "jh_..." }
```

## Revoking and regenerating

Settings → Claude / MCP lists your active tokens. Each one has **Revoke** (deletes it) and **Regenerate** (keeps its name, issues a new secret and invalidates the old one); both ask for confirmation, take effect immediately and affect only that token. After regenerating, enter the new secret in the settings of the client that used it.

## Troubleshooting

- **"Could not connect to the local Job Hunter backend."** — make sure the Docker stack is running (`docker compose ps` in `job-hunter-server`, backend `healthy`); check the URL and port in the extension settings. If `localhost` does not work, try `http://127.0.0.1:8080` (the backend is published on IPv4 localhost only).
- **"Job Hunter authentication failed…"** — the token is missing, revoked or regenerated; check Settings → Claude / MCP (the list shows the last 4 characters of each token), regenerate or generate a token and update the client's settings.
- **Extension fails to start / tool missing** — Claude Desktop's developer/extension settings show the server status and logs; a missing token is reported as `JOB_HUNTER_TOKEN is not set`. Start a new chat after installing.
- **"Job Hunter rejected the job: …"** — the backend's normal Add Job validation applied (e.g. a URL must start with `http://` or `https://`).
- **Testing without Claude Desktop** — `cp .env.example .env`, set `JOB_HUNTER_TOKEN`, then `npm run inspect` to use the official MCP Inspector. Never commit `.env`.
