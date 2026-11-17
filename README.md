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
- **Database:** SQLite via better-sqlite3 (sessions, visit history, recent searches)

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
| `npm test` | Runs the server tests |
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
| `DATABASE_PATH` | no | SQLite file. Relative paths are resolved from `server/` | `./gitseek.db` |
| `PORT` | no | Port the server listens on (most hosts set this) | `5000` |
| `GITHUB_TOKEN` | no | A GitHub token (no scopes needed) used for searches by visitors who aren't logged in | `github_pat_...` |

Without `GITHUB_TOKEN`, all anonymous visitors share GitHub's limit of 10 searches per minute per server IP. Logged-in users always use their own token.

---

## Deploying to Railway

The app deploys as a single Railway service, with a volume so the database survives redeploys.

1. **Create the service:** in [Railway](https://railway.app), go to **New Project → Deploy from GitHub repo** and pick this repo. Leave the root directory as the repo root. Railway runs `npm install` (which installs the server and frontend), then `npm run build`, then `npm start`.
2. **Add a volume:** right-click the service → **Attach volume**, with mount path `/data`.
3. **Get a URL:** under **Settings → Networking**, click **Generate Domain**, e.g. `https://gitseek-production.up.railway.app`.
4. **Create a production OAuth App** (same steps as above) with:
   - **Homepage URL**: your Railway URL
   - **Authorization callback URL**: your Railway URL + `/auth/github/callback`
5. **Set variables** on the service:
   ```
   NODE_ENV=production
   APP_URL=https://<your-domain>.up.railway.app
   GITHUB_CLIENT_ID=<production app client id>
   GITHUB_CLIENT_SECRET=<production app client secret>
   SESSION_SECRET=<long random string>
   DATABASE_PATH=/data/gitseek.db
   GITHUB_TOKEN=<optional>
   ```
   Railway sets `PORT` itself.
6. Redeploy. Search should work right away, and **Link Your GitHub Account** should log you in.

---

## Project structure

```
.
├─ package.json            # root scripts (install, build, start, dev, test)
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
   ├─ db.js                # SQLite tables and queries
   ├─ github.js            # GitHub search query building and API calls
   ├─ sessionStore.js      # encrypted SQLite session store
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
