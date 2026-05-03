# Cross-Platform Reader

Next.js reader app for PDF and ePub files, backed by Firebase Auth, Firestore, Firebase Storage, and Firebase Hosting.

## Features

- PDF and ePub reading with saved percentage progress.
- Contents panel with current chapter/section marking.
- Reader settings for PDF zoom/page mode and ePub text size, line spacing, and reading width.
- In-book search for PDF pages and ePub chapters.
- Local bookmarks with editable notes.
- Offline file cache with manual save/remove controls.
- Local progress fallback with automatic Firestore sync when network returns.
- Library progress bars, continue-reading shortcut, sorting, and grid/list views.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Create `.env.local` from `env-example`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## Storage Delivery

Book files and covers are stored in Firebase Storage. The reader loads PDF and ePub files directly from Firebase Storage download URLs so large book traffic does not pass through Firebase Hosting's framework backend.

Apply the Storage CORS policy before relying on deployed direct reads:

```bash
gcloud storage buckets update gs://cross-platform-reader.firebasestorage.app --cors-file=storage.cors.json
```

If you use a different bucket, replace the bucket name with the value of `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`.

## Firebase Rules

Firestore and Storage rules live in `firestore.rules` and `storage.rules`. They restrict book metadata, progress records, and stored files to the signed-in owner. Deploy them with the app:

```bash
firebase deploy --only firestore:rules,storage,hosting
```

## Validation

```bash
npm run lint
npm run build
```
