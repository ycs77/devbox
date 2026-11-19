# 專案註冊

使用者在目前目錄執行 `devbox init`，選擇共用 Workspace 與專案設定；設定只寫進 HOME，不往專案加 Dockerfile 或設定檔。

## Sub-features

- `init-save` 首次提交 Global/Local、專案登錄與 Compose。
- `init-cancel` 最終確認選 No，專案不註冊。
- `init-repeat` 已註冊目錄再次 init，不重寫設定。
- `init-existing-global` 新目錄沿用既有 Global，只設定 Local。

## How to get to it (user POV)

- 在要使用的專案目錄執行 `devbox init`。
- 再次在同一目錄執行同一命令，應提示已註冊。
- 在另一個尚未註冊的目錄執行 init，會沿用目前使用者的 Global。

## Driving it with control.mjs

Preconditions:

- 首次流程從 launch 的空白 HOME 開始；doctor exit 0。
- 基準選 Node 24、不選 Agent、通知選 No，Local 選 24，ports 改為 `VERIFY_PORT:5173:5173`。

### init-save

```bash
"$CONTROL" "$PROOF" open init-save init
"$CONTROL" "$PROOF" wait 'Configured Node release lines'
"$CONTROL" "$PROOF" send Enter
"$CONTROL" "$PROOF" wait 'Configured Agents'
"$CONTROL" "$PROOF" send Enter
"$CONTROL" "$PROOF" wait 'Enable Agent notifications'
"$CONTROL" "$PROOF" send Right Enter
"$CONTROL" "$PROOF" wait 'Selected Node release line'
"$CONTROL" "$PROOF" send Enter
"$CONTROL" "$PROOF" wait 'Published ports'
"$CONTROL" "$PROOF" send -N 18 BSpace
"$CONTROL" "$PROOF" text 'VERIFY_PORT:5173:5173'
"$CONTROL" "$PROOF" send Enter Enter
"$CONTROL" "$PROOF" wait 'Save configuration?'
"$CONTROL" "$PROOF" send Enter
"$CONTROL" "$PROOF" finish init-save
"$CONTROL" "$PROOF" snapshot after-init
"$CONTROL" "$PROOF" check-init
```

`Configured Node release lines` 預選 24；Agents 無選取；通知預設 Yes，Right 切到 No；Local Node 預選 24。此 multiline 不支援 `C-u` 清除；首次基準的 `APP_PORT:5173:5173` 共 18 字元，從行尾送恰好 18 次 BSpace，再填新值、雙 Enter 提交。每次依真實畫面及公開設定核對既有值，內容已變就重算刪除次數，不能超量刪除。

`finish init-save` 應 exit 0，終端有 `Next: run devbox build`。`check-init` 從 after-init 的公開檔案快照斷言 Global、Local、registry、Compose 的 runtime/port/bind source、專案 sentinel 與 exit code，產生 `init-save.verdict.json`。這是檔案第二視角，不是內部 setter；只適用上述首次基準流程。

### 其他分支

- **重複。** `"$CONTROL" "$PROOF" snapshot before-repeat`；`"$CONTROL" "$PROOF" open init-repeat init`；`"$CONTROL" "$PROOF" finish init-repeat`；`"$CONTROL" "$PROOF" snapshot after-repeat`。終端有 `Project is already registered.`、exit 0；`diff -ru "$PROOF/before-repeat" "$PROOF/after-repeat"` 應無差異。
- **取消。** 使用全新 launch，依上述相同按鍵完成所有欄位；到 `Save configuration?` 時執行 `"$CONTROL" "$PROOF" send Right Enter`，再 `finish init-cancel`、`snapshot after-cancel`（open 的 label 改為 init-cancel）。終端有 `Project registration was not changed.`、exit 0；沒有 config.yaml、projects.yaml 或 project-compose.yaml；專案 sentinel 未變。
- **既有 Global。** init-save 後，`"$CONTROL" "$PROOF" project verify-second`、`"$CONTROL" "$PROOF" doctor`、`"$CONTROL" "$PROOF" open init-existing-global init`。只能出現 `Selected Node release line`、`Published ports`、`Save configuration?`，不能再次出現 Global 選單；以上述 Local 按鍵選 24、改 ports、儲存，接著 `finish init-existing-global`、`snapshot after-second`。registry 同時有兩個專案、Global 快照不變，且第二份 Compose bind source 指向 scratch 下的 verify-second。cleanup 會處理兩個專案。

## Gotchas

- init 要求 stdin/stdout 都是 TTY；pipe `printf | node dist/cli.mjs init` 會失敗，不是有效的互動證明。
- Multiselect 以 Space 切換、Enter 提交；只按 Enter 保留預選 Node 24，不會選取 Agent。
- 目前 Clack 在空欄位繼續收 BSpace，可能把不可見的 DEL 留進值，造成畫面看似合法的 port 被拒絕。只刪既有字元數；已有 Global 時 Local 的初始 port 仍應看實際畫面核對，不沿用其他流程的字數。`.input` 可能未呈現這些按鍵，調查時也要檢查 `.terminal` 的原始碼位，不能只看去除控制字元後的畫面。
- 按 Ctrl-C 應 exit 130；中斷與最終選 No 是兩條不同路徑。
- 空白 seed 沒有既有 Global/第二專案；未實際建立就回報 `init-existing-global` 缺少前置條件，不以 init-repeat 代替。
