# Repository security audit

This report describes the open-source working copy audit. It deliberately does
not contain secret values.

## Findings

- Local `.env.local`, Firebase emulator state, logs, build output, databases,
  and uploaded files are excluded by ignore rules and are not part of this
  working copy.
- Firebase configuration in source is deployment input. The open-source copy
  must not contain a project ID, domain, bucket, service-account key, or
  download token belonging to an operator.
- Rules and API handlers must enforce membership and ownership server-side;
  hiding a registration control is not an authorization boundary.
- Browser Cache Storage is device-local. A downloaded book cannot be remotely
  revoked and must be treated as a private copy.

## Verification record

Before publishing, run the repository secret scanner over every reachable
branch and tag, inspect the result without printing matches, and review the
Docker build context and CI artifacts. Record the scanner name, version, commit
SHA, and pass/fail result in the release notes. If a real credential is found,
revoke and rotate it first; do not rewrite or force-push the owner's history as
part of this change.
