# Node Runtime 安裝來源：官方映像檔與官方 tarball 比較

> Research date: 2026-08-10. 範圍涵蓋 Debian 13 Trixie Slim、`linux/amd64` 與 `linux/arm64`、由工具產生的單一多階段 Workspace Dockerfile、精確的 Platform lock 輸入，以及依發行主線隔離的 Runtime 路徑。本文是研究紀錄，不是實作。
>
> **用語：**「來源事實」由 Node.js、`nodejs/docker-node` 或 Docker 的第一手資料直接支持。「Devbox 建議」是根據這些事實做出的架構判斷。下文不會將可變的標籤或發行主線別名視為精確的產出物。

> Decision update: ADR-0036 已決定透過由 Runtime 家族自身負責的配方，直接從官方 Node 二進位 tarball 安裝。下方建議使用來源映像檔的內容，是決策前的比較紀錄，已不再是現行架構。

## 決策摘要

**Devbox 建議：**就當時的架構而言，保留一個**以 digest 固定的官方 `node:<exact-version>-trixie-slim` 來源階段**，再於同一份產生的 Dockerfile 中，建立經過明確正規化的 Node Runtime 目錄樹，路徑為 `/opt/devbox/runtimes/node/<release-line>`。這是與當時 Platform lock 契約相容的最小變更：該契約已記錄 Node Runtime 的 `revision`、來源 `image` 與不可變的映像檔 `digest`，也符合 ADR-0035 的單一內嵌 Workspace 建置流程。

這項建議**不是**「直接複製 `/usr/local` 就算完成」。官方映像檔本身會將官方 Node 二進位 tarball 安裝至 `/usr/local`，但也加入映像檔專屬檔案，而且直到 Node 25 都會將 Yarn 放在 `/opt` 底下。其可執行檔所需的共用程式庫套件則留在來源映像檔的 Debian 檔案系統中，不會隨著複製 `/usr/local` 一起移入。因此 Devbox 必須：

1. 由 Base profile 的精確原生套件規劃負責 Runtime 所需的共用程式庫；
2. 複製並保留源自 tarball 的 Node 目錄樹，包括 npm/Corepack 的相對符號連結；
3. 排除映像檔的 entrypoint，並正規化使用絕對路徑的 `nodejs` 符號連結；
4. 不把映像檔內附的 Yarn 當成隱含相依套件，而是將 Platform lock 已要求的精確 npm/Corepack/pnpm/Yarn 項目安裝進各發行主線的套件目錄。

直接安裝 tarball 在技術上相當乾淨，產生的上游 Node 內容也相同，但會把 Runtime 的來源追溯欄位從 OCI 映像檔與 digest 改為 URL 加上簽署過的 checksum 輸入，並重複實作 `nodejs/docker-node` 已維護的下載、簽章驗證和解壓縮邏輯。只有當 Devbox 有意修訂該 lock 契約，將 Node 發行壓縮檔定為標準 Runtime 產出物時，這種方式才比較合適。

發行主線 24 的具體路徑如下：

```text
/opt/devbox/runtimes/node/24
├── bin/
├── include/
├── lib/
└── share/
```

選定的專案可以將 `/opt/devbox/runtimes/node/24/bin` 放在 `PATH` 最前面；另一條發行主線（例如 22）則仍獨立存放於 `/opt/devbox/runtimes/node/22`。

## 1. 官方 Trixie Slim 映像檔實際包含什麼

### 1.1 Node 來自官方預先編譯的二進位 tarball

**來源事實：**當時的 Node 24 Trixie Slim Dockerfile 以 `debian:trixie-slim` 為基礎，將 Debian 的 `amd64` 對應至 Node 壓縮檔名稱中的 `x64`，將 Debian 的 `arm64` 對應至 `arm64`；從 `https://nodejs.org/dist/v$NODE_VERSION/` 下載 `node-v$NODE_VERSION-linux-$ARCH.tar.xz` 與 `SHASUMS256.txt.asc`，驗證已簽署的 checksum 清單、核對所選壓縮檔的 SHA-256，再使用 `--strip-components=1 --no-same-owner` 將其解壓縮至 `/usr/local`。它並未從原始碼重新編譯 Node。[官方 Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

**來源事實：**Node 自身的驗證說明指出，每個版本的下載目錄都包含 `SHASUMS256.txt.asc`，其中結合了各檔案的 SHA-256 值與 Node 發行者的 PGP 簽章。Node 公布並維護受信任的金鑰環，也記載先執行 `gpgv`、再驗證 checksum 的流程。[Node README：驗證二進位檔](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries)、[Node README：發行金鑰](https://github.com/nodejs/node/blob/main/README.md#release-keys)、[官方發行金鑰儲存庫](https://github.com/nodejs/release-keys)

**來源事實：**Docker 配方從 `keys.openpgp.org` 取得列出的現任發行者金鑰，並以 Ubuntu keyserver 作為備援；接著解密並驗證 `SHASUMS256.txt.asc`，再把符合所選壓縮檔的那一筆 checksum 傳給 `sha256sum -c`。因此，其信任鏈為：

```text
nodejs/docker-node 配方
  -> Node 發行者金鑰指紋
  -> 已簽署的 Node SHASUMS256.txt.asc
  -> 所選 Node 二進位 tarball 的 SHA-256
  -> 解壓縮後的 Node 目錄樹
  -> Docker Official Image manifest／層
```

來源映像檔方案是在同一條 Node 壓縮檔信任鏈上，額外加入 OCI registry 與 Docker Official Image 的發布環節；並未換用另一種 Node 編譯產物。[Dockerfile 驗證命令](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)、[Node 二進位檔驗證契約](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries)

### 1.2 `nodejs/docker-node` 新增或變更的檔案

**來源事實：**官方 Node 壓縮檔會解壓縮至 `/usr/local` 之下。以 Node 24 為例，Node 安裝程式包含 `node`、標頭檔、文件與 man pages、位於 `lib/node_modules/npm` 的 npm、位於 `lib/node_modules/corepack` 的 Corepack，以及 `bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js`、`bin/npx -> ../lib/node_modules/npm/bin/npx-cli.js` 和 `bin/corepack -> ../lib/node_modules/corepack/dist/corepack.js` 等相對符號連結。Node 安裝程式原始碼預設安裝 npm 與 Corepack，也支援明確指定 `--without-npm` / `--without-corepack` 的建置選項。[Node 24 安裝程式](https://github.com/nodejs/node/blob/v24.x/tools/install.py)、[Node 24 設定預設值](https://github.com/nodejs/node/blob/v24.x/configure.py)

**來源事實：**從 Node 14.19.0 起、至 Node 25 之前的版本會內附 Corepack；Node 24 文件明確提醒，從 Node 25 開始將不再隨附 Corepack。所有官方 Node Docker 映像檔變體都包含 npm。[Node 24 Corepack 文件](https://nodejs.org/docs/latest-v24.x/api/corepack.html)、[`docker-node` 映像檔變體文件](https://github.com/nodejs/docker-node#image-variants)

**來源事實：**Node 24 Trixie Slim 映像檔另外：

- 建立 UID/GID 為 1000 的 `node` 群組／使用者，以及 `/home/node`；
- 新增絕對符號連結 `/usr/local/bin/nodejs -> /usr/local/bin/node`；
- 將 Yarn Classic 1.22.22 安裝於 `/opt/yarn-v1.22.22`，並讓 `/usr/local/bin/yarn` 和 `yarnpkg` 指向該 `/opt` 目錄樹；
- 將 `docker-entrypoint.sh` 複製至 `/usr/local/bin`，並設定映像檔的 `ENTRYPOINT`/`CMD` 中繼資料。

這些是 Docker 映像檔額外加入的內容，不能據此認定上游 Node tarball 包含 Yarn、`node` 帳號或 entrypoint。[Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)、[`docker-node` Yarn 隨附政策](https://github.com/nodejs/docker-node#yarn-v1-classic-bundling)

**來源事實：**`docker-node` 文件指出，只有 Node 25 以下（含 Node 25）隨附 Yarn Classic，從 Node 26 起不再隨附。因此，即使 Debian 變體名稱相同，「官方映像檔內附什麼」也會隨發行主線而變。[`docker-node` Yarn v1 政策](https://github.com/nodejs/docker-node#yarn-v1-classic-bundling)

### 1.3 Slim 配方保留的作業系統套件

**來源事實：**Trixie Slim 配方會暫時安裝 `ca-certificates`、`curl`、`wget`、`gnupg`、`dirmngr`、`xz-utils` 和 `libatomic1`。接著將套件標為自動安裝，對 `/usr/local` 下的可執行檔執行 `ldd`，將外部程式庫路徑對應回所屬的 Debian 套件，將這些套件標為手動安裝，最後移除可自動移除的套件。因此，Dockerfile 刻意只保留已找到的可執行檔所需的 Debian 套件，而非所有下載與建置工具。[Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

**未知：**該配方沒有公布不分架構的最終 dpkg 清單。實際保留的套件集合取決於確切的 Debian 基礎層、目標架構及 `ldd` 結果。不可變的 OCI manifest 固定了實際產生的映像檔，但僅憑 Dockerfile，仍不足以列出所有最終套件及版本。Devbox 不得推斷複製 `/usr/local` 也會複製這些套件。

**來源事實：**Node 24 官方 GNU/Linux x64 與 arm64 二進位檔在 RHEL 8 上建置，屬於 Tier 1，要求 glibc >= 2.28 及 libstdc++ >= 6.0.25。Debian 13 超過這些已述明的基準。較新的 Node 發行主線可能增加要求：Node 當時的建置文件指出，從 Node 25 起，官方 Linux 二進位檔需要 `libatomic` Runtime。[Node 24 支援／官方二進位平台](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#official-binary-platforms-and-toolchains)、[當時的 Node 官方二進位檔要求](https://github.com/nodejs/node/blob/main/BUILDING.md#official-binary-platforms-and-toolchains)

**來源事實：**Node 預設會在建置時內含其相依項目；發行版也可選擇改用共用相依項目，此時須自行負責 Runtime 相容性。這減少了最終階段對系統程式庫的需求，但無法完全排除：官方 Linux 可執行檔仍有 glibc/libstdc++ 等平台 Runtime 要求，而 Node 25+ 還需要 libatomic。[Node 建置文件：共用相依項目](https://github.com/nodejs/node/blob/main/BUILDING.md#building-to-use-shared-dependencies-at-runtime)

## 2. 平台與架構解析

**來源事實：**Node 發行索引是可由程式讀取的精確版本清單。每筆紀錄包含精確版本、日期、可用的檔案類別、npm 版本、V8/OpenSSL 版本、原生模組 ABI 編號（`modules`）、LTS 值及安全性版本旗標。當時仍受支援的版本提供 `linux-x64` 和 `linux-arm64` 兩種產出物。[Node 發行索引 JSON](https://nodejs.org/dist/index.json)、[Node 發行目錄](https://nodejs.org/download/release/)

**來源事實：**Node 的發行政策區分發行主線與精確版號。截至研究日期，22.x 是 Maintenance LTS，24.x 是 Active LTS，26.x 是 Current；各主線仍持續推出精確的修補版本。[Node Release 工作小組時程](https://github.com/nodejs/Release#release-schedule)

**來源事實：**官方 `docker-node` Trixie Slim 配方將建置階段的 Debian 架構對應到相符的 Node 壓縮檔。支援的情況包括 `amd64 -> x64` 與 `arm64 -> arm64`。`docker-node` 表示，其支援的作業系統／架構組合記錄於 `versions.json`。[Trixie Slim 架構對應邏輯](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)、[`docker-node` 支援的架構](https://github.com/nodejs/docker-node#supported-architectures)、[`versions.json`](https://github.com/nodejs/docker-node/blob/main/versions.json)

**來源事實：**Docker 多平台映像檔使用 OCI manifest list/index，指向不同平台各自的 manifest 與層。拉取映像檔時，Docker 會自動選擇與主機平台相符的版本。[Docker 多平台映像檔結構](https://docs.docker.com/build/building/multi-platform/#difference-between-single-platform-and-multi-platform-images)

**觀察到的官方 registry 範例（2026-08-10）：**`node:24.19.0-trixie-slim` 是 digest 為 `sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d` 的 OCI 映像檔索引；其 `linux/amd64` 子 manifest 為 `sha256:f2925910482dc53394bc0034c5f4abffcd01de400794c050ca343fe0d733b486`，`linux/arm64/v8` 則為 `sha256:8525258f39fa3365fcf9a9d01e85458c7280ad00bd30c5e67655311262257e9e`。[Docker Hub 官方標籤 API](https://hub.docker.com/v2/repositories/library/node/tags/24.19.0-trixie-slim)

**意涵：**由 amd64/arm64 共用的 lock 可以記錄不可變的**索引 digest**、預定目標平台；若需要逐平台精確到位元組的來源追溯資訊，還可記錄解析後的子 manifest digest。只記錄其中一個子 manifest digest，無法描述兩種架構。若直接使用 tarball，則需要為每種 Node 壓縮檔架構各記錄一個經簽署的 SHA-256。

## 3. 移置來源映像檔內容與直接安裝 tarball 的比較

| 比較面向 | 以 digest 固定的官方來源映像檔 | 直接使用官方 Node tarball |
| --- | --- | --- |
| 上游 Node 內容 | 配方下載官方 `linux-$ARCH.tar.xz`、驗證 Node 已簽署的 checksum 檔，再解壓縮。[Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile) | 建置流程下載同一份官方壓縮檔，且必須自行驗證 `SHASUMS256.txt.asc` 與所選檔案的 SHA-256。[Node 驗證說明](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries) |
| 額外的信任／發布邊界 | Node 發行版 + `nodejs/docker-node` 配方 + Docker Official Image registry/manifest。digest 固定已發布的映像檔。Docker 指出標籤可以變動，但 digest 會選取同一個映像檔。[Docker digest 固定方式](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions) | Node 發行目錄 + 對 Node 發行金鑰的信任。不經過 OCI 發布步驟，但 Devbox 必須負責正確實作金鑰環、簽章及 checksum 驗證。[Node 發行金鑰](https://github.com/nodejs/node/blob/main/README.md#release-keys) |
| amd64/arm64 | 一個不可變的 OCI 索引可自動選擇正確的子 manifest；仍須明確指定目標平台。[Docker 多平台文件](https://docs.docker.com/build/building/multi-platform/) | 解析器將 `linux/amd64 -> linux-x64`、`linux/arm64 -> linux-arm64`；每種壓縮檔在已簽署清單中各有不同的 SHA-256。[Node 索引](https://nodejs.org/dist/index.json) |
| 隔離路徑 | 官方檔案起初位於 `/usr/local`；移置時須處理映像檔新增的絕對符號連結，並排除僅屬於映像檔的內容。 | 使用 `--strip-components=1`，直接解壓縮一次到 `/opt/devbox/runtimes/node/<line>`；源自 tarball 的 npm/Corepack 連結是相對路徑，移置後仍位於同一目錄樹內。[Node 安裝目錄配置](https://github.com/nodejs/node/blob/v24.x/tools/install.py) |
| npm/Corepack | npm 來自 Node tarball；Corepack 只在該 Node 版本有隨附時才存在。映像檔另於 Node 25 以前（含 Node 25）隨附 Yarn v1。[映像檔變體](https://github.com/nodejs/docker-node#image-variants)、[Corepack 生命週期](https://nodejs.org/docs/latest-v24.x/api/corepack.html) | npm/Corepack 內容與所選 Node tarball 完全一致；沒有映像檔額外加入的 Yarn。Devbox 另外鎖定的套件管理工具規劃仍須明確列出。 |
| 共用程式庫 | 移置 `/usr/local` **不會**帶入留在 `/lib`、`/usr/lib` 或 dpkg 狀態中的 Debian 套件。 | 最終 Base 也有相同責任。Node 壓縮檔不包含完整的 Debian Runtime 檔案系統。Node 文件列出了其 Linux ABI 基準。[Node BUILDING](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#official-binary-platforms-and-toolchains) |
| 配方變動 | digest 固定配方的產出，包括當時映像檔新增或移除的內容。新的精確 Node 版號通常代表新的映像檔 digest。 | 精確 URL + checksum 固定壓縮檔內容；Devbox 的解壓縮配方則在產生的建置邏輯中另外管理及版本化。 |
| 與當時 lock 的相容性 | 可直接對應既有的 `revision` + `image` + `digest` 欄位。 | 必須審慎重新詮釋或修改 schema，以容納壓縮檔 URL、壓縮檔 SHA-256、checksum 清單識別資訊，以及簽署金鑰的信任輸入。 |
| 快取形式 | 拉取／快取已固定的來源映像檔，再用 `COPY --from`；若目的地限制可接受，`COPY --link` 可提高重用與 rebase 效率。[Docker `COPY --link`](https://docs.docker.com/reference/dockerfile/#copy---link) | 以一個 `RUN` 完成下載、驗證、解壓縮及刪除壓縮檔。變更精確版號／checksum 的 ARG 會使該指令的快取失效；命中快取時不會重新檢查網路 URL。[Docker 快取失效規則](https://docs.docker.com/build/cache/invalidation/) |

## 4. 為何單純使用 `COPY` 可能不完整或有誤

### 4.1 `COPY /usr/local` 涵蓋的內容

**來源事實：**Docker 指出，`COPY --from` 會從指定階段／映像檔檔案系統的根目錄讀取來源路徑。對目錄而言，會遞迴複製其內容及檔案系統中繼資料；僅複製檔案不會繼承映像檔設定。[Dockerfile `COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from)、[Dockerfile 目錄複製語意](https://docs.docker.com/reference/dockerfile/#copying-from-the-build-context)

因此，Node 24 官方映像檔的 `/usr/local` 包含從 tarball 解壓縮的 Node 目錄樹及其 npm/npx/Corepack 連結，也包含映像檔新增的 `nodejs` 符號連結與 entrypoint，以及 Yarn/Yarnpkg 連結。整棵目錄樹移置後，相對的 npm/npx/Corepack 連結仍能解析，因為其目標仍位於同一個新根目錄之下。這可從 Node 安裝程式建立的連結目標看出。[Node 24 安裝程式](https://github.com/nodejs/node/blob/v24.x/tools/install.py)

### 4.2 已確認的遺漏與錯誤連結

例如以下複製方式：

```dockerfile
COPY --from=node-source /usr/local/ /opt/devbox/runtimes/node/24/
```

根據來源資料，可確認有以下限制：

1. **遺漏 Yarn 本體：**映像檔將 Yarn 1.22.22 放在 `/opt/yarn-v1.22.22`；`/usr/local` 下只有 `/usr/local/bin/yarn` 和 `yarnpkg` 符號連結。因此，只複製 `/usr/local` 會複製到連結，卻不會複製其位於 `/opt/yarn-v1.22.22/...` 的目標。[Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
2. **`nodejs` 指向隔離目錄樹之外：**映像檔建立的 `nodejs` 是指向 `/usr/local/bin/node` 的絕對連結。移置後，該連結不會指向 `/opt/devbox/runtimes/node/24/bin/node`。[同一份 Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
3. **遺漏共用程式庫套件：**Slim 配方透過 `ldd`/dpkg 保留套件，影響的是 `/usr/local` 以外的 Debian 路徑。多階段檔案複製不會帶入來源階段未選取的檔案系統內容或套件資料庫。[同一份 Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)、[Docker `COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from)
4. **遺漏使用者／帳號狀態：**`/etc/passwd`、`/etc/group` 與 `/home/node` 都在 `/usr/local` 以外。它們屬於容器映像檔的使用環境，不屬於可移置的 Node Runtime。[同一份 Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
5. **遺漏映像檔設定：**`ENV NODE_VERSION`、`ENTRYPOINT` 與 `CMD` 是映像檔中繼資料／指令，不是從 `/usr/local` 複製的檔案。例如 Docker 明確指出，若某階段僅被 `COPY --from` 參照，就不會繼承其 metadata labels。[Dockerfile 中繼資料繼承說明](https://docs.docker.com/reference/dockerfile/#label)
6. **帶入映像檔專用的 entrypoint：**`/usr/local/bin/docker-entrypoint.sh` *確實會*被複製，儘管最終 Workspace 不需要將其設為 Node Runtime 命令。[Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

一併複製 `/opt/yarn-v1.22.22` 也不是良好的多版本解法：其 `/usr/local` 與 `/opt` 絕對連結仍假設全域路徑，而且 Node 26 已不再隨附 Yarn。Devbox 已有更嚴謹的契約：套件管理工具是各發行主線 Runtime 套件目錄中，版號精確且獨立鎖定的成員。

**未知：**Docker 當時的 Dockerfile 參考文件指出會複製目錄內容與檔案系統中繼資料，但未明確規定所有 builder/frontend 對來源符號連結取消參照的邊界情況。此處的建議不依賴未記載的邊界行為：應保留已知連結後檢查並正規化，或從已知的 tarball 原有路徑建立發行主線目錄樹。`COPY --link` 對*目的地*路徑中的符號連結也有文件記載的限制。[Docker `COPY --link` 不相容情況](https://docs.docker.com/reference/dockerfile/#incompatibilities-with-linkfalse)

## 5. 原生 addon 與 ABI

**來源事實：**Node 發行索引會顯示每個精確版本的 `modules` 編號；這有助於看出精確的 Node 版本不只是發行主線標籤。[Node 發行索引](https://nodejs.org/dist/index.json)

**來源事實：**Node-API 的 ABI 在不同 Node 版本之間保持穩定，設計目的之一是讓 addon 不受 V8 變動影響。Node 明確指出，Node C++ API（`node.h`、`node_buffer.h`、`node_version.h`、`node_object_wrap.h`）、V8、libuv，以及 addon 使用的任何外部程式庫，都沒有相同的跨主要版本 ABI 保證。[Node 24 Node-API ABI 保證](https://nodejs.org/docs/latest-v24.x/api/n-api.html#node-api)、[相關意涵與排除項目](https://nodejs.org/docs/latest-v24.x/api/n-api.html#implications-of-abi-stability)

**兩種來源選項共同的意涵：**由於官方映像檔使用官方 tarball，在精確版號和架構相同時，選映像檔或 tarball 不會改變 Node 的 addon ABI。原生 addon 能否正確運作，反而取決於：

- 所選的精確 Node 版本／ABI；
- 目標架構（`amd64` 或 `arm64`）；
- 最終 Debian Base 中的 libc 與外部共用程式庫；
- addon 是否只使用受支援的 Node-API 版本，或以不穩定的 Node/V8 API 為目標；
- addon 是在哪個位置、針對哪條 Runtime 發行主線編譯的。

Devbox 不應在不同架構之間共用已編譯的 `node_modules` 原生產出物，也不應假設它們可在不同 Node 主要版本的發行主線根目錄之間移用。Node-API 可能允許跨 Node 版本重用，但前提是符合其明定的 API／版本和外部程式庫限制；單靠來源追溯資訊無法證明這點。

## 6. BuildKit 層與快取

**來源事實：**Docker 會先檢查基礎映像檔的快取。`COPY`/`ADD` 的快取鍵包含檔案中繼資料；一般的 `RUN` 快取通常比較指令本身，而不檢查從網路取得的檔案。一旦某層未命中快取，後續指令也會失去快取命中。[Docker 快取失效規則](https://docs.docker.com/build/cache/invalidation/)

**來源事實：**Build ARG 的值在被使用時會影響快取。因此，階段中使用的精確 Node 版本、來源 digest/checksum 或目標架構，都能為 BuildKit 提供明確的快取邊界。[Dockerfile ARG 對快取的影響](https://docs.docker.com/reference/dockerfile/#impact-on-build-caching)

**來源事實：**`RUN --mount=type=cache` 可在多次 builder 執行之間保留快取目錄，且不會使該指令的快取失效；但 Docker 提醒，即使快取遭覆寫或垃圾回收，建置仍須保持正確。[Docker 快取掛載](https://docs.docker.com/reference/dockerfile/#run---mounttypecache)

**對 Devbox 的意涵：**

- **來源映像檔：**digest 變更會使來源識別資訊失效；複製穩定、經正規化的 Runtime 目錄樹，可讓每組精確版本／架構有一個可重用的層。當較早的來源階段層變動時，`COPY --link` 可能改善重用情形，但這是最佳化，不是正確性要求。[Docker `COPY --link` 的效益](https://docs.docker.com/reference/dockerfile/#benefits-of-using-link)
- **Tarball：**將下載、簽章／checksum 驗證、解壓縮與刪除壓縮檔放在同一個 `RUN`，避免壓縮檔及 GPG 作業檔留在額外的最終層中。精確 checksum／版號的變更必須納入該指令的快取鍵。命中既有 `RUN` 快取時，不會再連線至 Node 伺服器；冷快取建置的正確性來自鎖定的 SHA-256／簽章驗證，而非假設 URL 不會變。[Docker RUN 快取規則](https://docs.docker.com/build/cache/invalidation/#run-instructions)
- **快取掛載：**下載快取可以節省頻寬，但會增加命名、並行與垃圾回收相關行為。正確性不需要它；對大約每個精確版本才下載一次的壓縮檔而言，這也不是最簡單的初始實作。
- **兩者皆然：**將 Runtime 來源階段放在頻繁變動的 Agent／專案層之前，避免後續變動破壞 Runtime 快取。Docker 建議將穩定指令排在頻繁變動的指令之前。[Docker 快取順序](https://docs.docker.com/build/cache/invalidation/#general-rules)

## 7. 各方案所需的精確 Platform lock 輸入

以下清單區分**發行主線需求**（`24`）與**解析出的精確產出物**（`24.19.0`）。不論選哪一種來源，套件管理工具欄位都仍為必填；不能安全地從浮動的發行主線推定其 registry 版本／integrity。

### 方案 A — 以 digest 固定來源映像檔（依當時 ADR 建議）

針對每條 Node 發行主線及每個目標平台，鎖定：

- `release_line`：例如 `24`；
- `revision`：精確 Node 版號，例如 `24.19.0`；
- `source.image`：供人工稽核的精確標籤，例如 `node:24.19.0-trixie-slim`；
- `source.index_digest`：不可變的 OCI 索引 digest；
- `source.platform`：例如 `linux/amd64` 或 `linux/arm64`；
- `source.manifest_digest`：若 lock 要求逐平台精確到位元組的識別資訊，則記錄解析後不可變的子 manifest digest；
- `package_managers.npm.revision` 與 registry integrity；
- `package_managers.corepack.revision` 與 registry integrity；
- `package_managers.pnpm.revision` 與 registry integrity；
- `package_managers.yarn.revision`（ADR 限定為 1.x）與 registry integrity。

Docker 文件指出，標籤可以變動，而透過 digest 固定可在標籤移動後仍選取同一個映像檔。[Docker 固定映像檔指引](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions) 精確標籤仍可作為有用的稽核背景資訊，但識別依據是 digest。

**未知／設計選擇：**既有 ADR 的措辭提到 `source image` 與 `digest`，但未說明 `digest` 指的是多平台索引，還是選定的子 manifest。在同時支援 amd64 與 arm64 之前，lock serializer/resolver 應明確區分；默默混用兩種 digest 會造成歧義。

### 方案 B — 直接使用官方 tarball

針對每條 Node 發行主線及每個目標平台，鎖定：

- `release_line`；
- `revision`：精確 Node 版號；
- `source.platform` 與 Node 壓縮檔的架構代碼（`x64` 或 `arm64`）；
- 精確的壓縮檔 URL，例如 `https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz`；
- 從該版本已簽署的 `SHASUMS256.txt.asc` 中選出的精確壓縮檔 SHA-256；
- 精確的 checksum 清單 URL；
- 簽章驗證的信任輸入：至少是經版本化／雜湊固定的 Node 發行金鑰環，或可接受的發行者金鑰指紋，而非未固定的「keyserver 回傳什麼就用什麼」相依項目；
- 若產生的配方變動須獨立於上游內容影響 Workspace 識別資訊，則還須鎖定 Devbox 解壓縮／正規化配方的識別資訊；
- 上述四種套件管理工具各自相同的精確版本／integrity 對應資訊。

[Node 的驗證說明](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries)確立了簽署清單的驗證流程。官方文件**沒有**規定 Platform lock schema 或長期固定金鑰環的政策；這些是 Devbox 的設計責任。

## 8. 當時對 ADR-0035 的最終建議

**Devbox 建議：**當時建議目前分支選擇**方案 A：以 digest 固定的官方 Trixie Slim 來源映像檔**。此建議已由文件開頭所述 ADR-0036 決策取代。

當時認為這是最簡單且相容的決策，理由如下：

1. 來源映像檔中的 Node 內容已是官方預先編譯的 tarball，並透過 Node 已簽署的 SHA-256 清單驗證；重複下載無法帶來 Node 編譯品質上的差異。[官方 Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
2. 既有的 Node lock 項目已有適切的來源追溯欄位：精確 Runtime 版本、來源映像檔與不可變的 digest；直接使用 tarball 則需要新的壓縮檔／簽章信任 schema。
3. Docker 可從多平台索引原生解析正確的 manifest，也能快取並重用多階段複製的結果。[Docker 多平台映像檔](https://docs.docker.com/build/building/multi-platform/#difference-between-single-platform-and-multi-platform-images)、[`COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from)
4. 符合 ADR-0035 的單一產生 Dockerfile：先建立 Base 階段，再為各設定的發行主線建立以 digest 固定的 Node 來源／正規化階段，最後組裝 Workspace。不需要另外具現化本機 Runtime 映像檔或主機上的暫存目錄。
5. 已知的映像檔目錄配置風險範圍有限，且可由官方 Dockerfile 證實：排除 `docker-entrypoint.sh`、重寫或移除使用絕對路徑的 `nodejs` 連結、不複製映像檔的 `/opt/yarn-*`，並由已鎖定的 Base 原生套件規劃提供共用程式庫套件。

產生的套件目錄契約應著重內容，而非模仿來源容器：

```text
/opt/devbox/runtimes/node/24/bin/node
/opt/devbox/runtimes/node/24/bin/npm
/opt/devbox/runtimes/node/24/bin/npx
/opt/devbox/runtimes/node/24/bin/corepack   # 僅在鎖定的規劃安裝時才有
/opt/devbox/runtimes/node/24/lib/...
/opt/devbox/runtimes/node/24/include/...
/opt/devbox/runtimes/node/24/share/...
```

套件目錄不應依賴 `/usr/local/bin/node`、`/opt/yarn-v1.22.22`、來源映像檔的 `ENTRYPOINT` 或其 `node` 帳號。npm/Corepack/pnpm/Yarn 的精確內容由 lock 中的套件管理工具項目決定，因此，即使上游在 Node 25/26 改變隨附內容，行為仍可保持一致。

依當時的建議，只有當 Devbox 有意決定以 Node 發行壓縮檔（而非 Docker Official Image 的發布產物）作為標準 Runtime 來源，並接受相應的 Platform lock 與簽章金鑰生命週期變更時，才應在之後改選直接使用 tarball。這是合理且乾淨的架構，但以當時的 ADR 而言並非最小變更；文件開頭的 ADR-0036 更新已記錄後續實際決策。
