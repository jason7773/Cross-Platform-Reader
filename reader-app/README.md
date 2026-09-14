# Reader app

Next.js reader for PDF and ePub files. Firebase is the managed backend; the
local Docker backend uses SQLite and private files under `READER_DATA_DIR`.

## Firebase development

```bash
cp env-example .env.local
npm ci
npm run dev
```

Fill in the Firebase values with your own project. The committed `.firebaserc`
is intentionally empty. Deploy rules and indexes only after creating your own
project and approving the first member with the admin script.

## Docker local deployment

From this directory, copy `.env.example` to `.env`, set a random session secret
if using a custom environment, and run:

```bash
docker compose -f compose.yaml up -d --build
npm run local:user -- create you@example.com --password-stdin
```

The local API is under `/api/v1`. It enforces sessions, CSRF checks, member
status, per-user ownership, upload limits, and private file responses. Use one
application instance per SQLite volume.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

See the repository deployment and security documents for HTTPS, backups,
Firebase CORS, and credential handling.
