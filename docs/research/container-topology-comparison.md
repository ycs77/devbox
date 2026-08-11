# Devbox 容器拓撲比較

> 研究日期：2026-08-02。這是方案比較筆記，不是新的架構決策；既有行為仍以 `CONTEXT.md` 與 `docs/adr/` 為準。

## 現況更新（2026-08-10）

後續討論提出第三種方案：**一份使用者層級共用的 multi-runtime Workspace image，加上每個 Project 各自一個 Sandbox container**。這不是本文件 B 方案的單一 all-in-one container，因此不會把所有 Projects 合併到同一個檔案、程序、網路、資源與故障邊界。

新方案暫定由 Devbox CLI 根據使用者實際啟用的 Runtime release lines 聯集動態產生 Dockerfile，只把需要的版本安裝進 common image；每個 Project container 在 create/start 階段選擇自己的預設 Runtime。新增或更新 Runtime 時，可以重建整份 common image。

因此，本文件對「單一 all-in-one container」的比較與結論仍然成立，但不涵蓋這個保留 per-Project Sandbox 邊界的新方案。新方案的目前結論、接受的取捨、與既有 ADR 的衝突及尚待決定事項，另見[共用 Multi-runtime Workspace image 討論結論](./shared-multi-runtime-image.md)。

## 結論

Devbox 應維持目前的 **每個 Project 一個 Sandbox container，加上相同 Toolchain 共用 Workspace image**。

單一 all-in-one container 的主要優勢是 image 模型、container 數量與第一次完成後的切換流程較簡單；但它會把所有 Project 合併成同一個檔案、程序、網路、資源與故障邊界。對 Devbox 而言，這不只是實作替換，而是把產品從「每個 Project 一個 Sandbox」改成「一台容器化開發工作站」。尤其 AI Agent 會直接取得所有已掛入 Project 的讀寫權限，與目前只開放當前 Project workspace 的邊界衝突。

如果目標是可信任的 monorepo 或一組緊密相關、共用 Toolchain 的專案，all-in-one 可以成立；若仍要支援彼此獨立、版本不同、可分別啟停且只向 Agent 開放當前 Project 的一般專案，現行方案較合適。

## 先校正兩個方案的定義

### A. 現行方案

現行設計不是「每個 Project 各存一份完整 image」，而是：

- 每個 Project 有自己的 Sandbox container、writable layer、Compose project、網路與生命週期。
- Workspace image 由 Base 與所選 Runtime 的完整鎖定內容計算 fingerprint；Project path、AI Agent 與 container 狀態不在 fingerprint 內。
- 選到相同 Toolchain 的 Projects 會共用同一個 `devbox-workspace:<fingerprint>` image。
- 不同 Workspace images 仍可共用 Base 與相同 image layers。Docker 官方說明，多個 containers 可以共用同一組唯讀 image layers，各自只增加自己的 writable layer；不能把每個 image 的 virtual size 直接相加當成實體用量（[storage drivers](https://docs.docker.com/engine/storage/drivers/)、[`docker system df -v`](https://docs.docker.com/reference/cli/docker/system/df/)）。
- 初版實際可選的是 PHP、Node、兩者或皆不選；PHP extensions 是固定策展集合，尚不是每個 Project 可自由增減的功能選項（[ADR-0005](../adr/0005-linked-runtime-bundles.md)、[ADR-0006](../adr/0006-preinstalled-php-extensions.md)）。

### B. all-in-one 方案

此比較假設：

- 使用者只有一個長期存在的 Sandbox container。
- 所有支援的 PHP、Node 版本、套件管理器與功能都預裝在同一個 image。
- 所有 Projects 同時以可讀寫方式掛入該 container。
- Devbox 另做一層依工作目錄或命令選擇 Runtime 的機制。

若 Projects 原本存在 host 上，這裡實際使用的是 **bind mounts**，不是 Docker-managed named volumes。Docker 將 bind mount 定義為把 host 路徑直接掛入 container，且預設可寫；named volume 則由 Docker 管理，適合 container 產生的持久資料，但不適合還要由 host 直接編輯的既有 source tree（[bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)、[volumes](https://docs.docker.com/engine/storage/volumes/)）。

## 優缺點比較

| 面向 | A. 每 Project 一個 container，共用 Toolchain image | B. 單一 all-in-one container |
|---|---|---|
| Project 隔離 | 每個 container 是獨立程序與檔案系統邊界；刪除或重建一個不會直接影響其他 container（[Docker container 概念](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/)）。 | 所有 Projects 位於同一個執行邊界。任何程序只要有相同 Unix 權限，就能讀寫全部已掛入的 Projects。 |
| Runtime 版本 | 版本固定在 immutable Workspace image；不同 Project 可直接使用不同 image，不需要改全域 symlink 或 PATH。 | 可以平行安裝多版本，但「預裝」不等於「自動選對版本」。仍需可靠的 per-process/per-working-directory selector；若使用全域 symlink 或全域設定，並行工作會互相切換。 |
| 開放 release line | 現行設計只在 Project 實際選到某個 PHP `X.Y` 或 Node `X` 時解析、建置與驗證，因此可保留 ADR-0019 的 open release-line 行為。 | 無法事先預裝未知的未來或非 Built-in release line。必須改成封閉 catalog、重建整個 all-in-one image，或在 container 內臨時安裝；三者都會改變目前契約。 |
| 功能組合 | 只把選到的 Runtime 放進 Workspace；未選 Runtime 不在該 image。未來若增加可選功能，成本可落在受影響的 fingerprint。 | 功能都已存在，切換快且沒有組合式 Workspace assembly；但每位使用者都承擔全部工具、native dependencies、套件與更新面積。Docker 建議共用 stage 以重用共同內容，也建議避免不需要的套件以降低 image 大小、依賴與建置時間（[build best practices](https://docs.docker.com/build/building/best-practices/)）。 |
| Image 磁碟 | Base 與相同 layers 可跨 images/containers 共用，container 本身只增加 writable layer。缺點是不同 Toolchain image 仍可能產生 unique layers；目前實驗也確認 combined image 的第二個 Runtime layer 未完全重用，PHP-first 時多出約 143.5 MB 的 Node layer（[ADR-0005](../adr/0005-linked-runtime-bundles.md)）。 | 只有一份完整 image 與一個 writable layer，可避免 Toolchain 組合 image 的 unique layer，也只需一份 container 內 Agent 安裝；但所有未使用 Runtime 版本與功能永遠占空間。哪個方案較省，取決於 Project 數、實際使用版本集合、Agent/writable-layer 大小與 layer reuse，不能只用 container 數判斷。 |
| 建置與第一次使用 | 第一次遇到新的 Toolchain fingerprint 時要準備與驗證；相同 fingerprint 後續可直接共用。只建實際需要的組合。 | 第一次建置或下載會最重，但完成後每個預裝版本都能立即選用，不需再建 Toolchain image。 |
| 更新範圍 | Runtime 更新只會讓選到該 Runtime 的 Workspace fingerprints 改變；其他組合不必因未使用的 Runtime 變更。 | 任一 Runtime、extension 或 package manager 更新都會產生新的完整 all-in-one image，並要求整個共用 container 重建；所有 Projects 同時跨版本。 |
| Container 數與操作模型 | Docker/Compose 物件較多，Devbox 需要管理每個 Project 的 create/start/stop/down、retained Compose 與清理。Compose project name 本來就用來隔離不同環境與避免不同專案資源互相干擾（[Compose project name](https://docs.docker.com/compose/how-tos/project-name/)）。 | 只有一個主要 container，表面上的 lifecycle 與 UI 較簡單；但 Devbox 必須在 container 內另管每個 Project 的 working directory、Runtime selection、程序、log 與 readiness。複雜度是移入 container，而非全部消失。 |
| 新增或移除 Project mount | 建立該 Project 的 container 即可，不動其他 Projects。 | 一般 bind mounts 在建立 container 時決定；Project 集合改變時，需重建共用 container，或一開始掛入過大的共同上層目錄。VS Code Dev Containers 的官方指引同樣要求 rebuild container 才會套用變更後的 workspace mount（[workspace mount](https://code.visualstudio.com/remote/advancedcontainers/change-default-source-mount)）。 |
| 生命週期與故障範圍 | 每個 Project 可獨立 stop、down、replace；一個 Project 的 Agent 安裝、程序或 writable layer 壞掉，不必停止其他 Projects。 | 共用 container 是單一故障點。重建、entrypoint 失敗、磁碟層損壞或 container stop 都同時中斷全部 Projects。優點是只需修復一次，不會有多個 container 漂移。 |
| 程序與 signal | 每個 Project 有自己的 PID/container 邊界，`sh`、`exec`、stop 與 readiness 對象明確。 | 所有開發 server、queue worker、watcher 與 Agent 都在同一個 container；需要額外 supervisor 或 Project process registry，才能避免 stop、signal、PID 與 log 歸屬混淆。 |
| 網路與連接埠 | 各 Project 可用自己的 Compose bridge network；不同 containers 可在各自網路空間使用相同 container port，再映射到不同 host port。Docker 也明確支援用 user-defined networks 分隔不同群組（[networking overview](https://docs.docker.com/engine/network/)）。 | 所有程序共用一個 container network namespace，同一時間不能各自 bind 相同的 container address/port。Devbox 必須讓每個 Project 在 container 內也使用不同 port，而不只是 host mapping 不同。 |
| CPU / memory 邊界 | Docker 可按 container 設定 CPU 與 memory limits，因此未來可做 per-Project 資源邊界（[resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)）。 | Docker 只能直接限制整個 all-in-one container。要做 per-Project 限制，需在 container 內再建立 cgroup/process 管理層。沒有需求時，單一資源池反而較容易充分利用。 |
| Mutable state 與 cache | 每個 container writable layer 各自保存 Agent executable 與其他 ephemeral 變更，會有重複；共享資料必須刻意放在 volume。現行 Agent home 已按 Agent 跨 Projects 共用（[ADR-0009](../adr/0009-latest-upstream-ai-agent.md)、[ADR-0010](../adr/0010-shared-agent-home.md)）。 | package-manager cache、下載內容與 Agent executable 可天然只留一份，冷啟動後較省；但 global config、global packages、shell state、cache corruption 與手動安裝也會跨 Project 汙染。必須重新定義哪些狀態可共用。 |
| 重現性 | image fingerprint 精確包含 Base、所選 Runtime 與 assembly recipe；Project 的工具邊界容易觀察。 | 若所有版本都 immutable 並只靠 per-process PATH 選擇，仍可重現；但若允許在長期 container 內安裝或切換全域工具，實際狀態會逐漸偏離 image。 |
| 維護成本 | 需要 Platform lock、Runtime bundles、fingerprints、驗證、組合建置與 cleanup；當 PHP 有 `m` 條、Node 有 `n` 條 release lines 時，理論 Toolchain 組合為 `(m + 1)(n + 1)`，但現行只按實際需求建置。 | image identity 與建置路徑較單純；代價是維護所有版本同時共存、版本 selector、全域狀態治理、mount 清單與 container 內的多 Project 程序管理。 |

## AI Agent 的差異是決定性因素

Docker 官方文件指出 bind mounts 預設可以修改或刪除 host 檔案，這具有資安影響（[bind-mount considerations](https://docs.docker.com/engine/storage/bind-mounts/#considerations-and-constraints)）。兩個方案都會讓 Agent 修改它正在工作的 Project；差別在於可觸及範圍：

- 現行方案只把目前 Project workspace 加上明確支援的 Agent home 掛入 Sandbox。惡意或被 prompt injection 影響的 Agent，預設只能破壞目前 Project 與那個共享 Agent home。
- all-in-one 把所有 Projects 都以可寫方式交給同一個 Agent/process 邊界。一個 Project 內的惡意指示、被入侵的套件 script 或一般誤操作，都可以讀取、修改或刪除其他 Projects，包括尚未 commit 的內容。
- 把非目前 Projects 改成 read-only 只能防止寫入，不能阻止讀取與外洩；而切換目前 Project 的 mount mode 仍需要重新建立 container 或引入更複雜的內層隔離。

因此 all-in-one 與 `CONTEXT.md` 中「Project workspace 可寫，但預設排除開發者機器其餘部分」的 Sandbox 定義不相容。若接受 all-in-one，就應明確承認產品改成「所有已註冊 Projects 屬於同一信任區」，而不是繼續稱為 Project-scoped Sandbox。

## 什麼情況適合 all-in-one

all-in-one 適合以下條件同時成立的產品：

1. Projects 實際上是同一個 monorepo、同一產品的多個 repo，或使用者明確希望跨 repo 搜尋與修改。
2. 全部 Projects 位於同一信任區；使用者接受任何 Agent 或開發程序都能讀寫全部內容。
3. Runtime catalog 是有限且預先驗證的，不需要 ADR-0019 的開放 release lines。
4. Projects 可以共用一個 container 的 stop/rebuild/update 時機、network namespace 與資源池。
5. 主要優先順序是「第一次準備後立即切換任何 Project」，高於最小 image、獨立生命週期與故障隔離。
6. Project mount 集合相對固定，或本來就會掛入一個明確且安全的共同 workspace root。

## 什麼情況適合現行方案

現行方案適合以下需求：

- 一般獨立 repo、clone、worktree 與任意 Project root 都是不同 Project。
- 不同 Projects 需要不同 PHP/Node release lines，且可能輸入 Built-in suggestions 之外的 release line。
- 需要每個 Project 獨立啟停、重建、網路與未來的資源限制。
- AI Agent 只應看見當前 Project，而不是所有已註冊 Projects。
- 希望只準備實際使用的 Toolchain，同時透過 Base、Workspace image 與 Docker layers 共用不可變內容。

## 對 Devbox 的建議

1. **維持現行 per-Project Sandbox container。** 這與既有的 Project identity、Sandbox 安全邊界、Compose lifecycle、open Runtime release lines 與 Workspace fingerprint 是同一套模型。
2. **不要為了 container 數或 `docker image ls` 顯示的 SIZE 改成 all-in-one。** 先用 `docker system df -v` 的 `SHARED SIZE`、`UNIQUE SIZE`，以及每個 container writable size 做實測；virtual size 相加會高估實體用量。
3. **若主要問題是建置時間或磁碟，優先改善共用而不是拆掉 Project 邊界。** 現行 Base 共用與 per-Toolchain image reuse 已保留多 container 的主要隔離優勢；ADR-0005 已辨識的第二 Runtime layer 未重用，才是可量化的 image 優化點。
4. **若未來確實需要跨 repo Agent 工作，另外定義一個明確的 trusted workspace/group 概念。** 只有群組內 Projects 才能共用 container，並把擴大的讀寫範圍直接顯示給使用者。這是新的產品模式，不應偷偷改寫既有 Project-scoped Sandbox。
5. **all-in-one 不適合作為初版的隱性實作捷徑。** 它雖然刪除了組合式 Workspace image assembly，卻同時新增版本 selector、mount 變更、程序治理、port 分配、共享狀態與故障處理契約；現行 ADR 並未定義這些新介面。
