# Security policy

## Supported versions

Only the latest commit on the default branch is supported.

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Send
a private report to the repository owner with a description, reproduction
steps, affected deployment mode, and the smallest useful log excerpt. Never
include passwords, tokens, private keys, book files, or personal data.

Deployments must use their own Firebase project or local data directory. Never
commit `.env.local`, service-account JSON, SQLite databases, uploaded books,
backups, or generated logs. Rotate any credential that may have been exposed.

## Security boundaries

This project is intended for private or invited libraries. Offline browser
copies cannot be remotely revoked after a user downloads a file. Operators are
responsible for HTTPS, backups, storage quotas, and account lifecycle.
