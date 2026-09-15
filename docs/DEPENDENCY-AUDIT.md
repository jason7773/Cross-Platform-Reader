# Dependency and license audit

`reader-app/package-lock.json` is the source of truth for production dependency versions. CI installs it with `npm ci` and fails on high or critical production dependency advisories with `npm audit --omit=dev --audit-level=high`.

Before a release, run the following from `reader-app/` and record the command output, date, and commit in the release notes. Do not paste registry credentials or internal package URLs into the report.

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm ls --omit=dev
```

The direct production dependencies currently declare these SPDX licenses. Transitive dependencies must be reviewed from the lockfile whenever the dependency graph changes.

| Dependency | Declared license |
| --- | --- |
| better-sqlite3 | MIT |
| firebase | Apache-2.0 |
| jszip | MIT OR GPL-3.0-or-later |
| next | MIT |
| pdfjs-dist | Apache-2.0 |
| react / react-dom | MIT |
| react-pdf | MIT |

Choose the MIT branch of JSZip when redistributing the application. Keep all required upstream notices with source and binary distributions.
