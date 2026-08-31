# GitSeek

GitSeek is a web application to search for GitHub repositories and show quick stats like number of stars and forks. It allows linking to the user's GitHub account for access to private repositories and tracks your recently visited repos across sessions.

---

## Tech stack

- Language: JavaScript
- Runtime: Node.js
- Package manager: npm
- Frontend: React 19 + Vite
- Backend: Express 5 + Passport.js (GitHub OAuth2)
- Database: SQLite (via better-sqlite3)

---

## Prerequisites

- Git
- Node.js LTS and npm
- A GitHub OAuth App (see setup below)

---

## GitHub OAuth App setup

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `GitSeek Dev`
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:5000/auth/github/callback`
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret** — you'll need both for your `.env`

---

## Quick start

```bash
# clone
git clone https://github.com/tusiim3/GitSeek.git
cd GitSeek

# install backend dependencies
cd server && npm install && cd ..

# install frontend dependencies
cd git-seek && npm install && cd ..

# create env file
cp .env.example server/.env
# edit server/.env with your values

# run backend (from /server)
cd server && node index.js

# run frontend (from /git-seek, in a separate terminal)
cd git-seek && npm run dev
```

---

## Environment variables

All variables live in `server/.env`. Copy `.env.example` as a starting point.

| Variable | Description | Example |
|---|---|---|
| `PORT` | Port the backend listens on | `5000` |
| `GITHUB_CLIENT_ID` | OAuth App Client ID from GitHub | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret from GitHub | `abc123...` |
| `SESSION_SECRET` | Long random string for signing session cookies | `change-me-to-something-long` |
| `FRONTEND_URL` | URL of the frontend (used for CORS and redirects) | `http://localhost:5173` |
| `BACKEND_URL` | URL of the backend (used to build the OAuth callback URL) | `http://localhost:5000` |
| `NODE_ENV` | Set to `production` in prod to enable secure cookies | `development` |
| `DATABASE_PATH` | Path to the SQLite database file | `./gitseek.db` |

---

## Deploying

The frontend (static) and backend (Node server) deploy separately.

### Frontend — Vercel

1. Import the repo into [Vercel](https://vercel.com)
2. Set the **Root Directory** to `git-seek`
3. Build command: `npm run build` / Output: `dist`
4. Add an environment variable: `VITE_API_URL=https://your-backend-url`
5. Deploy

### Backend — Railway or Render

**Railway:**
1. Create a new project, connect your repo
2. Set the root to `server/`
3. Start command: `node index.js`
4. Add all environment variables from the table above (with production values)
5. Set `NODE_ENV=production`, `BACKEND_URL=https://your-railway-url`, `FRONTEND_URL=https://your-vercel-url`

**Render:**
1. New Web Service, connect your repo
2. Root directory: `server`
3. Build command: `npm install`
4. Start command: `node index.js`
5. Add environment variables as above

### Production GitHub OAuth App

Create a second OAuth App for production (same steps as dev setup), using your real deployed URLs:
- **Homepage URL**: `https://your-frontend-url`
- **Authorization callback URL**: `https://your-backend-url/auth/github/callback`

Use the production app's Client ID and Secret in your hosting platform's environment variables.

### Database persistence

By default the SQLite file (`gitseek.db`) lives in the server directory. On Railway/Render, this resets on each deploy unless you attach a persistent volume. To use a volume, mount it and set `DATABASE_PATH=/mount/path/gitseek.db` in your env vars.

---

## Project structure

```
.
├─ README.md
├─ LICENSE
├─ .env.example
├─ git-seek/
│  ├─ index.html
│  ├─ public/
│  └─ src/
│      ├─ api/
│      │   └─ api.js
│      └─ components/
│          ├─ LoadingSpinner.jsx
│          └─ RememberMeModal.jsx
│      ├─ App.css
│      ├─ App.jsx
│      └─ main.jsx
└─ server/
   ├─ db.js
   └─ index.js
```

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b fix/short-description`
3. Make changes
4. Submit a pull request with a clear description of the change

---

## License

MIT License — see LICENSE file.

## Contact

Name — Tusiime Mark
Email: tusiimejohnmark@gmail.com
