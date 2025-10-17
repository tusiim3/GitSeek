# GitSeek

GitSeek is a web application to search for GitHub repositories and show quick stats like number of stars and forks. It allows linking to the user's GitHub account for access to private repositories.

---

## Tech stack

- Language: JavaScript
- Runtime: Node.js
- Package manager: npm

---

## Prerequisites

- Git (to clone and create test repos)
- Node.js LTS and npm
- GitHub Personal Access Token (PAT)

---

## Quick start

```bash
# clone
git clone https://github.com/tusiim3/GitSeek.git
cd GitSeek

# install
npm install

# create env file
cp .env.example .env   # edit .env

# run
npm start

# run tests
npm test
```

---

## Project structure

.
├─ README.md
├─ LICENSE
├─ git-seek/
│  ├─ index.html
│  ├─ public/ 
│  └─ src/ 
│      ├─ api/
│      │   └─ api.js
│      └─ components/
│          ├─ LoadingSpinner.css
│          ├─ LoadingSpinner.jsx
│          ├─ RememberMeModal.css
│          └─ RememberMeModal.jsx
│      ├─ App.css
│      ├─ App.jsx
│      └─ main.jsx                       
└─ server/
   └─ index.js

---

## Contributing

If you accept contributions:
1. Fork the repo
2. Create a branch: `git checkout -b fix/short-description`
3. Make changes and add tests
4. Submit a pull request with a clear description of the change

I welcome issues and small PRs — please keep changes focused.

---

## License

MIT License — see LICENSE file.

## Contact

Name — Tusiime Mark
Email: tusiimejohnmark@gmail.com
