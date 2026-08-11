# 共用 Multi-runtime Workspace image 討論結論

> 記錄日期：2026-08-10。這是後續討論的暫時結論，不是新的架構決策；既有行為仍以 `CONTEXT.md` 與 `docs/adr/` 為準。

## 暫時結論

Devbox 可以考慮改成 **一份使用者層級共用的 multi-runtime Workspace image，加上每個 Project 各自一個 Sandbox container**。

這不是把所有 Projects 放進同一個 all-in-one container。每個 Project 仍保有獨立的 workspace mount、writable layer、程序、網路與生命週期；共用的只有 immutable image。

```text
使用者實際啟用的 Runtime release lines 聯集
                    ↓
       Devbox CLI 動態產生 Dockerfile
                    ↓
          共用 multi-runtime image
                    ↓
      每個 Project 建立自己的 container
                    ↓
 container create/start 時選擇預設 Runtime
```

例如，共用 image 安裝 Node 20、Node 24、PHP 8.3 與 PHP 8.4 後，可以同時供以下 Projects 使用：

- Project A：預設 Node 20、PHP 8.3。
- Project B：預設 Node 24、PHP 8.4。
- Project C：預設 Node 24，不啟用 PHP。

Project 的預設版本不在 image build 階段寫死，而是在 container create/start 階段設定，因此這些 Projects 可以真正共用同一個 image digest。

## Image 收錄範圍

共用 image 不必預裝 Built-in catalog 的所有版本。Devbox CLI 根據使用者實際啟用的 Runtime release lines 聯集產生 Dockerfile，只安裝目前需要的工具。

新增 release line 時，Devbox 更新這份使用者層級工具集合並重建 common image。任一 Runtime 更新導致整份 image 更新是目前可接受的取捨。

這個模型帶來兩種不同的「未啟用」狀態：

- 沒有被任何 Project 選用的 Runtime，不安裝進 common image。
- 已被其他 Project 選用、但目前 Project 沒有啟用的 Runtime，仍存在於 image，只是不成為該 container 的預設工具。

Runtime activation 是使用體驗與命令解析規則，不是安全邊界。Project 間的安全邊界仍由各自的 Sandbox container 與 workspace mount 提供。

## Runtime 選擇方向

初步方向是不把共享 home 裡的 `nvm alias default`、shell alias 或其他可變全域設定當成核心契約。這些機制可能只在互動式 shell 生效，AI Agent、entrypoint 與其他非互動式程序不一定會得到相同行為。

較穩定的方向是：

- Runtime 安裝在帶版本的固定路徑。
- Project 設定記錄選定的 release line。
- container 啟動時驗證該版本已安裝。
- 使用 container-local `PATH` 或 command shims 提供 `node`、`npm`、`php`、`phpize`、`php-config` 等預設命令。
- 不把 Project default 寫入跨 Projects 共用的 Agent home。

PHP 使用多版本 `apt` packages 搭配每個 container 自己的 `update-alternatives`，或使用隔離安裝路徑搭配 command shims，兩者都可繼續評估。Composer 應由選定的 PHP 執行；只依賴 shell alias 可能無法涵蓋非互動式程序。

## 驗證範圍

目前不打算替 base image、系統函式庫或所有 PHP × Node 組合建立完整相容性矩陣。Devbox 信任選定的 base image 與套件來源。

Devbox 仍應驗證自己直接承諾的最小契約，例如：

- Docker image 成功建置。
- 每個已安裝 Runtime 的 executable 可以啟動並回報預期版本。
- container 選定 default 後，一般命令解析到正確版本。
- 未選 Runtime 時，不會意外成為該 Project 的預設命令。

這些檢查驗證 Devbox 的組裝與 selector，而不是重新驗證底層發行版。

## 預期優點

- 每個 Project 仍保有 Sandbox 隔離與獨立生命週期。
- Projects 直接共用同一組 image layers。
- 新 Project 選用已安裝的 Runtime 時，不需要建立新的 Toolchain 組合 image。
- 使用者需要的工具可一次準備完成，後續只需切換 Project default。
- 可以刪除或簡化按 Toolchain 組合 Workspace images 的 fingerprint、assembly 與 cleanup 邏輯。
- Global 工具、PATH 與版本選擇可由 Devbox 統一治理，提供一致的互動式與非互動式使用體驗。

## 接受的取捨

- Common image 可能包含目前 Project 未使用、但其他 Project 需要的 Runtime。
- 新增或更新任一 Runtime 時，可以重建整份 common image。
- 新 release line 可以先加入使用者層級工具集合，再重建 common image。
- 願意投入實作成本處理多版本 PHP、PATH、Composer、npm 與其他 global 工具設定。
- 不以完整底層版本矩陣驗證作為導入前提。

## 與現行決策的關係

這份提案保留 `CONTEXT.md` 定義的 per-Project Sandbox 邊界，但會改變 Workspace image 與 Toolchain 的實作模型，因此目前與以下決策不一致：

- [ADR-0005](../adr/0005-linked-runtime-bundles.md)：目前只把 Project 選到的 Runtime bundles 組裝進 Workspace image，未選 Runtime 不存在。
- [ADR-0007](../adr/0007-global-platform-lock.md)：目前 Platform lock 與更新流程按 release line 準備受影響的 Workspace images。
- [ADR-0016](../adr/0016-internal-image-assembly.md)：目前 Build module 接收一或多個 Toolchains，分別產生具 fingerprint 的 Workspace images。
- [ADR-0019](../adr/0019-open-runtime-release-lines.md)：目前 Project 可以直接選擇 Built-in suggestions 之外的格式合法 release line，再於該 Project 的 atomic build 中驗證。

因此這份研究筆記只能保存討論方向，不能直接取代上述 ADR。若後續確定採用，必須明確更新領域詞彙、image identity、Platform lock、Runtime 新增流程、Project sync、Compose reference 與 cleanup 契約。

## 尚待決定

1. 使用者層級 Runtime 工具集合如何儲存，以及由哪些 Project 操作加入或移除版本。
2. Common image 的 identity、tag、更新與舊 container 遷移規則。
3. Node 與 PHP 的安裝來源及固定目錄格式。
4. 採用 command shims、`update-alternatives`，或兩者分工的 selector 設計。
5. Composer 與 Node package managers 如何跟隨 container 選定的 Runtime。
6. Project 未選某個已安裝 Runtime 時，僅不設為 default，還是應從一般 `PATH` 隱藏。
7. Runtime 從使用者層級工具集合移除時，仍使用舊 image 的 Projects 如何處理。
