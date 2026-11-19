# 建置 Workspace

使用者以 `devbox build` 將 Global 選取的 Node runtime 與 Agent 安裝進共用 Workspace image，再以沙箱 Shell 確認工具真的可用。

## Sub-features

- `build-default` 使用 Docker layer cache 建置 image。
- `build-cache` 顯式指定 --cache。
- `build-no-cache` 指定 --no-cache 重新建置。
- `build-tools` 在真實 Shell 中執行設定的 Node 與 Agent。

## How to get to it (user POV)

- `devbox build`。
- `devbox build --cache`。
- `devbox build --no-cache`。
- 建置後 `devbox up`、`devbox sh` 執行 Node/Agent。

## Driving it with control.mjs

Preconditions:

- `launch docker` 指向本次獨佔、可丟棄 daemon；doctor exit 0。
- 完成 init-save；非 root UID/GID；有 image/apt/Node 下載網路。Agent 分支另先在 Global 選取要安裝的 Agent。

- **預設。** `"$CONTROL" "$PROOF" open build-default build`；`"$CONTROL" "$PROOF" finish build-default 1800`。結束必須 exit 0、有 `Built Workspace image: devbox-workspace:latest`。逾時是失敗：保存輸出、doctor、cleanup，不啟動第二份 build。
- **Cache。** 分別 `open build-cache build --cache`、`finish build-cache 1800`，以及 `open build-no-cache build --no-cache`、`finish build-no-cache 1800`，每個都使用完整 CONTROL/PROOF 前綴。證據須含完整 Docker build 輸出與結束碼；不能因為預設成功就標記兩個 flags 通過。
- **Image 證據。** `export DOCKER_HOST="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1])).dockerHost' "$PROOF/run.json")"`；`docker image inspect devbox-workspace:latest > "$PROOF/workspace-image.json"`。記錄新 image ID/建立時間，並保留隔離 HOME 的 `.devbox/build/Dockerfile`、`entrypoint.sh`、`supervisord.conf`、`.dockerignore` 作為建置副作用證據；位置由 run.json 的 scratch 欄位取得。不要複製 Agent 認證目錄。
- **實際可用性。** 接著走 [沙箱與 Shell](sandbox.md) 的 up/sh 路徑，`node --version` 必須為選定的 24 release line，並寫檔驗證 bind mount。若有選 Agent，逐一在同一 Shell 執行選取工具的版本命令：`claude --version`、`codex --version`、`agy --version`、`omp --version`。只有實際選取並成功執行的工具可標記通過；不需登入或對外送出訊息。

## Gotchas

- image tag 固定；HOME 不隔離它。不得在共享 daemon 嘗試 build，也不要刪除或覆蓋使用者原有 image。
- `--no-cache` 不是 dry-run；會發網路請求、寫 image/build cache，且不保證上游套件可重現。
- 基準只含 Node 24，沒有 Agent；build-tools 的 Agent 子路徑必須先完成真實設定，不得以 Node 成功代替。
- 顯示 image ID 不等於 Shell 可用；up 與 runtime 檢查也是此功能完成條件。
- 有下載/編譯失敗就保存完整輸出、清理自有資源並回報，不能用假 Docker 或縮減 runtime 選項把原旅程改成成功。
