# Cross-Platform Reader

Cross-Platform Reader is a private, invite-only web library for PDF and ePub
books. It supports reading progress, bookmarks, highlights, reader settings,
search, offline browser caching, and data export.

The repository can run with either of these backends:

- **Firebase** for managed hosting, Authentication, Firestore, and Storage.
- **Docker local** for one VPS or NAS using SQLite and a persistent uploads
  directory. This mode does not require a Firebase account.

Both modes enforce membership and per-user ownership on the server or security
rules. The first release is intentionally private; it does not publish a
shared catalogue. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for setup and
backup instructions.

## Quick start

```bash
cd reader-app
npm ci
cp env-example .env.local
npm run dev
```

Set the Firebase values in `.env.local` for Firebase mode. For local mode, use
the root Docker Compose files and set a random `SESSION_SECRET`; no Firebase
configuration is required. Never copy an operator's `.env.local`, service
account key, database, book file, or backup into this repository.

## Firebase deployment

Create your own Firebase project, enable the authentication providers you want,
create Firestore and Storage, add the web app values to the deployment
environment, and deploy the rules, indexes, and hosting configuration. Replace
the project placeholder in `.firebaserc` locally. Configure Storage CORS for
your own domain. Firebase web configuration identifies your app; Admin SDK
credentials remain server-side and private.

## Development and security

Run `npm run lint`, `npm run typecheck`, and `npm run build` in `reader-app/`.
Rules and backend tests cover cross-user access. Please read [SECURITY.md](SECURITY.md)
before reporting a vulnerability and [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. The project is released under the MIT license.
