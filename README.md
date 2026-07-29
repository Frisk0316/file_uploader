# 文件轉運站

純 GitHub Pages 文件站。前端直接使用 GitHub REST API，把文件存進指定 repo，不需要 Cloudflare 或自架後端。

## 已完成

- 點選或拖曳多檔依序上傳，保留原始檔名
- 支援 PNG、JPG、Excel、CSV、PowerPoint、PDF、Python、純文字、Markdown、Word、JSON、XML、YAML、MP3、HTML、ZIP
- 依上傳日期或檔名關鍵字搜尋
- 單檔及多選批次下載
- 永久、7 天、30 天、90 天或指定日期保留
- 手動清除到期檔案及單檔刪除
- public repo 可匿名唯讀；private repo 使用 fine-grained PAT
- PAT 只存在目前分頁記憶體，不寫入 localStorage、sessionStorage 或 repo

## 限制

- 每個檔案上限 20 MiB。
- 暫不支援 MP4 或選取後打包 ZIP。
- 純 GitHub Pages 沒有背景排程；到期檔案要登入網站後按「清除到期檔案」。
- Git 的刪除 commit 不會自動清除歷史版本。敏感文件應使用 private repo；需要徹底移除時必須另外重寫 Git 歷史。
- 批次下載可能觸發瀏覽器的「允許多個檔案下載」提示。
- 遞迴清單使用 Git Trees API；個人文件站足夠，若超過 100,000 筆需改用分層讀取。

## 建議 Repo 配置

最簡單且不必為 private Pages 付費的做法是使用兩個 repo：

1. 公開的網站 repo：只放本專案程式，啟用 GitHub Pages。
2. Private 的文件 repo：只存文件，先建立一個 README 讓 `main` branch 存在。

網站 repo 公開不會洩漏 private 文件；文件讀寫仍需要你在瀏覽器輸入有權限的 PAT。

## 建立 Private 文件 Repo

1. 登入 GitHub，按右上角 **＋ → New repository**。
2. 輸入名稱，例如 `file_uploader_storage`。
3. Visibility 選 **Private**。
4. 勾選 **Add a README file**，讓 `main` branch 立即存在。
5. 按 **Create repository**。這個文件 repo 不需要啟用 GitHub Pages。

網站程式留在公開的 `file_uploader` repo；實際上傳的文件只會寫入這個 private repo。

## 建立 PAT

在 GitHub 的 **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 建立 token：

- Resource owner：選 private 文件 repo 的擁有者，例如 `Frisk0316`
- Repository access：選 **Only select repositories**，並勾選剛建立的 private 文件 repo
- Repository permissions → Contents：Read and write
- 設定有效期限，例如 30 或 90 天
- 不要把 token 寫進任何檔案、commit 或瀏覽器儲存空間

若 private 文件 repo 是在 token 建立後才新增，必須編輯或重建 token，把新 repo 加入 Repository access。Public repo 可匿名讀取，因此「改成 public 就能連線」通常表示原本的 PAT 沒有 private repo 權限。

官方說明：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

## 開始上傳文件

1. 開啟 <https://frisk0316.github.io/file_uploader/>。
2. Owner 輸入 `Frisk0316`。
3. Repo 輸入剛建立的 private 文件 repo 名稱，例如 `file_uploader_storage`。
4. Branch 輸入 `main`，貼上只授權該文件 repo 的 fine-grained PAT，再按 **連線**。
5. 將文件拖曳到上傳區，或點擊選擇文件；設定保留期限後按 **開始上傳**。

## 部署 GitHub Pages

1. 把本專案 push 到網站 repo 的 `main` branch。
2. 開啟 **Settings → Pages**。
3. Source 選 **Deploy from a branch**。
4. Branch 選 `main`，資料夾選 `/docs`。
5. 開啟 Pages 網址，輸入文件 repo 的 owner、repo、branch 和 PAT。

如果網站程式與文件使用同一個 public repo，所有文件也會公開。若同一個 repo 設為 private，需確認你的 GitHub 方案支援從 private repo 發布 Pages。

## 本機檢查

```powershell
node --test tests/core.test.mjs
python -m http.server 8000 -d docs
```

然後開啟 <http://localhost:8000>。請勿直接雙擊 `index.html`，ES modules 需要由 HTTP server 載入。

## 儲存路徑

```text
files/YYYY-MM-DD/keep/HHmmss-UUID/原始檔名
files/YYYY-MM-DD/expire-YYYY-MM-DD/HHmmss-UUID/原始檔名
```

UUID 只用來避免同名覆蓋；清單與下載仍使用原始檔名。
