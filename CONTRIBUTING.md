# Contributing

1. Create a branch from the default branch.
2. Do not add credentials, service-account files, databases, uploaded books,
   or generated build output.
3. Run `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run build` in
   `reader-app/` before opening a pull request.
4. Include tests for authorization, ownership, and failure paths when changing
   a backend or storage operation.

Pull requests should explain the user-visible behavior, deployment impact, and
any migration or compatibility requirement.
