# 沙箱與 Shell

使用者啟動專案沙箱、以 devbox 帳號進入 Bash，在專案目錄工作；可停止保留容器、再次啟動，或 down 移除容器但保留專案註冊。

## Sub-features

- `sandbox-up` 啟動對應專案的容器。
- `sandbox-shell` 進入 Bash，驗證使用者、Node 與可寫的專案掛載。
- `sandbox-stop` 停止並保留容器，再次 up 可啟動原容器。
- `sandbox-down` 移除容器，但保留 Local/registry/專案檔案。

## How to get to it (user POV)

- 專案目錄執行 `devbox up`。
- `devbox sh` 進入執行中的沙箱，`exit` 返回主機。
- `devbox stop` → `devbox up`。
- `devbox down`。

## Driving it with control.mjs

Preconditions:

- `launch docker`、doctor 通過、init-save 完成、build 成功；無 Agent、通知 false。
- 使用專用 daemon，容器內 5173 對應主機 5173 必須可用；需要改 port 時先走 Local config，不直接改 Compose。

- **啟動。** `"$CONTROL" "$PROOF" open sandbox-up up`；`"$CONTROL" "$PROOF" finish sandbox-up`。取得本次容器名稱：`export CONTAINER="$(node -p '"devbox-" + JSON.parse(require("node:fs").readFileSync(process.argv[1])).projectName' "$PROOF/run.json")"`。從 manifest 設定 daemon：`export DOCKER_HOST="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).dockerHost' "$PROOF/run.json")"`。`docker inspect "$CONTAINER" > "$PROOF/sandbox-up.inspect.json"`；State.Running 為 true、Mounts.Source 是 scratch 專案、Config.WorkingDir 為 `/workspace/` 接本次 projectName。記錄容器 ID；running 還不算可用。
- **進 Shell。** `open sandbox-shell sh` → `wait 'devbox@devbox'`。以 `text 'id -un; id -u; pwd; node --version; printf "from-sandbox\n" > shell-proof.txt; cat shell-proof.txt'`、`send Enter` 執行，觀察使用者 devbox、非 root UID、正確 workspace、v24、from-sandbox。以上及後續 action 都使用完整 CONTROL/PROOF 前綴。`text 'exit'`、`send Enter`、`finish sandbox-shell` 應 exit 0。
- **掛載副作用。** `export SCRATCH="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).scratch' "$PROOF/run.json")"`；`export PROJECT_NAME="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).projectName' "$PROOF/run.json")"`；`cat "$SCRATCH/$PROJECT_NAME/shell-proof.txt" > "$PROOF/shell-proof.txt"` 必須是 from-sandbox。`snapshot after-shell` 必須看到 shell-proof.txt 與未改變的 user-file.txt。驗證使用者身份與寫檔後才算沙箱可用。
- **Stop/重啟。** `open sandbox-stop stop`、`finish sandbox-stop`；`docker inspect "$CONTAINER" > "$PROOF/sandbox-stop.inspect.json"`，Running false、ID 與原本相同。`open sandbox-restart up`、`finish sandbox-restart` 後再次 inspect 為 Running true、相同 ID；再 sh 讀 shell-proof.txt，內容仍在。
- **Down。** `snapshot before-down`；`open sandbox-down down`、`finish sandbox-down`。`docker inspect "$CONTAINER" > "$PROOF/after-down.stdout" 2> "$PROOF/after-down.stderr"; printf '%s\n' "$?" > "$PROOF/after-down.exit"`，應找不到本次容器且非零。`snapshot after-down`；與 before-down 相同，專案/Local/registry 保留。

## Gotchas

- 基準 seed 沒有 image 或 running container；build/up 缺一就回報原因，不以直接 docker run 代替 Devbox 使用者流程。
- Shell 的穩定提示是 `devbox@devbox`，不是座標或固定等候秒數。若 prompt 不符，doctor 後保留終端並調查，不盲送 exit 以免退出主機 shell。
- sh 會保持本次 PTY 開啟；先正常 exit 再開 stop/down。Ctrl-C 中斷也要 cleanup。
- `stop` 不移除容器；`down` 不刪除專案註冊；兩者不能互相替代驗證。
- Agent shared volumes 與通知不是本基準；要測通知必須有可用的 WSLg Pulse socket，光有設定 true 不算通知成功。
