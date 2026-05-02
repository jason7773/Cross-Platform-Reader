# Cross-Platform Reader 專案說明

## 專案概覽

`Cross-Platform Reader` 是一個以 Next.js 建立的跨平台閱讀器 Web App。使用者登入後可以上傳 PDF 或 ePub 書籍，系統會將檔案存到 Firebase Storage，並把書籍 metadata 與閱讀進度存到 Firestore。前端提供個人書庫、深色模式、PDF 閱讀、ePub 閱讀與閱讀進度保存。

主要程式位於 `reader-app/`。

## 技術棧

- Frontend: Next.js 15 App Router、React 19、TypeScript
- Auth: Firebase Authentication，支援 Email/Password 與 Google 登入
- Database: Firebase Firestore
- File Storage: Firebase Storage
- PDF: `react-pdf`、`pdfjs-dist`
- ePub: `react-reader`、`epubjs`
- Styling: CSS Modules 與全域 CSS variables
- Deploy: Firebase Hosting with frameworks backend

## 目錄結構

```text
reader-app/
  firebase.json              Firebase Hosting 設定
  next.config.ts             Next.js 設定
  package.json               npm scripts 與依賴
  env-example                Firebase 前端環境變數範例
  src/
    app/
      page.tsx               登入後首頁與個人書庫
      login/page.tsx         登入/註冊頁
      read/[id]/page.tsx     閱讀頁，依書籍格式載入 PDF/ePub reader
      api/proxy-file/route.ts 遠端檔案 proxy，處理閱讀檔案 CORS
      layout.tsx             Provider 與全站 metadata
      globals.css            全域樣式與 light/dark theme 變數
    components/
      UploadBook.tsx         上傳 PDF/ePub 與封面
      BookList.tsx           書庫列表與刪除
      PDFReader.tsx          PDF 閱讀與頁碼進度保存
      EpubReader.tsx         ePub 閱讀、目錄與 CFI 進度保存
      ThemeToggle.tsx        深色模式切換
    context/
      AuthContext.tsx        Firebase auth 狀態
      ThemeContext.tsx       light/dark theme 狀態
    firebase/
      config.ts              Firebase 初始化
    types/
      index.ts               Book、UserProfile、ReadingProgress 型別
    utils/
      coverExtractor.ts      PDF/ePub 封面自動擷取
```

## 主要功能流程

### 1. 驗證與進入書庫

- `src/context/AuthContext.tsx` 透過 `onAuthStateChanged` 監聽 Firebase 使用者狀態。
- `src/app/login/page.tsx` 提供 Email/Password 註冊登入與 Google popup 登入。
- `src/app/page.tsx` 若使用者未登入，會導向 `/login`；登入後顯示書庫、搜尋框、上傳按鈕與使用者 email。

### 2. 上傳書籍

- `UploadBook.tsx` 接受 `.pdf` 與 `.epub`。
- 書籍檔案上傳到 Firebase Storage 路徑：

```text
books/{user.uid}/{timestamp}_{filename}
```

- 封面可手動上傳；若未上傳，會嘗試用 `coverExtractor.ts` 自動擷取：
  - PDF: 取第一頁渲染成 JPEG blob
  - ePub: 使用 `epubjs` 讀取 cover
- Firestore `books` collection 會新增書籍 metadata。

### 3. 書庫列表與刪除

- `BookList.tsx` 查詢目前使用者自己的書：

```text
books where uploadedBy == user.uid orderBy createdAt desc
```

- 刪除時會先刪 Firestore 文件，再嘗試刪除 Storage 裡的書籍檔案與封面檔案。

### 4. 閱讀 PDF

- `read/[id]/page.tsx` 依 Firestore 書籍資料載入 `PDFReader`。
- `PDFReader.tsx` 使用 `/api/proxy-file?url=...` 取得檔案，避免 Firebase Storage CORS 導致讀取問題。
- 翻頁時把頁碼存到 Firestore `progress`：

```text
progress/{user.uid}_{bookId}
```

### 5. 閱讀 ePub

- `EpubReader.tsx` 透過 proxy route 把 ePub 讀成 `ArrayBuffer`。
- 使用 `ReactReader` 顯示內容。
- 進度以 ePub CFI 字串保存到 Firestore `progress`。
- 內建自訂目錄側欄，並嘗試把 TOC href 對應到 spine href，以提高不同 ePub 檔案的導航穩定性。

### 6. Theme

- `ThemeContext.tsx` 讀取 `localStorage.theme`，若沒有則依照系統 `prefers-color-scheme`。
- theme 寫入 `document.documentElement[data-theme]`。
- `globals.css` 定義 light/dark CSS variables。

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
  uploadedBy: string;
  createdAt: number;
}
```

### `progress`

文件 ID 目前使用：

```text
{user.uid}_{bookId}
```

資料內容：

```ts
interface ReadingProgress {
  userId: string;
  bookId: string;
  location: string;
  percentage: number;
  lastRead: number;
}
```

實作現況：

- PDF 的 `location` 實際存頁碼 number。
- ePub 的 `location` 實際存 CFI string。
- 目前程式沒有寫入 `percentage`。

## 環境設定

建立 `.env.local`，可參考 `reader-app/env-example`：

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## 常用指令

在 `reader-app/` 目錄執行：

```bash
npm install
npm run dev
npm run build
npm run start
npm run lint
```

`package.json` 指定 Node.js 版本：

```json
{
  "engines": {
    "node": "20"
  }
}
```

## 部署設定

`reader-app/firebase.json` 使用 Firebase Hosting frameworks backend：

```json
{
  "hosting": {
    "source": ".",
    "frameworksBackend": {
      "region": "us-central1",
      "timeoutSeconds": 60,
      "memory": "1GiB"
    }
  }
}
```

這表示 Firebase 會從 `reader-app/` 作為 source，並為 Next.js server/API route 建立後端執行環境。

## 目前觀察到的注意事項

- `next.config.ts` 設定 `eslint.ignoreDuringBuilds = true`，正式部署前建議確認 lint 問題是否可接受。
- `PDFReader.tsx` 直接在 render 中使用 `window.innerWidth`。目前元件已用 dynamic import 且 `ssr: false`，但 resize 時不會自動重算寬度。
- 多個 UI 文字看起來有編碼亂碼，例如首頁 logo、返回按鈕、ThemeToggle icon、ePub 目錄按鈕。建議後續統一檢查檔案編碼與顯示文字。
- `progress` 型別宣告包含 `percentage`，但目前保存 PDF/ePub 進度時未寫入。
- `BookList.tsx` 使用 `ref(storage, book.url)` 刪除 download URL 指向的檔案；若 Firebase SDK 無法從 download URL 正確解析 Storage ref，刪除檔案可能失敗。目前程式有 catch 並只警告。
- `/api/proxy-file` 會 fetch 任意 `url` query 參數。若此 App 開放到公開網路，建議限制來源網域或確認授權策略，避免成為通用 proxy。

## 可優先改善項目

1. 修正亂碼 UI 文字，建立一致的中英文介面文案。
2. 補上 Firestore Security Rules 與 Storage Rules 文件或設定。
3. 讓 `ReadingProgress.location` 型別明確支援 `number | string`，或拆分 PDF/ePub progress schema。
4. 搜尋框目前 disabled，可實作本地書名/作者搜尋。
5. 改善 PDF reader 響應式寬度，監聽 resize 或使用容器寬度。
6. 檢查 Storage 刪除邏輯，必要時在 Firestore metadata 保存 storage path。
