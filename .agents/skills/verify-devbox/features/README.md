# Devbox 驗證功能地圖

這是使用者行為的維護來源。先讀索引，再依變更選取對應功能；每份文件列出的入口各自需要證據，單一方便入口不能替其他入口背書。

## 基準前置條件

- 依 [SKILL.md](../SKILL.md) build、launch、doctor；保留 CONTROL 與 PROOF。
- 全新 HOME、唯一專案名稱、`user-file.txt` sentinel；不複製現有設定或憑證。
- `init-save` 後：Global Node 24、Agents 空、通知 false；Local Node 24、ports `VERIFY_PORT:5173:5173`。
- build/生命週期/rm 使用獨佔、可丟棄 Docker daemon 的 `launch docker`；未提供就記錄前置條件不足。設定流程不需要 daemon。
- Shell/runtime 流程需以非 root POSIX 帳號啟動（實際 UID/GID > 0），並有下載 image、套件與 Node runtime 的網路。

## 操作慣例

- 指令都從 checkout 根目錄呼叫 `"$CONTROL" "$PROOF" ...`；helper 自動把 CLI cwd 切到 scratch 專案。
- `open LABEL COMMAND...` 後，以 `wait` 的提示和實際畫面為準送鍵；`finish LABEL` 取得結束碼後才能開下一個命令。
- 每次 mutation 前後 `snapshot`，每個 label 唯一；初始狀態不同的分支另建新 run。
- Docker 唯讀查詢使用本次 `run.json` 的 dockerHost，不向 default daemon 查詢。先核對 Compose 的 project_root 為本次 scratch 專案。

## 證明與失敗回報

- 保留命令、輸入、PTY 輸出、結束碼、前後快照；mutation 再由檔案或 Docker 查詢交叉確認。
- 對每個 sub-feature ID 記錄通過、失敗、未執行與原因；不可把缺 Node/Agent/daemon 的旅程改測其他入口後宣稱通過。
- 每次失敗也 cleanup；證據留在 PROOF。不得在 log 輸入真正的 token、密碼或 Agent 登入資訊。
- 基準不含多專案、第二個 Node 版本、已安裝 Agent 或 running container；需要這些條件的旅程必須先經真實使用者流程建立，否則回報失敗及缺少條件。

## 功能

| 文件 | 使用者入口與範圍 |
| --- | --- |
| [專案註冊](registration.md) | init、首次全域/本機設定、取消、重複初始化 |
| [調整設定](configuration.md) | config 的 Current project / Workspace Docker image、確認與取消、Runtime 替換 |
| [建置 Workspace](workspace-build.md) | build、--cache、--no-cache；Node/Agent 可用性 |
| [沙箱與 Shell](sandbox.md) | up、sh、stop、down、重啟及專案檔案寫入 |
| [移除專案](removal.md) | rm 的確認/取消、rm --yes、檔案與全域狀態保留 |

所有功能共用的 `--help` / `--version` 可用 `open cli-help --help`、`finish cli-help`，以及 `open cli-version --version`、`finish cli-version` 取得終端證據；doctor 只檢查版本，不取代 help 功能證明。命令沒有 Web、快捷選單、restart、exec 或 logs 入口。
