# Cross-Platform Reader

把自己的 PDF 與 ePub 放進私人線上書庫，登入後就能從電腦、平板或手機瀏覽器閱讀。

這個 repository 是**需要自行架設的應用程式**，不是已經可以註冊使用的公開網站。第一次使用建議選 Docker：不需要 Firebase 帳號，約幾分鐘即可在自己的電腦啟動。

## 最快開始：在 Windows 用 Docker 啟動

你需要：

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（使用 Linux containers／WSL 2）

### 1. 下載專案

在 PowerShell 執行：

```powershell
git clone https://github.com/jason7773/Cross-Platform-Reader.git
cd Cross-Platform-Reader\reader-app
```

如果你已經下載過專案，只要在 PowerShell 進入其中的 `reader-app` 資料夾即可。

### 2. 建立設定檔與安全金鑰

以下指令會複製範例設定，並自動產生一組隨機的登入工作階段金鑰：

```powershell
Copy-Item .env.example .env
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
(Get-Content .env -Raw).Replace('replace-with-a-long-random-value', $secret) | Set-Content .env -Encoding ascii
```

本機使用時不需要改其他設定。`.env` 包含私密設定，不要提交到 Git。

### 3. 啟動並建立第一個帳號

```powershell
docker compose up -d --build
$password = Read-Host -AsSecureString '設定密碼（至少 12 個字元）'
([System.Net.NetworkCredential]::new('', $password)).Password | docker compose exec -T reader npm run local:user -- create you@example.com --password-stdin
```

把 `you@example.com` 換成自己的 Email。密碼至少需要 12 個字元；輸入時畫面不會顯示內容。若使用 Windows 內建的 PowerShell 5.1，密碼請只用 ASCII 英文字母、數字及符號，避免管線轉碼改變密碼內容。

看到 `Created active library user` 就代表帳號建立成功。接著開啟：

<http://localhost:3000>

用剛建立的 Email 與密碼登入。

### 4. 放入第一本書

登入後：

1. 按右上方的 **Add book**。
2. 選擇 PDF 或 ePub（單檔上限 100 MB）。
3. 確認書名；作者、標籤、筆記與自訂封面都可以不填。
4. 按 **Upload book**，再從書庫開啟閱讀。

閱讀進度、書籤、畫線與設定會保存在你的帳號下。每個帳號只能看到自己的書籍與閱讀資料。

## 日常使用

下列指令都要在 `reader-app` 資料夾執行。

```powershell
# 啟動
docker compose up -d

# 停止（書籍與資料仍會保留）
docker compose down

# 查看運作狀態
docker compose ps

# 查看錯誤與執行紀錄
docker compose logs -f reader
```

更新程式：

```powershell
git pull
docker compose up -d --build
```

`docker compose down` 不會刪除書庫。不要執行 `docker compose down -v`，除非你確定要刪除 Docker data volume；正式更新前仍建議先備份。

## 管理帳號

Docker 模式沒有網頁管理後台，帳號由部署者透過指令管理：

```powershell
# 列出帳號
docker compose exec -T reader npm run local:user -- list

# 建立另一個帳號
$password = Read-Host -AsSecureString '設定密碼（至少 12 個字元）'
([System.Net.NetworkCredential]::new('', $password)).Password | docker compose exec -T reader npm run local:user -- create friend@example.com --password-stdin

# 停用或重新啟用帳號
docker compose exec -T reader npm run local:user -- disable friend@example.com
docker compose exec -T reader npm run local:user -- enable friend@example.com

# 重設密碼；同時登出該帳號現有的登入工作階段
$password = Read-Host -AsSecureString '設定新密碼（至少 12 個字元）'
([System.Net.NetworkCredential]::new('', $password)).Password | docker compose exec -T reader npm run local:user -- reset-password friend@example.com --password-stdin
```

## 要讓其他裝置連線？

預設的 `localhost:3000` 只允許這台電腦存取，這是刻意的安全設定。

- 同一個家用網路：將 `.env` 的 `READER_BIND_ADDRESS` 改為 `0.0.0.0`，並把 `APP_ORIGIN` 改成其他裝置實際開啟的網址，例如 `http://192.168.1.20:3000`；也要只對可信任的區網開放電腦防火牆。
- 網際網路公開：必須使用自己的網域、HTTPS 與反向代理，不要直接公開開發用 HTTP 連接埠。
- VPS／NAS：Docker local 模式最合適，但同一個 SQLite 書庫只能由一個應用程式實例使用。

完整的網路設定、內建 Caddy、備份與還原指令請看 [部署指南](docs/DEPLOYMENT.md)。

## 我該選 Docker 還是 Firebase？

| | Docker local（建議先用） | Firebase |
|---|---|---|
| 適合 | 個人電腦、NAS、單台 VPS | 想使用 Google 代管服務 |
| 資料位置 | SQLite 與 Docker volume | Firestore 與 Firebase Storage |
| 帳號 | 指令建立與管理 | Firebase Authentication |
| 前置設定 | Docker Desktop／Docker Engine | Firebase 專案、CLI、服務帳號與安全規則 |
| 擴充限制 | 單一應用程式實例 | 由 Firebase 服務承擔 |

兩種模式共用同一套閱讀介面，但資料不會自動互相搬移。若你只是想先看看專案怎麼用，請從 Docker local 開始。

## Firebase 部署（進階）

Firebase 模式需要你自己的 Firebase 專案。大致流程是：

1. 啟用 Email/Password 或 Google Authentication。
2. 建立 Firestore、Storage 與 Web App。
3. 將 `reader-app/env-example` 複製為 `.env.local`，填入自己的 Web App 設定。
4. 部署 Firestore rules、indexes、Storage rules 與應用程式。
5. 在管理者電腦使用 `scripts/firebase-members.mjs` 核准第一位 Firebase UID。

請依 [部署指南](docs/DEPLOYMENT.md) 完成 CORS、授權網域、服務帳號與 rules 驗證。服務帳號金鑰只能留在管理者電腦或受保護的 CI secret，不能放進 repository、瀏覽器 bundle 或 Docker image。

## 主要功能

- PDF 與 ePub 閱讀器
- 書庫搜尋、目錄與閱讀進度
- 書籤、畫線與閱讀設定
- PDF／ePub、封面、標籤與筆記管理
- 每個帳號獨立的書籍及閱讀資料
- 個人資料匯出、離線副本清除與帳號資料刪除
- Docker 的 SQLite／檔案備份還原
- Firebase 與 Docker local 兩種後端

注意：使用者已下載到瀏覽器的離線副本，伺服器無法事後遠端撤回。

## 開發者設定

需要 Node.js `22.16.x`（專案限制為 `>=22.16.0 <23`）。

```powershell
cd reader-app
npm ci
Copy-Item .env.example .env.local
(Get-Content .env.local -Raw).Replace('READER_DATA_DIR=/data', 'READER_DATA_DIR=./data') | Set-Content .env.local -Encoding ascii
$password = Read-Host -AsSecureString '設定密碼（至少 12 個字元）'
([System.Net.NetworkCredential]::new('', $password)).Password | npm run local:user -- create you@example.com --password-stdin
npm run dev
```

開啟 <http://localhost:3000>，用剛建立的帳號登入。上述設定使用 `reader-app/data/` 作為本機開發資料目錄；該目錄已排除於 Git 之外。

提交修改前可執行：

```powershell
npm run lint
npm run typecheck
npm run build
npm run test:local-api -- http://127.0.0.1:3000 you@example.com YOUR_PASSWORD
```

Local API smoke test 要在開發伺服器運作時執行，並使用你建立的帳號與密碼。Firebase rules 測試另外需要 Firebase Emulator。貢獻流程請看 [CONTRIBUTING.md](CONTRIBUTING.md)，安全問題請依 [SECURITY.md](SECURITY.md) 回報。

## 資料安全

- 不要提交 `.env`、`.env.local`、服務帳號金鑰、SQLite、上傳檔案或備份。
- 對外服務時，請使用長且隨機的 `SESSION_SECRET`、HTTPS、`COOKIE_SECURE=true`，並限制資料 volume 的存取權。
- 停用帳號會拒絕新的登入與資料存取，並撤銷既有工作階段。
- 備份前應停止應用程式；還原只允許寫入空白 data volume。

更多細節：[部署指南](docs/DEPLOYMENT.md) · [安全設計與稽核](docs/SECURITY-AUDIT.md) · [相依套件稽核](docs/DEPENDENCY-AUDIT.md)

## 授權

[MIT License](LICENSE)
