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
For either route, `APP_ORIGIN` must exactly match the URL used in the browser,
including scheme and port. Otherwise authenticated write requests are rejected
as cross-origin.

```bash
cd reader-app
cp .env.example .env
docker compose up -d --build
read -rsp "New password (at least 12 characters): " READER_PASSWORD && printf '\n'
printf '%s' "$READER_PASSWORD" | docker compose exec -T reader npm run local:user -- create you@example.com --password-stdin
unset READER_PASSWORD
```

Set a long random `SESSION_SECRET`, `APP_ORIGIN`, and persistent paths in
`.env`. Mount the data volume and expose the app through HTTPS (for example,
the included Caddy profile). Keep the SQLite and uploads volumes private. This
mode is single-instance; do not run multiple application replicas against one
SQLite file.

To use the included Caddy reverse proxy, set `READER_DOMAIN` and `APP_ORIGIN`
to your real HTTPS domain, set `COOKIE_SECURE=true` and `TRUST_PROXY=true`, and
expose the proxy only after DNS and firewall rules are ready. `TRUST_PROXY=true`
is appropriate only when requests reach the app through this trusted proxy; it
lets login rate limiting distinguish client IPs from Caddy's own address. Then
start the `proxy` profile:

```bash
docker compose --profile proxy up -d --build
```

For access only from a trusted LAN without Caddy, set
`READER_BIND_ADDRESS=0.0.0.0` and set `APP_ORIGIN` to the exact LAN URL, such as
`http://192.168.1.20:3000`. Limit the firewall rule to the trusted LAN.

## Firebase mode

Create a new Firebase project, enable Email/Password or Google Authentication,
create Firestore and Storage, and register a web app. Copy the Firebase web
configuration names from `reader-app/env-example` into the deployment
environment. Do not copy any
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
The example `reader-app/backups/` directory is ignored by Git, but it is still
inside the repository checkout. Treat it only as a local staging location and
copy completed backups to protected storage outside both the repository and
the Docker host. Never commit backup contents.

On Linux, first create the backup directory and give the container's `node`
user (UID 1000) access: `sudo install -d -m 700 -o 1000 -g 1000 backups`.
An automatically created, root-owned bind mount is not writable by the reader.

```bash
docker compose stop reader
docker compose run --rm --no-deps -v "$PWD/backups:/backup" reader \
  npm run local:backup -- backup /backup/reader-$(date +%F)
docker compose start reader
```

PowerShell equivalent (run from `reader-app`):

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
docker compose stop reader
docker compose run --rm --no-deps -v "$($PWD.Path)\backups:/backup" reader npm run local:backup -- backup "/backup/reader-$stamp"
docker compose start reader
```

Before replacing any current data, restore the backup into a separate Compose
project and confirm that the expected users are present. This validates the
manifest, database hash, file count, and restored SQLite database without
touching the live `reader-data` volume or competing for its network port:

```bash
docker compose -p reader-restore-test run --rm --no-deps -v "$PWD/backups:/backup:ro" reader \
  npm run local:backup -- restore /backup/reader-2026-09-15
docker compose -p reader-restore-test run --rm --no-deps reader npm run local:user -- list
docker compose -p reader-restore-test down -v
```

PowerShell uses the same commands, with the bind mount written as
`-v "$($PWD.Path)\backups:/backup:ro"` and line continuations removed.

Only after that test succeeds should you schedule downtime and replace the live
reader data. The following operation permanently empties only the `reader-data`
volume; it does not remove Caddy's certificates or configuration. Confirm the
tested backup directory in the restore command before running it, and keep
another copy outside the Docker host when possible.

First stop the same stack variant you normally run:

```bash
# Reader without Caddy:
docker compose down

# OR reader with the Caddy proxy profile:
docker compose --profile proxy down
```

Then empty and restore `reader-data`:

```bash
docker compose run --rm --no-deps reader sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker compose run --rm --no-deps -v "$PWD/backups:/backup:ro" reader \
  npm run local:backup -- restore /backup/reader-2026-09-15
```

PowerShell uses the same commands with
`-v "$($PWD.Path)\backups:/backup:ro"` and no Bash line continuation. If the
restore command fails, do not start or upload anything into the new volume.
Correct the reported problem; if the failed attempt wrote partial data, rerun
the scoped `/data` emptying command above, then restore from the tested backup.

Finally restart the same stack variant and verify the restored users:

```bash
# Reader without Caddy:
docker compose up -d

# OR reader with the Caddy proxy profile:
docker compose --profile proxy up -d

docker compose exec -T reader npm run local:user -- list
```

For Firebase, use provider exports and retain Firestore and Storage retention
policies. Offline browser copies remain on the device after a server-side
deletion.
