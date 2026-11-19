# 調整設定

使用者透過 `devbox config` 選擇修改目前專案或 Workspace Docker image，檢視前後差異後確認；變更 Global Node 選項時，受影響的專案必須選擇替代版本或 None。

## Sub-features

- `config-local` 修改專案的 Node 與 published ports，重發 Compose。
- `config-global` 修改共用 Node、Agent 與通知，提示重新 build。
- `config-cancel` 確認時選 No，維持原設定。
- `config-node-replacement` 移除已被專案使用的 Node 時選替代值。

## How to get to it (user POV)

- `devbox config` → `Current project`。
- `devbox config` → `Workspace Docker image`。
- 在最後確認提示選 Yes 或 No。

## Driving it with control.mjs

Preconditions:

- 完成基準 init-save；doctor exit 0。每個分支先 snapshot，結束後再 snapshot。

- **Local。** `open config-local config` → `wait 'Where should this configuration apply?'` → `send Enter`（Current project）→ `wait 'Selected Node release line'` → `send Enter`（24）→ `wait 'Published ports'` → `send -N 21 BSpace`（基準既有 `VERIFY_PORT:5173:5173` 恰為 21 字元）→ `text 'VERIFY_PORT:5188:5173'` → `send Enter Enter`。等待 `Save Project configuration?`，確認畫面差異後 `send Enter`、`finish config-local`。exit 0、`Local configuration updated.`；Local ports 為新值，Compose 為 `${VERIFY_PORT:-5188}:5173`，Global/registry/sentinel 未變。所有動作皆以 `"$CONTROL" "$PROOF"` 為前綴。
- **Global。** `open config-global config` → `wait 'Where should this configuration apply?'` → `send Down Enter` → `wait 'Configured Node release lines'`。保留 24，`send Down Space Enter` 加入 22；`wait 'Configured Agents'` → `send Enter`；`wait 'Enable Agent notifications'` → `send Enter`（維持 No）。`wait 'Save Global configuration?'`、檢查差異、`send Enter`、`finish config-global`。exit 0、有 `Run devbox build`；Global Node 同時有 24、22，Local 仍為 24，Compose 仍選 24。再執行 Local 流程選取 22，確認 Local/Compose 更新，證明新選項可使用。
- **取消。** 重新做 Local 變更但在 `Save Project configuration?` 選 `send Right Enter`。`finish config-cancel` 應 exit 0、有 `Local configuration was not changed.`；前後 snapshot 完全相同。Global 的 `Save Global configuration?` 也各做一次 No，應有 `Global configuration was not changed.` 且前後不變，另用 config-global-cancel label。
- **替代 Node。** 基準只有 24 也能測 None：Global 選單停在 24 時 `send Space Enter` 取消 24；保持 Agents 空、通知 No。接著應出現 `Selected Node release line`，唯一選項是 None；`send Enter`，檢視 `Save Global configuration?` 的 Global 與 Project 差異後確認。`finish config-node-replacement` exit 0；Global node 為空、Local node 為 null、Compose 不含 NODE_VERSION，port 與 sentinel 不變。若要驗證替換成 22，先由 Global 路徑加入 22，再移除 24，不能直接修改 YAML 偽造旅程。

## Gotchas

- Current project 為 scope 預選值，Workspace Docker image 在下一列；每次看畫面再送鍵。
- BSpace 次數須依 before snapshot 的 Local ports 與目前欄位重算，從行尾只刪既有內容；空欄位不送 BSpace。超量刪除可能觸發 [multiline 的 DEL 陷阱](registration.md#gotchas)，不能把畫面看似合法的值直接判為 parser 錯誤。雙 Enter 仍是提交方式，不以更換 port、改 YAML 或略過 config journey 代替驗證。
- 本檔用精簡 action 記法；每個 action 的完整呼叫方式見主技能 Helpers。
- 基準沒有第二個 Node；替換成 22 未完成新增前置條件就應回報失敗。None 分支是另一個 sub-case，不替 22 分支背書。
- 設定變更不會自動重建 image，也不會自動重啟既有容器；要證明容器採用新設定，繼續 build/down/up/sh 流程。
- Agent 安裝/通知分支需要選取 Agent、可用下載網路、WSLg Pulse socket 等條件；空白基準沒有這些條件，不把 YAML 寫入當作 Agent 可用證明。
