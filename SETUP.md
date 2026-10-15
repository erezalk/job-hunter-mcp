# Job Hunter + Claude Desktop: setup

Goal: ask Claude Desktop to "add these jobs to my Job Hunter Board" and see them appear in the **New** column of your Board.

Paths below assume the three repositories (`job-hunter-server`, `job-hunter-web`, `job-hunter-mcp`) are cloned side by side in one folder.

## 1. Start Job Hunter

```bash
# PostgreSQL (Docker must be running)
cd job-hunter-server
docker compose up -d

# Backend on http://localhost:8080
./mvnw spring-boot:run

# Frontend on http://localhost:5173 (in another terminal; needed to manage the token and see the Board)
cd job-hunter-web
npm install
npm run dev
```

## 2. Generate a token

1. Open http://localhost:5173 and log in.
2. Go to **Settings → Claude / MCP** and click **Generate token**.
3. Click **Copy**. The token starts with `jh_` and is shown **only once**; if you lose it, generate a new one.

Jobs added with this token go to the Board of the account that generated it. The token does not expire; it works until you revoke it or generate a new one.

## 3. Build the extension

```bash
cd job-hunter-mcp
npm install
npm run pack        # creates job-hunter-mcp.mcpb in this folder
```

Node.js 20+ is only needed for building; Claude Desktop runs the extension itself.

## 4. Install it in Claude Desktop

1. Open the `.mcpb` file with Claude Desktop (double-click it, drag it into the window, or use the extension install option in Claude Desktop's settings).
2. When asked, enter:
   - **Job Hunter backend URL**: `http://localhost:8080`
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

## What must be running

| Component | Needed for `add_job` |
|---|---|
| PostgreSQL (`docker compose`) | Yes |
| Backend (port 8080) | Yes |
| Frontend (`npm run dev`) | Only to manage the token or look at the Board |
| job-hunter-mcp | Started by Claude Desktop |

## Revoking

Settings → Claude / MCP → **Revoke token** (or **Generate new token**, which also invalidates the old one). Takes effect immediately; enter the new token in the extension settings if you generated one.

## Troubleshooting

- **"Could not connect to the local Job Hunter backend."** — start the database and backend; check the URL and port in the extension settings. If `localhost` does not work, try `http://127.0.0.1:8080` (the backend listens on IPv4 localhost only).
- **"Job Hunter authentication failed…"** — the token is missing, revoked or replaced; generate a new one and update the extension settings.
- **Extension fails to start / tool missing** — Claude Desktop's developer/extension settings show the server status and logs; a missing token is reported as `JOB_HUNTER_TOKEN is not set`. Start a new chat after installing.
- **"Job Hunter rejected the job: …"** — the backend's normal Add Job validation applied (e.g. a URL must start with `http://` or `https://`).
- **Testing without Claude Desktop** — `cp .env.example .env`, set `JOB_HUNTER_TOKEN`, then `npm run inspect` to use the official MCP Inspector. Never commit `.env`.
