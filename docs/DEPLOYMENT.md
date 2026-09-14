# Deployment guide

Cross-Platform Reader supports two deployment modes. Both are private libraries
by default: operators provision accounts and users can only access their own
books and reading data.

## Docker local mode

Use this mode on one VPS or NAS. It does not require a Firebase account.

```bash
cd reader-app
cp .env.example .env
docker compose up -d --build
docker compose exec -T reader npm run local:user -- create you@example.com --password-stdin
```

Set a long random `SESSION_SECRET`, `APP_ORIGIN`, and persistent paths in
`.env`. Mount the data volume and expose the app through HTTPS (for example,
the included Caddy profile). Keep the SQLite and uploads volumes private and
back them up together using the documented backup command. This mode is
single-instance; do not run multiple application replicas against one SQLite
file.

## Firebase mode

Create a new Firebase project, enable Email/Password or Google Authentication,
create Firestore and Storage, and register a web app. Copy the values from
`reader-app/env-example` into the deployment environment. Do not copy any
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

For Docker, stop writes, create a consistent SQLite backup and copy the uploads
directory in the same snapshot. Test restoring into an empty volume before
removing the source. For Firebase, use provider exports and retain Firestore
and Storage retention policies. Offline browser copies remain on the device
after a server-side deletion.
