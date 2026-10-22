# 純 JavaScript 跨程序鎖定的可行性

研究日期：2026-08-03。範圍為 Devbox v1 WSL2 `linux/amd64`、Node `>=22`，僅探討獨立 CLI 程序之間的鎖定；不重新審議既有 ADR，也不擴及其他主機端原語。

> **現行決策優先：** ADR-0045 已取代先前保留 `devbox-host` 的建議。Devbox 目前的預發行版契約刻意接受以簡單、非等待式的檔案系統命令標記，協調設定與 Project 操作；異常終止後須手動移除標記。ADR-0046 記錄了相關的封裝結果：儲存庫根目錄只有一個由 pnpm 管理的套件，沒有 workspace 相依圖、平台套件、原生 Go 模組或多套件發行流程。下文的來源事實與候選方案比較仍是有用的歷史依據，但現行產品決策以 ADR-0045 與 ADR-0046 為準。

本文將官方文件或第一手來源直接支持的內容標為 **「來源事實」**，將套用到 Devbox 契約的判斷標為 **「Devbox 分析」**。「純 JS」也必須區分兩件事：JavaScript 程式碼是否另行攜帶原生產物，以及底層實作是否真的以 JavaScript 完成。

## 現行決策

ADR-0045 從目前設定與 Project 操作的範圍中移除原先規劃的 Go 輔助程式。Devbox 在 `~/.devbox/locks/` 下使用一個 Global 命令標記，以及每個 Project 各一個 Project 命令標記；取得鎖定時不等待，若範圍忙碌便立即失敗，命令正常完成時移除標記。強制終止可能留下標記，須由使用者確認沒有 Devbox 程序執行後手動移除。

`up` 只使用該 Project 的標記，讀取設定快照，並持有標記直到整個 `docker compose up -d` 命令結束。不同 Project 可同時執行 `up`；同一 Project 的後續命令則會失敗，直到 Compose 返回。`config -g` 只使用 Global 標記，可在 `up` 執行期間運作；Project `config`、`init` 與 `rm` 使用 Global 標記及相關 Project 標記。未來如何協調 `build` 和 `update` 仍未決定。
ADR-0046 記錄相關的封裝結果：CLI 是儲存庫根目錄中一個由 pnpm 管理的套件，只有一份套件鎖定檔與一個 npm 發行邊界。下文針對輔助程式的封裝及發行分析屬於歷史內容，不規定現行實作。

本文其餘部分記錄舊有輔助程式契約下考慮過的來源事實和替代方案。這些比較說明了已接受的可靠性取捨，不再規定現行實作。

## 舊版 Devbox 鎖定契約

這份研究依據先前決策所訂的舊有可觀察契約：

- Project 區域的生命週期操作先取得使用者範圍的生命週期**共享**鎖，再取得該 Project 的**獨占**鎖；因此不同 Project 可並行，同一 Project 的操作則依序執行。
- 全域 `update` 與 Base update 取得使用者範圍的生命週期**獨占**鎖，排除所有 Project 操作。
- Platform 變更與各 Workspace 指紋是分開的獨占資源；不同指紋可並行處理。
- 固定順序為 `lifecycle → Project → Platform mutation → fingerprint`，釋放時順序相反。這用來預防死鎖，並不要求以單次系統呼叫原子地取得整組鎖。
- 無法取得時，等待且不設固定逾時，並顯示正在等待的資源；待處理的等待可透過操作的 `AbortSignal` 取消，取消不會變更受保護的狀態。
- 持有者正常釋放、父程序 EOF、程序崩潰或遭 `SIGKILL` 後，作業系統必須釋放所有權；不得依賴手動刪除過期檔案，也不得讓另一個仍在執行的程序遭誤判而被奪走所有權。
- 鎖定目標檔案不含 generation 或領域狀態；沒有 daemon、socket 或持久性租約登錄資料。

當時每個鎖定範圍由一個版本完全相符的 `devbox-host` 子程序持有核心諮詢式鎖定的 FD；stdin EOF 或輔助程式退出即釋放。Linux `flock(2)` 本身提供 `LOCK_SH`、`LOCK_EX`、阻塞／`LOCK_NB`；鎖繫於開啟檔案描述，所有相關 FD 關閉時即釋放；Linux `fcntl` 紀錄鎖也會在程序終止時自動釋放。[Project 生命週期鎖定決策](../adr/0001-generated-compose.md)、[Project 資源順序決策](../adr/0007-global-platform-lock.md)、[Linux `flock(2)`](https://man7.org/linux/man-pages/man2/flock.2.html)、[Linux `fcntl` 鎖定](https://man7.org/linux/man-pages/man2/fcntl_locking.2.html)

### 「公平性」與「原子式多重鎖定」並非隱含保證

**來源事實：** Linux `flock(2)` 文件描述了阻塞、共享／獨占與釋放，但未保證等待者按 FIFO 排序，也不進行死鎖偵測。`fcntl(F_SETLKW)` 對傳統與程序關聯的紀錄鎖有有限的死鎖偵測，但仍沒有能以原子方式鎖定多個路徑名稱的系統呼叫。[`flock(2)`](https://man7.org/linux/man-pages/man2/flock.2.html)、[`fcntl` 鎖定](https://man7.org/linux/man-pages/man2/fcntl_locking.2.html)

**Devbox 分析：** 因此，矩陣中的「公平」分為兩個層次：避免已知的讀取者／寫入者飢餓，以及嚴格 FIFO。舊有契約要求可等待、可取消與固定順序，並未從核心 API 推導出嚴格 FIFO 保證。任何聲稱「比當時現況更公平」的候選方案，都必須自行維護佇列。多重鎖定的正確替代方式，是繼續依固定順序取得鎖、等待時持有已取得的前段鎖，並在取消時反向釋放；要求整組鎖以全有或全無方式原子取得，是新增要求，不是當時輔助程式的能力。

## 「純 JS」的定義

| 類別 | 實際內容 | 是否攜帶二進位產物 | 本文用語 |
| --- | --- | ---: | --- |
| JS 協定 + Node 內建 `fs`/`net`/`worker_threads` | Devbox 程式碼是 JS；系統呼叫仍由 Node/libuv 的原生執行階段執行 | 否（隨 Node 提供） | 可稱為「純 JS 部署」；不可聲稱核心原語由 JS 實作 |
| `node:sqlite` | JS 呼叫 Node 內建的 SQLite C binding／內嵌 SQLite | 否（隨 Node 提供） | Node 內建原生 binding，並非純 JS 資料庫 |
| npm 原生 addon | `.node` 共用物件從 C/C++/Rust 等語言呼叫 `flock` | 是，或安裝時編譯 | 非純 JS |
| 外部預先編譯的輔助程式 | Go/C/Rust 執行檔，由子程序協定控制 | 是 | 非純 JS；當時的 `devbox-host` 屬此類 |

Node-API 的價值是跨 Node 主要版本維持 C ABI 穩定，而不是讓 addon 變成 JavaScript；官方文件也分別列出 `node-gyp` 建置與預編譯二進位檔的散布方式。[Node-API ABI 與建置／預編譯](https://nodejs.org/docs/latest-v22.x/api/n-api.html#implications-of-abi-stability)

## 候選方案 1：Node 內建 `fs`、open 旗標與 `mkdir`

### Node 22 至研究當時版本沒有內建諮詢式鎖定

**來源事實：** Node v22.23.2 `fs` API 所列的 `FileHandle`、callback 與同步方法均無 `flock`/`fcntl`；研究當時的 v26.5.1 `fs` API 亦然。Node 底層 libuv 的 `uv_fs_type` 與 FS API 清單包含 open、close、read、write、mkdir、rename、unlink、fsync 等，沒有鎖定操作；研究當時的 Node 原生 FS binding 原始碼也未公開 `flock`/`fcntl` 包裝。[Node v22.23.2 `fs`](https://nodejs.org/docs/latest-v22.x/api/fs.html)、[Node v26.5.1 `fs`](https://nodejs.org/docs/latest/api/fs.html)、[libuv FS 操作](https://docs.libuv.org/en/v1.x/fs.html)、[Node v26.5.1 `src/node_file.cc`](https://github.com/nodejs/node/blob/v26.5.1/src/node_file.cc)

這不代表 Linux 缺乏原語；Linux 同時有整檔 `flock`、POSIX 與程序關聯的紀錄鎖，以及 Linux 專有的 OFD 紀錄鎖。差別只是 Node 內建 API 未公開這些功能。傳統 `fcntl` 鎖另有「程序關閉同一檔案的任何 FD，就會釋放該程序持有的該檔案所有紀錄鎖」的語意；`flock`／OFD 鎖則繫於開啟檔案描述，更接近當時每個範圍使用單一 FD 的所有權模型。[Linux `fcntl` 鎖定的釋放差異](https://man7.org/linux/man-pages/man2/fcntl_locking.2.html)

### `open('wx')` 實際保證什麼

**來源事實：** Node 的 `'wx'` 類似 `'w'`，但路徑名稱已存在時會失敗；`'x'` 對應 `O_EXCL`，與 `O_CREAT` 合用時，路徑存在便回報錯誤（包括失效的符號連結）。Node 也明確註明獨占旗標在網路檔案系統上可能無效。Linux `open(2)` 保證的是 `O_CREAT | O_EXCL` 將「檢查是否存在」與「建立」結合為原子操作；並非對既有檔案加上諮詢式鎖。[Node 檔案系統旗標](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-system-flags)、[Linux `open(2)` `O_EXCL`](https://man7.org/linux/man-pages/man2/open.2.html)

在 WSL2 Linux home 的單一本機檔案系統上，若所有協作程序都使用同一路徑與 `'wx'`，每次競爭只會有一個建立者成功；但所有權代表「目錄項目仍存在」，不是「建立者的 FD 仍存活」。成功建立者即使關閉 FD 或遭 `SIGKILL`，也不會取消連結；其他程序仍可用一般的 `'r'`／`'w'` 開啟該路徑。它原生只能充當獨占建立標記：沒有共享模式、阻塞等待、持有者佇列、全域讀取者屏障或崩潰後自動釋放。

`mkdir(lockPath)` 的互斥基礎類似：目錄已存在時，同名的 `mkdir(2)` 會傳回 `EEXIST`。成熟套件 `proper-lockfile` 的第一手原始碼正是利用 `mkdir` 取得鎖、目錄 `mtime` 心跳、過期門檻、重試與退出時的 `rmdir`，組合出獨占鎖；其來源也明列 `SIGKILL` 或 VM 致命崩潰時無法執行正常釋放。[Linux `mkdir(2)`](https://man7.org/linux/man-pages/man2/mkdir.2.html)、[`proper-lockfile` v4.1.2 取得鎖／心跳原始碼](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/lib/lockfile.js)、[`proper-lockfile` 正常退出限制](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/README.md#graceful-exit)

### 心跳／PID 過期偵測的具體失效情境

Linux `SIGKILL` 與 `SIGSTOP` 無法被捕捉、阻擋或忽略；因此任何 `exit` 處理器都無法將其轉為可靠的釋放機制。[Linux `signal(7)`](https://man7.org/linux/man-pages/man7/signal.7.html)

1. **SIGKILL：必須在安全性與可用性間取捨。** A 建立標記後遭 `kill -9`。若 B 永不刪除標記，互斥仍安全，但資源永久無法使用；若 B 在 10 秒後將標記視為過期，崩潰復原至少延遲 10 秒，且下述「誤判存活程序」會破壞安全性。`proper-lockfile` 預設的過期／心跳機制正是後者，使用 `Date.now()` 與目錄 `mtime` 比較。[`proper-lockfile` 過期檢查原始碼](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/lib/lockfile.js)
2. **SIGSTOP、系統暫停、事件迴圈停滯：存活持有者被奪走鎖。** A 持有鎖後遭 `SIGSTOP`、WSL／主機暫停超過過期門檻，或 JS 事件迴圈因同步工作／CPU 資源不足而無法更新 mtime。B 刪除過期目錄、建立新鎖並進入臨界區；A 恢復後則從停止處繼續執行。即使下一次心跳 `stat` 發現 mtime 不是自己的並呼叫 `onCompromised`，重疊執行的時間窗已開始，無法撤銷 A 已送出的 Docker 命令或檔案發布。`proper-lockfile` 原始碼要等計時器恢復執行才檢查 mtime，其 README 也承認無法偵測「標記被移除後立即由其他人取得」的情況。[`proper-lockfile` 鎖遭破壞案例](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/README.md#compromised)
3. **系統時鐘跳動：以 mtime 為基礎的租約不是單調時鐘租約。** `Date.now()` 與檔案系統 mtime 都使用系統時鐘。Linux `CLOCK_REALTIME` 可因手動設定時間或 NTP 而不連續跳動；時間向前跳，可能立即把仍在運作的心跳判為過期；向後跳，則可能讓已失效標記在超過設定門檻後仍無法被接管。[Linux 時鐘語意](https://man7.org/linux/man-pages/man3/clock_gettime.3.html)、[`proper-lockfile` 的 `Date.now()` 比較](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/lib/lockfile.js)
4. **PID 重複使用：`kill(pid, 0)` 只能回答此刻是否存在這個編號。** Linux `kill(..., 0)` 只檢查 PID 是否存在及權限；`/proc/sys/kernel/pid_max` 明確指出 PID 會循環使用。A 崩潰並留下 PID；之後無關程序 C 取得相同 PID，B 就會把失效鎖當成仍在使用。加上 `/proc/<pid>/stat` 的啟動時間可以降低誤認機率，但仍須以原子方式將標記 token 綁定該程序實例；PID 本身不具備所有權憑證的效力。[Linux `kill(2)` signal 0](https://man7.org/linux/man-pages/man2/kill.2.html)、[Linux `pid_max` 循環使用](https://man7.org/linux/man-pages/man5/proc_sys_kernel.5.html)
5. **檢查過期／移除／重建的競爭。** B 以 `stat` 判定舊標記過期；但 B 執行 `rmdir` 前，A 或另一個復原程序已替換標記。若協定沒有不可偽造的 token／inode 重新驗證，B 可能刪掉新持有者的標記。即使使用重新命名至隔離區與 token，使單一獨占標記更安全，仍無法解決因逾時而奪走暫停中、但仍存活的持有者之問題。
6. **讀取者／寫入者先檢查後登錄的競爭。** 單純標記沒有共享模式。若每個讀取者建立自己的項目，讀取者 R 先確認「沒有寫入者」，寫入者 W 隨後建立寫入者標記，R 再登錄為讀取者；兩者便會同時進入。增設閘門／寫入者等待標記與中繼資料互斥鎖後，又必須處理該互斥鎖本身的過期復原；讀取者崩潰也會留下項目。因此寫入者優先、FIFO、取消及清理，會演變成完整的租約協調器，而非少數幾次 `fs` 呼叫。
7. **多重鎖定不是檔案系統交易。** A 取得順序 1 的鎖後，等待順序 2 時已持有部分所有權。固定順序可避免循環死鎖，取消時也可反向釋放已取得的標記；但無法跨路徑名稱以全有或全無方式原子取得。若每次失敗都全部釋放並重試，競爭者可能反覆同步碰撞而形成活鎖，且沒有公平順序。

**Devbox 分析：** JS 重試計時器可以透過 `AbortSignal` 取消，也可以依資源雜湊建立不同標記，讓不同 Project 並行；真正無法滿足舊契約的是崩潰後立即且不誤判地釋放，以及在此基礎上建立正確的共享／獨占屏障。成熟的獨占 lockfile 套件也不提供 Devbox 所需的讀寫鎖及依序取得多資源的租約。因此 `open('wx')`、`mkdir`、lockfile 加心跳，都不能可靠地取代當時的輔助程式。

## 候選方案 2：`worker_threads.locks`／Web Locks

**來源事實：** Node 在 v24.5.0 加入 `worker_threads.locks`。官方文字明確將其限於協調「同一程序中的多個執行緒」；`locks.request()` 支援 `shared`／`exclusive`、待處理請求的 `AbortSignal`、`ifAvailable` 與 `steal`，快照也僅描述目前程序持有與等待中的鎖。[Node v26.5.1 `worker_threads.locks`](https://nodejs.org/docs/latest/api/worker_threads.html#worker_threadslocks)、[Node 原始碼文件：同一程序](https://github.com/nodejs/node/blob/v26.5.1/doc/api/worker_threads.md#worker_threadslocks)

**Devbox 分析：** 在單一 CLI 程序的主執行緒與 Workers 之間，它提供相當合適的具名讀寫鎖 API；但兩個獨立 `node` 執行檔各有自己的 `LockManager`，彼此看不見同名鎖。Node 22 執行階段也完全沒有此 API，除非將最低版本提高至 v24.5.0。若所有 CLI 都導向單一常駐 Node 程序，便可跨命令協調，但這等於新增 daemon／協調器，改變獨立 CLI 程序契約。結論：直接使用不符合目標，也無法作為備援方案。

## 候選方案 3：Unix Socket／TCP Bind

### 以 bind 作為獨占標記

**來源事實：** `net.Server.listen(path)` 在 Unix 上建立 Unix domain socket；相同連接埠／路徑已有監聽者時，常見錯誤是 `EADDRINUSE`。具路徑名稱的 socket 在程序崩潰後仍留在檔案系統；Node 官方也註明它會持續存在直到取消連結。Linux 抽象 Unix socket（Node 路徑以 `\0` 開頭）在所有開啟的參照關閉後會自動消失，且是 Linux 專有擴充。Node 自 v20.4.0 起支援抽象路徑。[Node IPC 支援](https://nodejs.org/docs/latest/api/net.html#ipc-support)、[Node `EADDRINUSE`](https://nodejs.org/docs/latest/api/net.html#serverlisten)、[Linux `unix(7)` 抽象／具路徑名稱的語意](https://man7.org/linux/man-pages/man7/unix.7.html)

對 v1 WSL2 而言，持有抽象 Unix 監聽 socket 可作為崩潰後安全釋放的獨占名稱：其他程序綁定同名會失敗；持有者遭 `SIGKILL` 後，核心關閉最後一個參照，名稱便自動消失。具路徑名稱的 Unix socket 則重現過期檔案問題。在一般設定下，本機 TCP 連接埠也可提供單一監聽者的獨占性，但 Node 對所有 TCP socket 設定 `SO_REUSEADDR`，另有 `reusePort` 選項允許多個 socket 使用同一連接埠；連接埠是有限的數字命名空間，還必須定義資源→連接埠碰撞、位址家族／介面與其他程式占用等情況，因此不如抽象 Unix 名稱合適。[Node TCP `SO_REUSEADDR`／`reusePort`](https://nodejs.org/docs/latest/api/net.html#serverlistenoptions-callback)

**不足之處：** bind 原語只提供「此位址有一位持有者」；沒有多個共享持有者、寫入者等待閘門，也沒有讓使用者範圍全域獨占鎖排除所有 Project 讀取者的原子語意。`EADDRINUSE` 會立即失敗；等待、退避、公平性與取消都須另以 JS 實作。將各 Project／指紋雜湊成獨立的抽象名稱雖可並行，卻無法讓全域生命週期持有者透過單次 bind 排除所有已存在或即將出現的 Project 位址。這也明確引入運作中的 socket；即使沒有獨立 daemon 程序，仍違反舊有的「不使用 socket」界線。

### 以 socket 作為協調器的傳輸管道

Unix／TCP 伺服器可以在記憶體中維護任意資源的共享／獨占持有者、寫入者優先／FIFO 佇列、固定順序檢查及逐一請求的取消。用戶端連線 EOF 可通知協調器釋放該用戶端的租約。這是能以軟體表達完整契約的候選方案，但這些語意並非 bind 免費提供。

具體失效情境是協調器 C 崩潰：所有用戶端連線同時中斷，C 的記憶體內鎖定表也消失。若仍在臨界區內的用戶端繼續執行，而新的 C' 又接受新鎖，就會發生腦裂；若要求所有用戶端在看到 EOF 時取消並停止受保護的工作，還必須證明 Docker 子程序和發布作業在重新取得鎖前已停止，並處理 C 在回覆授予鎖前後立即崩潰所造成的不明確結果。若 C 必須在原 CLI 退出後繼續服務其他命令，實際上就是 daemon；選出主協調器與重新啟動又需要另一種跨程序原語。

**Devbox 分析：** 協調器在技術上能實作公平性與取消，卻直接違反「獨立 CLI、不新增 daemon／socket」。僅使用抽象 bind 不違反持久狀態限制，崩潰後釋放也極佳，但仍因缺少讀寫鎖／全域屏障而不足。

## 候選方案 4：Node 內建 SQLite 交易

### 可取得的作業系統／交易行為

**來源事實：** `node:sqlite` 在 v22.5.0 加入，自 v22.13.0 起不再需要旗標，但仍屬實驗性功能；截至 v26.5.1 仍是候選正式版。它只公開 `DatabaseSync`，所有 API 都同步執行。`timeout` 是 SQLite 的忙碌逾時：最多等待資料庫鎖指定的毫秒數，之後傳回錯誤；預設為 0。[Node v22 `node:sqlite`](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)、[Node v26.5.1 `node:sqlite`](https://nodejs.org/docs/latest/api/sqlite.html)

SQLite 允許不同程序同時執行多個讀取交易，但每個資料庫檔案一次只能有一個寫入交易。在 rollback-journal 模式，`BEGIN EXCLUSIVE` 會阻止其他連線在交易期間讀取；在 WAL 模式，`EXCLUSIVE` 與 `IMMEDIATE` 行為相同，**不能**用來排除讀取者。SQLite rollback pager 有 SHARED、RESERVED、PENDING 與 EXCLUSIVE 狀態；PENDING 阻止新讀取者加入，以避免寫入者飢餓。崩潰後留下的 hot journal 會在下次讀取前復原。[SQLite 交易模式](https://www.sqlite.org/lang_transaction.html)、[SQLite 鎖定狀態、寫入者飢餓與 hot-journal 復原](https://www.sqlite.org/lockingv3.html)

因此，若政策允許，**可讓每個資源各自對應一個 SQLite 資料庫檔案**：共享租約持有一個 SELECT 讀取交易；獨占租約在明確指定的非 WAL rollback-journal 模式下持有 `BEGIN EXCLUSIVE`；程序死亡時作業系統檔案鎖消失，SQLite 會回復未完成的交易。生命週期 DB 可表達全域獨占對所有 Project 共享生命週期鎖的排除；不同 Project／指紋使用不同 DB 檔案，以維持彼此並行。固定順序仍由 JS 逐檔取得，並非跨 DB 原子取得。

### 為何不適合取代當時的做法

1. **單一 DB 無法提供任意資料列層級的並行鎖定。** 即使一張表的不同資料列代表不同資源，SQLite 同時仍只能有一個寫入交易；用新增／刪除資料列表示持有者，會不必要地使不同 Project 依序執行。若每個共享持有者在長時間寫入交易中新增租約資料列，未提交資料彼此不可見，多個寫入者也無法共存。要維持資源隔離，須每個資源一個檔案，或另建心跳租約協定。
2. **WAL 模式是容易誤觸的正確性開關。** 若任何初始化或既有預設值改成 WAL，`BEGIN EXCLUSIVE` 就不再排除讀取者，全域屏障語意隨之改變。實作必須固定並驗證 rollback journal 模式，額外建立 SQLite 專有的不變條件。[SQLite WAL 模式中的 `EXCLUSIVE`](https://www.sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions)
3. **等待無法直接取消。** `DatabaseSync` 的忙碌逾時會在同步原生呼叫內睡眠；Node API 不接受針對等待中的 `BEGIN EXCLUSIVE` 傳入 `AbortSignal`。SQLite 官方的忙碌逾時只會反覆睡眠，直到累計毫秒數達標後傳回 `SQLITE_BUSY`，並無 FIFO 保證。[SQLite 忙碌逾時](https://www.sqlite.org/c3ref/busy_timeout.html) 若要符合取消要求，只能設定 `timeout: 0`／短逾時，再以 JS 可取消的計時器輪詢；這會放棄 SQLite 內部等待佇列，並引入輪詢負載與不公平競爭。
4. **公平性只有部分保證。** rollback pager 的 PENDING 狀態可阻擋新讀取者、降低寫入者飢餓，但官方文件沒有宣稱多個等待寫入者或任意整組資源的 FIFO。JS 短間隔輪詢對到達順序的保證更弱。
5. **引入持久的協調器產物。** `:memory:` 資料庫無法由獨立程序共用；跨程序須使用檔案支援的 DB。每個資源一個檔案會持續留下 SQLite header／schema，交易也可能產生 rollback journal／hot journal。這不是 Platform「generation」，但確實是新的持久性鎖定協調器狀態；當時的做法只是使用不含領域狀態的一般檔案作為核心鎖定目標。在本研究的「無持久狀態」限制下，這構成違反。
6. **Node 版本涵蓋不完整。** 若 `>=22` 確實包含 v22.0–v22.4，這些版本沒有 `node:sqlite`；v22 系列也一直將其列為實驗性功能。必須提高並明訂最低修補版本，但仍無法解決上述語意與政策問題。

**Devbox 分析：** SQLite 最接近「無額外二進位檔、核心層級的崩潰復原、共享／獨占」，但取得這些特性的代價是每個資源一個持久資料庫、journal 模式的不變條件，以及可取消的輪詢。它使小型鎖定 adapter 變成資料庫生命週期子系統，不符合當時不允許持久性協調器狀態的限制，也比直接持有諮詢式鎖定 FD 複雜。

## 候選方案 5：原生 Addon

Node-API addon 可直接包裝 Linux `flock(2)` 或 `F_OFD_SETLK`：JS 仍決定資源路徑、順序、診斷資訊及 `AbortSignal`；addon 只執行系統呼叫。FD 由主要 Node 程序持有，正常關閉或程序死亡時由核心釋放，不需要心跳／PID 過期偵測。在當時僅限 WSL2 的範圍內，語意上可等同輔助程式。

但 addon 必須避免直接將不可取消的阻塞式 `flock(LOCK_EX)` 丟進 worker pool，卻假稱 Promise 可取消。可靠的設計應公開 `LOCK_NB`，讓 JS 執行可取消的退避；或提供真正能中斷等待的原生機制。`fs-ext` 的第一手原始碼展示常見做法的性質：JS `require('./build/Release/fs_ext.node')`，字串 `sh`／`ex` 對應 `LOCK_SH`／`LOCK_EX`，C++ 在 libuv 工作項目中呼叫 `flock`；其公開 callback API 沒有 `AbortSignal`。套件安裝腳本為 `node-gyp configure build`，並依賴 NAN，因此屬典型 npm 原生 addon，而非純 JS。[`fs-ext` JS binding](https://github.com/baudehlo/node-fs-ext/blob/master/fs-ext.js)、[`fs-ext` 原生 `flock` 原始碼](https://github.com/baudehlo/node-fs-ext/blob/master/fs-ext.cc)、[`fs-ext` 套件建置](https://github.com/baudehlo/node-fs-ext/blob/master/package.json)

Node-API 可讓自行維護的 addon 不必為每個 Node 主要版本重新建置，但仍須為 `linux-x64` 建置、封裝、載入並驗證 `.node` 二進位檔；若採用現成的 NAN addon，Node/V8 ABI 與維護風險更高。相較於輔助程式，崩潰後釋放少了一層父程序 EOF 協定，但 addon 崩潰也會直接使 CLI 程序當掉，原生記憶體安全／ABI 問題也進入主程序。這是「移除 Go 執行檔」的可行路徑，不是「改成純 JS」的路徑。

## 候選方案 6：外部預先編譯的輔助程式

當時版本完全相符的 `devbox-host` 是最狹窄的原生介面：一個子程序只持有核心諮詢式鎖定的 FD，透過有版本的 JSONL 回報就緒／錯誤／釋放，不承載 Project 或領域政策。Linux `flock` 提供所需的共享／獨占與關閉時釋放的所有權語意；父程序崩潰時，管線寫入端關閉，子程序看到 EOF 後退出，而輔助程式退出會使核心釋放 FD。管線讀取端必須等到**所有**寫入端參照都關閉才會看到 EOF，因此實作／spawn 必須避免意外複製 stdin 寫入端 FD。[Linux `pipe(7)` EOF 語意](https://man7.org/linux/man-pages/man7/pipe.7.html)、[Linux `flock(2)` 關閉時釋放](https://man7.org/linux/man-pages/man2/flock.2.html)

缺點是平台執行檔散布、子程序啟動／協定與版本握手；也不能宣稱核心等待者嚴格 FIFO。不過，Devbox 當時已有供 v1 `linux/amd64` 使用、版本完全相同的平台套件，輔助程式崩潰及協定格式錯誤也可隔離為子程序失敗。相較於原生 addon，它不把原生程式碼載入 CLI 位址空間；相較於各種標記租約，它不需要過期逾時；相較於 socket／SQLite，它不引入協調器狀態。

## 需求矩陣

圖例：`Yes` 表示原語或相當精簡的 adapter 可滿足要求；`Partial` 表示須加入大量協定或降低保證；`No` 表示與舊有契約衝突。公平性欄的「未保證」不代表飢餓必然發生，而是主要 API 沒有 FIFO 契約。

| 候選方案 | 獨立 CLI 程序 | 任意共享／獨占 | 不同 Project 並行＋全域屏障 | 崩潰／`SIGKILL` 後自動釋放且不誤判 | 固定順序＋等待中可取消 | 公平等待 | 無 daemon／socket／持久性租約狀態 | 類別／結論 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fs.open('wx')`／`O_EXCL` | 是，獨占標記 | 否 | 部分；不同資源路徑可並行，全域讀寫屏障須自行建立 | 否；目錄項目不會隨 FD／程序消失 | 部分；JS 輪詢可取消，跨路徑非原子操作 | 否 | 否；崩潰留下標記 | 純 JS 部署；否決 |
| `mkdir`／lockfile＋心跳／PID | 是 | 否；成熟方案僅支援獨占，讀寫鎖須完整協定 | 部分 | 否；永不接管會永久停滯，逾時接管會誤判暫停中／存活的持有者 | 部分 | 否 | 否；持久標記／心跳／持有者中繼資料 | 純 JS 部署；否決 |
| `worker_threads.locks` | **否，僅限同一程序** | 是，具名共享／獨占 | 同一程序內可行 | callback 生命週期限於程序內；跨程序不適用 | 是，待處理請求的 `AbortSignal` | 佇列由 LockManager 管理；無跨程序保證 | 是 | Node 內建原生功能；直接使用不適用，且需 Node >=24.5 |
| 抽象 Unix bind 作為標記 | 是 | 否，僅獨占位址 | 否；沒有排除所有讀取者的全域屏障 | 是，最後參照關閉即自動消失 | 部分；`EADDRINUSE` 後的 JS 輪詢可取消 | 否 | **否，引入運作中的 socket**；無持久檔案 | 純 JS 部署／僅限 Linux；就完整契約而言否決 |
| 具路徑名稱的 Unix socket／TCP bind | 是 | 否，僅獨占位址 | 否 | 具路徑名稱者崩潰後留下 socket 檔案；TCP／持有者關閉可釋放，但命名空間及重用更複雜 | 部分 | 否 | 否，使用 socket；具路徑名稱者另有持久產物 | 純 JS 部署；否決 |
| socket 協調器 | 是 | 是，可自行實作任意佇列 | 是 | 用戶端崩潰可透過 EOF 釋放；協調器崩潰須完整的用戶端停止運作／復原協定 | 是，可自行實作 | 是，可實作 FIFO／寫入者優先 | **否，明確引入 socket 與類似 daemon 的持有者** | 可行，但改變架構／違反限制 |
| 單一 SQLite DB＋鎖定資料列 | 是 | 邏輯上可設計對應 schema；實際上單一寫入者使不同資料列依序執行；長時間未提交的租約彼此不可見 | 否，或犧牲並行性 | 交易崩潰後可復原；已提交租約資料列仍需過期協定 | 部分；`DatabaseSync` 等待無法直接取消 | PENDING 降低寫入者飢餓；無 FIFO | **否，持久 DB／journal** | Node 內建原生功能；否決 |
| 每個資源一個 SQLite DB 的交易 | 是 | 是，rollback 模式讀取交易／獨占交易 | 是，可使用多個 DB 檔案 | 是，作業系統鎖＋rollback | 部分；可維持順序，取消須非阻塞輪詢 | 減輕寫入者飢餓；無 FIFO | **否，持久 DB／journal，檔案數隨資源增加** | Node 內建原生功能；有條件可行但不建議 |
| Node-API `flock` addon | 是 | 是 | 是 | 是 | 是，前提是 `LOCK_NB`＋可取消重試；只有阻塞式 addon 不夠 | 核心不保證 FIFO，與輔助程式同級 | 是，無 daemon／socket／租約登錄資料 | npm 原生 addon；語意上可行，但非純 JS |
| 版本完全相符的 `devbox-host` | 是 | 是 | 是 | 是，EOF／輔助程式退出／FD 關閉 | 是，既有順序與取消協定 | 核心不保證 FIFO | 是 | 外部預先編譯的輔助程式；**當時建議保留** |

## 歷史性的條件式建議

### 1. 若既有要求不變：保留 Go 輔助程式

保留當時「TypeScript 政策＋範圍極窄的原生鎖定持有者」界線。這是當時唯一已選定、能同時滿足獨立程序間鎖定、共享／獨占、Project 並行／全域屏障、依序取得鎖、等待可取消、崩潰／EOF 後自動釋放，以及無 daemon／socket／持久性租約狀態的方案。Go 在語意上並非必要；必要的是**能持有核心諮詢式鎖定 FD 的原生元件**。但既然當時已有二進位封裝，將同一系統呼叫移入 addon 並無「純 JS」效益。

### 2. 若只移除 Go／子程序：可改用 Node-API Addon，但必須承認仍是原生方案

只有量測顯示子程序啟動／協定確實造成問題，或團隊明確偏好維護 C/Rust Node-API 而非 Go 時才考慮。最低設計條件：

- 自行維護精簡的 Node-API addon；不要直接採用缺少 `AbortSignal` 的阻塞式 `fs-ext` API；
- 公開非阻塞式共享／獨占取得與解鎖操作，並明確定義 FD 生命週期；
- JS 繼續使用固定順序、可取消的退避、反向釋放與等待資源的診斷資訊；
- 將 `linux-x64` 預編譯檔放入當時既有的平台套件，驗證 ABI、模式與執行階段載入失敗情況；
- 每個資源維持獨立的開啟檔案描述，避免傳統與程序關聯的 `fcntl`「任何一次關閉都清除所有鎖」陷阱；優先使用 `flock` 或 Linux OFD 鎖。

這能移除輔助程序，卻不能移除預編譯原生產物，且原生錯誤的影響範圍更大。

### 3. 真正的純 JS 部署：只有降低要求才可能

- **改為單一常駐 Node 程序中的執行緒：** 將最低版本提高至 Node >=24.5，使用 `worker_threads.locks`；同時放棄「獨立 CLI 程序」，或接受新增 daemon。
- **僅需獨占，且容忍崩潰後手動移除標記／永久停滯：** `mkdir`／`O_EXCL` 可維持安全性；放棄崩潰後自動釋放。
- **僅需獨占，且容忍過期逾時與暫停／休眠造成的腦裂：** 可使用成熟的 lockfile 心跳機制；放棄當時的可靠性，尤其不適合 Docker／Platform 發布。
- **僅需 Linux 獨占名稱，且容忍運作中的 socket：** 抽象 Unix bind 可同時做到崩潰後立即釋放及不留下持久標記；放棄共享／全域讀取者屏障及無 socket 的要求。
- **容忍 socket 協調器／daemon：** 可在記憶體中實作完整讀寫佇列、公平性、順序與取消，但必須新增協定，要求所有用戶端在協調器崩潰時停止運作。
- **容忍持久性協調器檔案、每個資源一個檔案及以輪詢取消：** 可研究 rollback 模式 SQLite 交易；同時須提高 Node 最低修補版本、固定 journal 模式，並承認這是 Node 內建原生功能，而非純 JS 實作。

## 是否需要小範圍原型？

回答「在舊有契約下能否改成純 JS」不需要原型：Node 的程序作用範圍、`O_EXCL` 的所有權、Unix socket 的生命週期與 SQLite 的交易範圍，皆可由第一手來源直接判定；標記租約也有「持有者仍存活但遭暫停」的結構性反例。

若未來決策改成「允許原生 addon，只比較 addon 與 Go 輔助程式」，可製作一個**不納入正式產品程式碼**的小範圍原型，降低唯一剩下且值得釐清的不確定性：在 WSL2 `linux/amd64` 上，以公開 `flock(LOCK_SH/LOCK_EX|LOCK_NB)` 的最小 Node-API 包裝，透過三個獨立 Node 程序驗證共享／共享、共享／獨占、不同資源並行、固定順序等待、等待中中止、持有者遭 `SIGKILL` 後立即取得，以及同一預編譯檔在 Node 22 與研究當時版本的載入情況。它回答的是 ABI／套件／取消機制的工程成本；不會使 addon 變成純 JS，也不必重新驗證核心文件已確立的鎖定語意。

## 最終結論

現行答案並非「在舊有崩潰後自動釋放的契約下，純 JavaScript 鎖定是安全的」。現行預發行版決策刻意降低該契約的要求：移除 Go 與原生鎖定、使用簡單命令標記、遇到忙碌操作立即拒絕，並記錄強制終止後須手動移除標記。之所以接受此取捨，是因為在目前範圍內，維持套件簡單並允許不同 Project 同時執行 `up`，比自動復原遺留標記更重要。對於會修改共用 Docker 或 Platform 產物的操作，未來是否採用原生協調機制仍未決定。
