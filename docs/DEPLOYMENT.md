# Deployment guide

Cross-Platform Reader supports two deployment modes. Both are private libraries
by default: operators provision accounts and users can only access their own
books and reading data.

## Docker local mode

Use this mode on one VPS or NAS. It does not require a Firebase account. The
default Compose ports bind to `127.0.0.1`; set `READER_BIND_ADDRESS=0.0.0.0`
only when a trusted reverse proxy or firewall policy is in place. The optional
Caddy profile also binds to loopback by default. Set
`READER_PROXY_BIND_ADDRESS=0.0.0.0` when Caddy is the public HTTPS endpoint.

```bash
cd reader-app
cp .env.example .env
docker compose up -d --build
docker compose exec -T reader npm run local:user -- create you@example.com --password-stdin
```

Set a long random `SESSION_SECRET`, `APP_ORIGIN`, and persistent paths in
`.env`. Mount the data volume and expose the app through HTTPS (for example,
the included Caddy profile). Keep the SQLite and uploads volumes private. This
mode is single-instance; do not run multiple application replicas against one
SQLite file.

## Firebase mode

Create a new Firebase project, enable Email/Password or Google Authentication,
create Firestore and Storage, and register a web app. Copy the values from
`reader-app/.env.example` into the deployment environment. Do not copy any
`.env.local` from another installation.

From `reader-app/`, install the Firebase CLI and deploy rules, indexes, and
hosting/App Hosting using your own project. Replace the project placeholder in
`.firebaserc` locally (it is intentionally not committed with an owner's
project ID). Configure the Storage CORS origin to your own HTTPS domain and
localhost during development. Install `firebase-admin` only on the
administrator machine, set `GOOGLE_APPLICATION_CREDENTIALS` to a private
service-account key, and run `node scripts/firebase-members.mjs approve FIREBASE_UID`
to add the first member. The key must never enter the browser bundle, Docker
image, or repository.

Firebase web configuration values identify an app and are not service-account
secrets. Service-account keys belong only on the operator's admin machine and
must never be placed in the browser bundle, Docker image, or repository.

## Backups and upgrades

For Docker, stop the application before a backup or restore. The backup command
uses SQLite's backup API and copies the private `files/` tree with a manifest.
Store the destination outside the Docker data volume.

On Linux, first create the backup directory and give the container's `node`
user (UID 1000) access: `sudo install -d -m 700 -o 1000 -g 1000 backups`.
An automatically created, root-owned bind mount is not writable by the reader.

```bash
docker compose stop reader
docker compose run --rm --no-deps -v "$PWD/backups:/backup" reader \
  npm run local:backup -- backup /backup/reader-$(date +%F)
```

Restore only to an empty data volume. The command rejects a non-empty target or
a database and file tree that do not match the manifest.

```bash
docker compose down -v
docker compose run --rm --no-deps -v "$PWD/backups:/backup:ro" reader \
  npm run local:backup -- restore /backup/reader-2026-09-15
docker compose up -d
```

Test the restore in an empty volume before removing the backup source. For
Firebase, use provider exports and retain Firestore and Storage retention
policies. Offline browser copies remain on the device after a server-side
deletion.
