---
name: verify-devbox
description: 驗證 Devbox 的真實互動式 CLI；修改初始化、設定、Workspace 建置、Docker 沙箱生命週期或 Shell 行為後，用隔離 TTY 操作並保存輸入、輸出、結束碼與檔案證據。
---

# Verify Devbox

先讀 [功能地圖](features/README.md)，再讀本次變更對應的功能。主要介面是終端 CLI，沒有 Web UI 或 API；Docker Compose 與容器內 Bash 是後續操作介面。這裡操作建置後的 `dist/cli.mjs`，不是直接呼叫內部函式。npm 安裝與套件封裝另有 `pnpm smoke`，不等同本技能的互動流程證明。

## Launch

此 harness 限 Linux／WSL2，且 `/proc` 的 boot_id、stat 與程序樹必須可讀；macOS 不適用，僅安裝 tmux/script 仍無法執行。從儲存庫根目錄執行，使用 Node.js 26、`package.json` 指定的 pnpm；需要 Bash、tmux、util-linux `script`、Docker CLI、Compose plugin。若依賴尚未安裝，先執行 `pnpm install --frozen-lockfile`。

```bash
pnpm build
export CONTROL="$PWD/.agents/skills/verify-devbox/scripts/control.mjs"
export PROOF="$(mktemp -d /tmp/devbox-proof.XXXXXXXX)"
"$CONTROL" "$PROOF" launch
"$CONTROL" "$PROOF" doctor > "$PROOF/doctor.json"
"$CONTROL" "$PROOF" snapshot before-init
```

`TTY ready` 代表本次專用的 tmux socket 與空白專案已建立；不是 Docker 沙箱已可用。每次 `open` 都使用獨立 window，透過 `script` 建立新的真實 PTY，保留完整 transcript。沒有常駐 Devbox server、HTTP port、資料庫 migration 或登入；初始 seed 僅有 `user-file.txt`。空白 HOME 的可用狀態由 [專案註冊](features/registration.md) 的 `init-save` 流程完成。

預設 `launch` 只允許無 Docker 寫入的設定流程。它清空繼承環境，只保留 PATH、隔離 HOME、TERM、LANG；不載入使用者的 Docker 設定、Agent 憑證、APP_PORT 或 Compose 覆寫。初始化只檢查 Docker/Compose CLI 可執行，不要求 daemon 啟動。

**要測 build/up/sh/stop/down/rm 時**：先取得自己獨佔且可丟棄的 Docker daemon，再用全新的證據目錄啟動：

```bash
: "${DOCKER_HOST:?先設定為本次獨佔、可丟棄 daemon 的實際位址}"
export PROOF="$(mktemp -d /tmp/devbox-proof.XXXXXXXX)"
"$CONTROL" "$PROOF" launch docker
"$CONTROL" "$PROOF" doctor > "$PROOF/doctor.json"
```

此模式保留 DOCKER_HOST，但不帶入 TLS 憑證；需 TLS/額外認證的 daemon 不適用此 harness。daemon 位址不得夾帶密碼。不要把共享的 Docker Desktop/default socket 當成獨佔 daemon。`devbox-workspace:latest` 與 Agent volumes（`devbox-claude`、`devbox-codex`、`devbox-agy`、`devbox-omp`）固定命名；HOME 與專案名稱只隔離檔案及容器，無法隔離 image/Agent 資料。沒有獨佔 daemon 就回報該功能前置條件不足，不覆寫使用者的 image。

容器流程還需要 `init` → `build` → `up` → `sh` 中的使用者與 runtime 檢查，單看 Docker `running` 不算可用。基準只選 Node 24、不選 Agent、關閉通知，將 ports 改為 `VERIFY_PORT:5173:5173`；空白 HOME 下不需 Agent 認證。驗證 Agent 安裝的分支要另外在設定選取 Agent、重建，並依功能地圖檢查命令；登入與發送外部訊息不在無憑證基準中。

每次成功或失敗後都執行 [Cleanup](#cleanup)。

## Doctor

任何不對勁時，先執行唯一的唯讀健檢：

```bash
"$CONTROL" "$PROOF" doctor
```

必須 exit 0：Node 26、bundle SHA-256 與啟動時一致、CLI 版本符合套件、專用 tmux session 存在且工作目錄是本次專案、Docker 與 Compose CLI 可用。Docker 模式還會讀取 daemon ID。這裡沒有服務監聽 port，auth 為無憑證；Doctor 不代表 feature 已通過，也不會修復狀態。若 bundle 已變更，清理後重新 build/launch。

## Drive

使用 `open LABEL COMMAND...` 啟動使用者命令，以 `wait '提示文字' [SECONDS]` 定位目前有效的 Clack 提示（◆ 或驗證錯誤 ▲），或目前 Shell prompt，再以 `send` / `text` 送按鍵。每個命令使用獨立 label；`wait` 不搜尋已提交的 ◇，也不接受前一個命令的提示。預設 30 秒逾時；命令已結束則失敗。完整 init-save 按鍵與檔案判定見 [專案註冊](features/registration.md#init-save)。

觀察每次 `wait` 的真實畫面，依顯示值選取，不盲送按鍵或以固定 sleep 猜測。`finish LABEL [SECONDS]` 等待結束（預設 300 秒）、保存結果並回傳 CLI 的結束碼；失敗仍保存證據，接著執行 cleanup。

`finish` 若發現 script signal、runner error，或 pane 已結束但沒有 CLI exit code，會立即保存 `.pane.txt` 與 `.finish-error.json`、清掉 active 並回傳非零，不建立 `.exit`。正常 Ctrl-C 仍保留 CLI 實際回傳的 130。

## Evidence

證據永久留在 `$PROOF`（預設 `/tmp/devbox-proof.XXXXXXXX`；需要跨主機或重開機保留時另行複製）。每個 label 有：

- `.command.json`：實際 argv、專案路徑及 feature entry label。
- `.input`、`.terminal`：`script` 記錄的使用者輸入與完整 PTY 畫面；stdout/stderr 在 TTY 合併，無法分流。
- `.pane.txt`、`.exit`：結束時終端畫面與 CLI 結束碼。
- `snapshot` 目錄：Global/Local YAML、registry、Compose、專案檔案清單與 sentinel 內容。只擷取這些已知非機密檔案，不讀 `.env` 或 Agent 認證。
- `.processes.json`：本命令的自有程序身分（boot ID、PID、start time），供 cleanup 辨識；強制終止另記 signal/report，不捏造 CLI exit code。
- `cleanup-report.json`、歷次 `cleanup-*.json` 與 Docker log：分階段清理結果、終止紀錄與重試線索。

完成標準：記錄操作及結果，不只截最後畫面；從真實 init/config/Compose/Shell 使用者路徑走完，並以檔案或 Docker 唯讀查詢核對副作用。沒有 test-only endpoint、內部狀態寫入或假 Docker。只可在正式邊界已隔離的外部服務使用 mock，且不能把 mock 當成端到端通過。本 CLI 沒有 dry-run，`--yes` 只跳過刪除確認，並不避免 Docker/檔案修改。`build` 會下載系統套件/runtime/Agent、寫入 Docker image；`up` 可能 pull image/建立共用 volumes，並非離線操作。

逐一記錄地圖上的入口為通過、失敗或未執行。只跑 `init-save` 不能宣稱取消、config、建置、Shell 或刪除也通過。缺前置條件時保留嘗試命令與原因，不縮短 journey 假裝成功。

## Cleanup

正常及每次失敗後都執行：

```bash
"$CONTROL" "$PROOF" cleanup
cat "$PROOF/run.json"
test -s "$PROOF/init-save.terminal"
test -s "$PROOF/init-save.exit"
test -s "$PROOF/after-init/project-compose.yaml"
printf 'Evidence: %s\n' "$PROOF"
```

後三項適用 init-save；其他 journey 改查自己的 label。`cleaned: true` 表示自有程序、TTY 與 scratch 均已移除，Docker 模式也已完成 down 與唯讀確認。Cleanup 先擷取證據並嘗試 Ctrl-C，再依 boot ID、PID 與 start time 對自有程序有限等待，必要時 TERM/KILL；各階段 best-effort，中斷失敗仍繼續處理其他自有資源。Docker 只清理 metadata 符合本次專案的 Compose，並查詢容器、網路已移除。確認程序停止且所有階段成功後才刪 scratch；否則回傳非零，保留 scratch、Compose、manifest 與 report，不能標示 cleaned。即使 daemon 不可用仍處理自有 TTY/程序；重試不依賴 pane 存在。不以程序名稱 kill、不清除別人的 lock。

Docker image、build cache、Agent volumes 留在你提供的可丟棄 daemon；完成後用**建立該 daemon 的工具**銷毀它，證據目錄留在 daemon 外。daemon 的建立/銷毀不是本 helper 管理範圍；未完成其銷毀就不能宣稱 Docker 資源已全數清理。中斷 build 後也要銷毀該 daemon。設定模式不建立這些資源。
本技能不建立 DinD、不自動佈建 daemon，也不放寬共享 Docker 的安全門檻。

## Helpers

可執行程式：`scripts/control.mjs`；完整呼叫格式為 `"$CONTROL" "$PROOF" ACTION ...`。

| Action | 用途 |
| --- | --- |
| `launch [docker]` | 建立獨立 HOME、帶 sentinel 的專案、tmux socket；docker 模式需獨佔 DOCKER_HOST |
| `project verify-second` | 建立或切換同一隔離 HOME 下的第二個 scratch 專案，納入 cleanup |
| `doctor` | 唯讀檢查目前執行個體 |
| `open LABEL COMMAND...` | 在真實 PTY 執行 Devbox 命令，記錄 argv/輸入/輸出 |
| `wait '提示文字' [SECONDS]` | 等待目前有效提示；預設 30 秒，逾時保存 failure-pane.txt，命令已結束則失敗 |
| `send KEY...` | tmux 按鍵，如 `Enter`、`Right`、`Space`、`C-c` |
| `text '文字'` | 原樣輸入，不將文字解析成按鍵 |
| `finish LABEL [SECONDS]` | 等待結束（預設 300 秒）、保存畫面及 exit，回傳 CLI exit code |
| `snapshot LABEL` | 保存指定非機密檔案與專案 sentinel 的第二視角 |
| `check-init` | 斷言初次 init-save 的公開檔案快照，保存 verdict |
| `cleanup` | 清理本次建立的 TTY/scratch；保留所有證據，可重跑 |

`run.json` 是自己產生的本次資源記錄，只供此 checkout 使用；不要用外來 manifest。需要維護功能地圖時使用 `/maintain-verification-skill`。

維護 helper 後，以現有 bundle 執行 `node .agents/skills/verify-devbox/scripts/control.regression.mjs`。這是 Node assert smoke script，使用真實 tmux、script 與 CLI。Docker 故障只指向本 run 不存在的 Unix socket；先斷言 cleanup 保留資料，再由 finally 確認程序停止，刪除這份從未建立 daemon/container 的測試 scratch，證據與 teardown 紀錄保留。正式 cleanup 的安全門檻不變；這不是 Docker 生命週期端到端通過。

