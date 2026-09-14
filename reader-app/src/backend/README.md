# Reader backend integration

`getBackend()` reads `NEXT_PUBLIC_READER_BACKEND` and accepts `firebase` (the
default) or `local`. `loadBackendServices()` loads the selected adapter only
when it is needed, so choosing `local` does not execute Firebase initialization.

The application-facing contracts are in `contracts.ts`: `AuthService`,
`LibraryRepository`, `ReaderDataRepository`, and `FileStore`. Adapters must
enforce ownership using the current session rather than accepting a client
supplied user ID as authority.

The current Firebase reader remains available while the local API adapter is
introduced. A local adapter should implement all four contracts and be loaded
from `loadBackendServices()`; it must not import `firebase/*` modules. UI code
can migrate incrementally by calling `await loadBackendServices()` instead of
importing Firebase SDK functions.
