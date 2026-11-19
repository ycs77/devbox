# 移除專案

使用者移除目前專案的沙箱與 Devbox 登錄/本機狀態；原始碼與全域設定仍保留。互動確認與 --yes 是兩個入口。

## Sub-features

- `remove-cancel` 確認選 No，不刪除任何專案狀態或容器。
- `remove-confirm` 確認選 Yes，刪除沙箱、Local/Compose 與 registry 項目。
- `remove-yes` --yes 跳過確認，執行相同移除。

## How to get to it (user POV)

- `devbox rm` → 移除確認 Yes / No。
- `devbox rm --yes`。

## Driving it with control.mjs

Preconditions:

- 本次使用 `launch docker` 的獨佔 daemon，doctor 通過；init-save/build/up 完成。
- 先保存容器 inspect、`snapshot before-remove`；移除流程僅能對本次 scratch 專案操作。

- **取消。** `"$CONTROL" "$PROOF" open remove-cancel rm` → `"$CONTROL" "$PROOF" wait 'its Sandbox, and Devbox state?'` → `"$CONTROL" "$PROOF" send Right Enter` → `"$CONTROL" "$PROOF" finish remove-cancel` → `"$CONTROL" "$PROOF" snapshot after-cancel-remove`。exit 0、終端有 `Project removal was not changed.`；與 before-remove snapshot 無差異，容器 ID/Running 保持不變。
- **確認。** `open remove-confirm rm`、等待同一提示、`send Enter`（Yes）、`finish remove-confirm`、`snapshot after-remove`；每個 action 使用完整 CONTROL/PROOF 前綴。exit 0、`Removed Project:` 後接本次 scratch 專案。以 [沙箱地圖](sandbox.md) 的 manifest/inspect 指令保存容器已不存在的錯誤與非零 exit；after-remove registry 不再含專案、無 project-config.yaml/project-compose.yaml；Global config.yaml 與 user-file.txt 完全不變。額外檢查 scratch HOME 下原本的專案狀態目錄不存在，不能只看 registry。
- **免確認。** 在全新 docker 模式 run 重新 init/build/up，`open remove-yes rm --yes`、`finish remove-yes`、`snapshot after-remove-yes`；無確認提示，後置條件與 remove-confirm 相同。不可因互動確認已通過就將此入口標記通過。
- **不可用的非互動入口。** CLI 沒有 TTY 且未帶 --yes 會 exit 2；這是安全拒絕，不是刪除成功。若變更涉及此行為，在同一隔離 HOME 用非 PTY 額外捕捉 stdout、stderr、exit，再確認前後狀態不變。

## Gotchas

- `--yes` 不是 dry-run；會真的呼叫 Docker Compose down 並刪檔。
- rm 不會刪專案原始碼、Global、Workspace image 或共用 Agent volumes；這些保留也屬於預期結果。
- 基準的空白 HOME 沒有 running sandbox，缺 build/up 就無法證明容器移除；僅有登錄移除不能算完整 remove-confirm 通過。
- rm 已刪除 Compose 時，helper cleanup 沒有檔案可再次 down；應先確認本次容器已不存在，再銷毀本次 disposable daemon。失敗仍保留證據、清理自己建立的資源。
