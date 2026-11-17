# GitSeek

GitSeek is a web app for searching GitHub repositories, with quick stats such as stars, forks and language. Linking your GitHub account adds:

- **Private repositories** in your search results
- **Your own search limit** instead of one shared by every anonymous visitor
- **Recent searches**: your last 10 searches, with their filters, one click away
- **Jump Back In**: the repositories you opened most recently, kept across logins

---

## Tech stack

- **Frontend:** React 19 + Vite
- **Backend:** Node.js, Express 5, Passport.js (GitHub OAuth)
- **Database:** SQLite (local development) or Postgres (production, e.g. Neon), chosen by `DATABASE_URL`. Both store sessions, visit history, recent searches and the remember-me prompt.

The backend also serves the built frontend, so the whole app runs as **one service on one URL**. In development, Vite proxies `/api` and `/auth` to the backend, so it behaves the same way.

---

## Prerequisites

- Node.js **22 or newer** and npm
- A GitHub OAuth App (see below)

---

## GitHub OAuth App setup

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `GitSeek Dev`
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:5173/auth/github/callback`
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret** for your `.env`

> GitSeek asks for the `repo` scope so private repositories can appear in search. GitHub has no read-only version of this scope for OAuth apps, so the consent screen mentions full access. GitSeek only uses it to run searches.

---

## Quick start

```bash
git clone https://github.com/tusiim3/GitSeek.git
cd GitSeek

# installs the root, server and frontend dependencies
npm install

# create the env file, then fill in your values
cp .env.example server/.env
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run the backend and frontend in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173.

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Runs the server tests (add `TEST_DATABASE_URL=postgres://…` to also test Postgres) |
| `npm run lint` | Lints the frontend |
| `npm run build` | Builds the frontend into `git-seek/dist` |
| `npm start` | Runs the server, which also serves the built frontend |

---

## Environment variables

Variables live in `server/.env` locally, or in your host's settings in production. `.env.example` is a starting point.

| Variable | Required | Description | Example |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | yes | OAuth App Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | yes | OAuth App Client Secret | `abc123...` |
| `SESSION_SECRET` | yes | Long random string. Signs cookies and encrypts stored sessions; changing it logs everyone out | `3f9c...` |
| `APP_URL` | in production | Public URL of the app, used for the OAuth callback | `http://localhost:5173` |
| `NODE_ENV` | in production | `production` enables secure cookies and proxy support | `development` |
| `DATABASE_URL` | in production | Postgres connection string. Leave empty to use SQLite instead | `postgresql://user:pass@host/db?sslmode=require` |
| `DATABASE_PATH` | no | SQLite file, used when `DATABASE_URL` is empty. Relative paths are resolved from `server/` | `./gitseek.db` |
| `PORT` | no | Port the server listens on (most hosts set this) | `5000` |
| `GITHUB_TOKEN` | no | Fine-grained GitHub token used for searches by visitors who aren't logged in (see below) | `github_pat_...` |

**Database:** with `DATABASE_URL` empty, the server uses the SQLite file at `DATABASE_PATH`, so local development needs no setup. With `DATABASE_URL` set, it uses Postgres and creates its tables on startup.

The server reads env files in this order, and the first one to set a variable wins: real environment variables (e.g. on Render), then `.env.local` at the repo root (written by the Neon CLI), then `server/.env`. To use SQLite while a `.env.local` exists, run with an empty value:

```bash
DATABASE_URL= npm run dev:server
```

**`GITHUB_TOKEN`:** without it, all anonymous visitors share GitHub's limit of 10 searches per minute for the server's IP. Logged-in users always use their own token. To create one:

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. Give it a name (e.g. `GitSeek search`) and an **expiration** (e.g. 90 days; set a reminder to renew it)
3. **Repository access:** *Public repositories (read-only)*
4. **Permissions:** leave everything at *No access*
5. Generate it and put it **only** in your host's environment variables (Render), never in the repo or `.env.example`

---

## Deploying for free (Render + Neon + UptimeRobot)

The app runs as one free **Render** web service, which serves both the API and the built frontend. Render's free disk is wiped on every deploy and restart, so data lives in a free **Neon** Postgres database. Render's free services sleep after 15 minutes without traffic, so a free **UptimeRobot** monitor pings `/api/health` every 5 minutes to keep it awake.

### 1. Neon (database)

This repo is already linked to a Neon project via `neon.ts`, managed with the [Neon CLI](https://neon.com/docs/cli). The link itself (`.neon`) and the pulled secrets (`.env.local`) are gitignored.

**Your own project:** sign up at [neon.tech](https://neon.tech) and create a project in the region closest to your Render region. Then, from the repo root:

```bash
npm i -g neon@latest
```

```bash
neon login
```

```bash
neon init -y --project-id <your-project-id> --branch production --services postgres
```

```bash
neon deploy
```

`neon deploy` applies `neon.ts` to the branch and writes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) to `.env.local`, which the server loads automatically. Run `neon env pull` later to refresh them.

**For Render, use the pooled `DATABASE_URL`** (its host contains `-pooler`). Copy it from `.env.local`, or from the Neon Console under **Connect** with *Connection pooling* on. GitSeek uses `node-postgres` (`pg`) with a connection pool, which is what Neon recommends for a long-running server like this. The unpooled URL is only needed for tools like `pg_dump`, or for running the Postgres tests (`TEST_DATABASE_URL`), which set a per-connection schema that the pooler doesn't support.

The connection string ends in `sslmode=require`. `pg` treats that as full certificate checking and prints a one-time notice about it; change it to `sslmode=verify-full` if you'd rather not see the notice.

GitSeek creates its tables automatically on first start. Neon pauses the database when it's idle and wakes it on the next query, so the first request after a quiet spell can take a second longer. The health check deliberately doesn't touch the database, so it doesn't keep Neon awake.

### 2. Render (web service)

1. Sign up at [render.com](https://render.com) and click **New → Web Service**, then connect this GitHub repo.
2. Settings:
   - **Branch:** `main`
   - **Root Directory:** leave blank
   - **Runtime / Language:** Node
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
   - **Health Check Path** (under Advanced): `/api/health`
3. **Environment variables:**
   ```
   NODE_ENV=production
   APP_URL=https://<your-app>.onrender.com
   GITHUB_CLIENT_ID=<production OAuth app client id>
   GITHUB_CLIENT_SECRET=<production OAuth app client secret>
   SESSION_SECRET=<long random string>
   DATABASE_URL=<Neon connection string>
   GITHUB_TOKEN=<optional fine-grained token>
   ```
   Render sets `PORT` itself, and the Node version comes from `engines` in `package.json`. Your `onrender.com` URL appears once the service is created. If you don't have it yet, set `APP_URL` afterwards and redeploy.
4. Deploy. The logs should show `Server started` with `database: "postgres"`.

### 3. GitHub OAuth app (production)

Create a second OAuth app (same steps as the dev one above) with:
- **Homepage URL:** `https://<your-app>.onrender.com`
- **Authorization callback URL:** `https://<your-app>.onrender.com/auth/github/callback`

Put its Client ID and Secret in Render's environment variables, then redeploy.

### 4. UptimeRobot (keep it awake)

1. Sign up at [uptimerobot.com](https://uptimerobot.com) and click **Add New Monitor**.
2. **Monitor type:** HTTP(s)
3. **URL:** `https://<your-app>.onrender.com/api/health`
4. **Monitoring interval:** 5 minutes
5. Create the monitor. It should show *Up*, and you'll get an email if the app goes down.

Render's free plan includes 750 instance hours a month, enough for one service running all month.

---

## Project structure

```
.
├─ package.json            # root scripts (install, build, start, dev, test)
├─ neon.ts                 # Neon project policy, applied with `neon deploy`
├─ .env.example
├─ assets/original/        # full-resolution source images (not served)
├─ git-seek/               # React frontend
│  ├─ index.html
│  ├─ vite.config.js       # dev proxy to the backend
│  ├─ public/
│  └─ src/
│     ├─ api/api.js        # calls to the backend
│     ├─ components/       # LoadingSpinner, RememberMeModal
│     ├─ App.jsx
│     └─ App.css
└─ server/                 # Express backend
   ├─ index.js             # starts the server
   ├─ app.js               # routes, auth and static file serving
   ├─ config.js            # loads and checks environment variables
   ├─ db/
   │  ├─ index.js          # picks Postgres (DATABASE_URL) or SQLite; shared interface
   │  ├─ sqlite.js         # SQLite tables and queries (local dev)
   │  ├─ postgres.js       # Postgres tables and queries (production)
   │  └─ shared.js         # limits and helpers used by both
   ├─ github.js            # GitHub search query building and API calls
   ├─ sessionStore.js      # encrypted session store on top of db/
   └─ test/                # node:test suites
```

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b fix/short-description`
3. Make your changes and run `npm test` and `npm run lint`
4. Open a pull request with a clear description of the change

---

## License

MIT License. See the LICENSE file.

## Contact

Name: Tusiime Mark
Email: tusiimejohnmark@gmail.com
