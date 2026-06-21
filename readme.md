# Cross-Platform Reader 專案概覽

Cross-Platform Reader 是一個私人雲端閱讀器 Web App，主程式位於 `reader-app/`。它使用 Next.js App Router 建立前端與路由，Firebase Authentication 處理登入，Firestore 儲存書籍 metadata 與閱讀進度，Firebase Storage 儲存 PDF、ePub 與封面圖。部署目標是 Firebase Hosting frameworks backend。

目前支援的核心流程是：使用者登入後上傳 PDF 或 ePub，系統把檔案與封面存到自己的 Storage 路徑，Firestore 建立書籍紀錄，使用者可以在書庫中搜尋、排序、切換格狀或列表檢視、繼續閱讀、刪除自己的書籍，並在 PDF/ePub 閱讀器中保存進度、調整閱讀設定、搜尋內容、建立本機書籤與離線快取。

## 技術棧

- Frontend: Next.js 15 App Router、React 19、TypeScript
- Authentication: Firebase Authentication，支援 Email/Password 與 Google popup 登入
- Database: Cloud Firestore
- Storage: Firebase Storage
- PDF reader: `react-pdf`、`pdfjs-dist`
- ePub reader: `react-reader`、`epubjs`
- ePub search: `jszip`
- Styling: CSS Modules 與全域 CSS variables
- Deploy: Firebase Hosting with frameworks backend
- Runtime: `package.json` 指定 Node.js 22

## 專案結構

```text
reader-app/
  package.json              npm scripts、依賴與 Node 版本
  firebase.json             Firestore、Storage、Hosting 部署設定
  firestore.rules           Firestore 權限規則
  storage.rules             Firebase Storage 權限規則
  storage.cors.json         Storage 直接讀取所需 CORS 設定
  env-example               .env.local 範例
  next.config.ts            Next.js 設定與 Firebase Storage 圖片來源
  src/
    app/
      page.tsx              登入後的書庫首頁、搜尋、上傳入口
      login/page.tsx        Email/Password 與 Google 登入/註冊
      read/[id]/page.tsx    依書籍格式載入 PDFReader 或 EpubReader
      layout.tsx            Auth 與 theme providers
      globals.css           全域樣式與 light/dark theme variables
    components/
      UploadBook.tsx        PDF/ePub 上傳、封面處理、Firestore metadata 寫入
      BookList.tsx          書庫列表、排序、刪除、離線快取、進度摘要
      PDFReader.tsx         PDF 閱讀、目錄、搜尋、書籤、進度與設定
      EpubReader.tsx        ePub 閱讀、TOC、搜尋、書籤、進度與設定
      ThemeToggle.tsx       light/dark theme 切換
    context/
      AuthContext.tsx       Firebase auth 狀態
      ThemeContext.tsx      theme 狀態與 localStorage 持久化
    firebase/
      config.ts             Firebase client SDK 初始化
    types/
      index.ts              Book、ReadingProgress、ReaderBookmark 等型別
    utils/
      bookCache.ts          Cache Storage 離線書籍快取
      bookMetadataCache.ts  離線 metadata fallback
      bookmarks.ts          localStorage 書籤
      coverExtractor.ts     PDF/ePub 封面擷取
      epubSearch.ts         ePub HTML 章節搜尋
      readerSettings.ts     PDF/ePub 閱讀設定
      readingProgress.ts    本機進度、待同步佇列與 Firestore 同步
```

## 主要功能

### 登入與權限

`src/app/login/page.tsx` 提供 Google popup 登入，也提供 Email/Password 登入與註冊。`AuthContext` 用 `onAuthStateChanged` 追蹤 Firebase 使用者狀態，首頁在未登入時導向 `/login`。

Firestore 與 Storage rules 都以使用者 UID 做隔離。使用者只能讀寫自己的 `books`、`progress` 文件，以及 `books/{uid}/...`、`covers/{uid}/...` 底下的 Storage 物件。

### 書籍上傳

`UploadBook.tsx` 只接受 `.pdf` 與 `.epub`，單本書限制小於 100 MB。上傳流程會：

1. 將書籍存到 `books/{uid}/{timestamp}_{filename}`。
2. 取得 Firebase Storage download URL。
3. 若使用者沒有上傳封面，嘗試從 PDF 第一頁或 ePub cover 產生封面。
4. 將封面 resize 後以 JPEG 存到 `covers/{uid}/...`。
5. 將書名、作者、格式、URL、Storage path、檔案大小、MIME type、上傳者與時間寫入 Firestore `books` collection。
6. 把剛上傳的書籍放入瀏覽器 Cache Storage，方便離線閱讀。

### 書庫

`BookList.tsx` 監聽目前使用者的書籍：

```text
books where uploadedBy == user.uid orderBy createdAt desc
```

書庫支援標題、作者與格式搜尋，也支援依最近閱讀、標題、作者或進度排序。使用者可以切換 grid/list 檢視、從 continue reading 面板接續最近閱讀、手動保存或移除離線副本，並刪除自己的書籍與封面。

### PDF 閱讀器

`PDFReader.tsx` 使用 `react-pdf` 與 `pdfjs-dist`。它會透過 `bookCache.ts` 從 Cache Storage 或 Firebase Storage download URL 取得 PDF blob，再建立 object URL 給 PDF renderer 使用。

PDF 閱讀器支援：

- 單頁與連續頁模式
- zoom 設定並保存到 localStorage
- PDF outline/contents 導覽
- 目前章節標記
- PDF 全文搜尋，最多顯示 30 筆結果
- 本機書籤與可編輯 note
- 頁碼型閱讀進度，遠端寫入 Firestore，離線時先保存在本機待同步佇列

### ePub 閱讀器

`EpubReader.tsx` 使用 `react-reader` 與 `epubjs`。它同樣先透過 `bookCache.ts` 取得 ePub blob，再轉成 `ArrayBuffer` 給 reader 使用。

ePub 閱讀器支援：

- TOC/contents 導覽與目前章節標記
- 字級、行距、閱讀寬度設定並保存到 localStorage
- light/dark theme 套用到 ePub rendition
- 以 `jszip` 掃描 ePub HTML/XHTML 章節搜尋內容
- CFI 型閱讀進度與百分比估算
- 本機書籤與可編輯 note
- 離線進度 fallback 與重新連線後同步

### 進度、書籤與離線能力

閱讀進度使用 Firestore `progress` collection，文件 ID 格式為：

```text
{user.uid}_{bookId}
```

PDF 的 `location` 是頁碼，ePub 的 `location` 是 CFI 字串。`readingProgress.ts` 每次保存進度時會先寫入 localStorage，再嘗試寫入 Firestore；如果 Firestore 寫入失敗，就把紀錄放入 `reader-pending-progress`，等瀏覽器恢復 online 時同步。

書籤目前是 localStorage-only，不會同步到 Firestore。離線書籍使用瀏覽器 Cache Storage，使用者可以在書庫中手動保存或移除。

## Firebase 資料模型

### `books`

```ts
interface Book {
  id: string;
  title: string;
  author: string;
  format: "pdf" | "epub";
  url: string;
  coverUrl?: string;
  storagePath?: string;
  coverStoragePath?: string;
  fileSize?: number;
  mimeType?: string;
  coverSize?: number;
  coverMimeType?: string;
  uploadedBy: string;
  createdAt: number;
}
```

### `progress`

```ts
interface ReadingProgress {
  userId: string;
  bookId: string;
  location: string | number;
  percentage?: number;
  lastRead: number;
}
```

## 本機開發

在 `reader-app/` 底下執行：

```bash
npm install
npm run dev
```

開啟 `http://localhost:3000`。

建立 `.env.local`，可從 `env-example` 複製：

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## 驗證與部署

常用驗證指令：

```bash
npm run lint
npm run build
```

Firebase rules 與 Hosting 部署：

```bash
firebase deploy --only firestore:rules,storage,hosting
```

因為目前 reader 直接從 Firebase Storage download URL 讀取 PDF/ePub，部署環境需要先套用 Storage CORS。`reader-app/README.md` 目前使用的範例是：

```bash
gcloud storage buckets update gs://cross-platform-reader.firebasestorage.app --cors-file=storage.cors.json
```

若 Firebase bucket 名稱不同，必須改成 `.env.local` 中 `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 對應的 bucket。

## 目前需要注意的地方

- 根目錄原本的 `PROJECT_OVERVIEW.md` 是亂碼且內容已過時，尤其提到的 `/api/proxy-file` 現在不存在；目前實作是直接從 Firebase Storage download URL 讀檔，並依賴 Storage CORS。
- `next.config.ts` 設定 `eslint.ignoreDuringBuilds = true`，代表 production build 不會因 lint 失敗而中止；發布前仍應獨立跑 `npm run lint`。
- `next.config.ts` 設定 `reactStrictMode: false`，如果之後要開啟 Strict Mode，需要重新檢查 reader 元件中的 client-only 與第三方 reader 行為。
- 書籤與 reader settings 目前只存在瀏覽器 localStorage，不會跨裝置同步。
- 離線快取依賴瀏覽器 Cache Storage，並不是完整 service worker/PWA 安裝流程。
- Storage 刪除流程會同時嘗試刪除書籍與封面，但 Firestore metadata 是刪除成功與否的主要 UI 狀態來源；Storage 刪除失敗目前只記錄 warning。
