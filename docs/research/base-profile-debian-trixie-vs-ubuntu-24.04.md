# Base profile：Debian 13 Trixie Slim vs. Ubuntu 24.04 LTS

> Research date: 2026-08-10. 範圍是 Devbox 分支 8 的唯一、非使用者可選 Base profile，主要平台為 `linux/amd64`、`linux/arm64`。這是研究，不是實作。
>
> **來源界線：**「OS 官方 archive」只指 Debian/Ubuntu 自己的套件庫。`ppa:ondrej/php` 與 `packages.sury.org/php` 即使由 Debian PHP 維護者 Ondřej Surý 維護，仍是**第三方來源，不是 Debian 或 Ubuntu 官方 archive**。
>
> [ADR-0036](../adr/0036-family-owned-runtime-recipes.md) 已決定每個 Runtime family 擁有自己的 recipe，Node 直接安裝官方 binary tarball；Base 不再受 Node Docker image variant 綁定。[ADR-0035](../adr/0035-inline-base-workspace-build.md) 的單一 generated Workspace Dockerfile 仍有效。
> Decision update: ADR-0037 selected Ubuntu 24.04 LTS because Devbox is Lucas's personal development environment and Ubuntu familiarity outweighs retaining the Trixie evidence. The Debian recommendation below remains the pre-decision technical comparison, not the active architecture.

## 決策摘要

**建議維持 Debian 13 Trixie Slim。** 理由不是 Ubuntu 無法執行 Node，也不是 Debian 官方 archive 能供應多個 PHP release lines：

1. Node 官方 GNU/Linux x64/arm64 binary 要求 glibc `>= 2.28`、libstdc++ `>= 6.0.25`；Trixie 的 glibc 2.41 與 Noble 的 2.39 都符合。Node 25 起另需 `libatomic` runtime，兩邊都可由 Base recipe 安裝。因此 Node 對 OS 選擇近乎中性（[Node official binary platforms](https://github.com/nodejs/node/blob/main/BUILDING.md#official-binary-platforms-and-toolchains)）。
2. Debian Trixie 官方 archive 的 default PHP 是 8.4；Ubuntu Noble 是 8.3。兩邊各只有一條 PHP release line，都不能靠 OS 官方 archive 滿足多版本共存（[Debian `php`](https://packages.debian.org/trixie/php)、[Ubuntu `php`](https://packages.ubuntu.com/noble/php)）。
3. Docker Official `php` image 在研究日同時有多個 PHP lines 的 Trixie/Bookworm/Alpine variants，沒有 Ubuntu variant；既有 ADR-0004/0005/0006 prototype、native owner closure 與 extension 組裝又全在 Trixie。改 Ubuntu 必須重做 PHP recipe 或接受第三方 repository，並重跑 ABI/package/extension 證據（[Docker Official PHP manifest](https://github.com/docker-library/official-images/blob/master/library/php)）。
4. Ubuntu Standard Security Maintenance 到 2029-05；Debian full support 到 2028-08-09，LTS 到 2030-06-30。Ubuntu Pro 可到 2034、Legacy 到 2039，但那是額外 entitlement 與營運狀態，且 Ubuntu 的一般五年 LTS security maintenance 明列為 Main；Universe 的 expanded security coverage 需 Pro（[Ubuntu lifecycle](https://ubuntu.com/about/release-cycle)、[Debian Trixie lifecycle](https://www.debian.org/releases/trixie/)）。

所以最少狀態、最少特殊處理的答案是 Debian。只有在 Ubuntu 2029/2034 lifecycle 的價值高於保留現有 Trixie 證據，而且願意建立、驗證 Ubuntu-native PHP recipe 時，才應切 Ubuntu。

主代理最後只需問：

> **維持 Debian 13 Trixie Slim，還是接受重做 PHP/Base 證據與 recipe 的成本，改用 Ubuntu 24.04 LTS？**

## 1. Release、support、image 與 architecture

| 項目 | Debian 13 Trixie Slim | Ubuntu 24.04 LTS Noble | Devbox 含義 |
| --- | --- | --- | --- |
| 初始 release | 2025-08-09；研究日頁面列 13.6 | 2024-04 LTS | Point release/tag 不是 immutable identity，lock 仍須固定 OCI digest。 |
| 一般期限 | full support 至 2028-08-09；LTS 至 2030-06-30，LTS architecture set 會縮減 | Standard Security Maintenance 至 2029-05；五年 standard coverage 是 Main | Ubuntu 多約九個月 standard window；Debian LTS 不代表所有 package/architecture 都同等涵蓋。 |
| 額外延長 | Trixie 官方頁面未宣告超過 2030-06-30 | Ubuntu Pro ESM 至 2034-05；Legacy add-on 至 2039-05 | Pro/Legacy 不能算成無額外狀態的預設 Base support。 |
| Docker Official tag | `trixie-slim`、`13-slim`、日期 tag | `24.04`、`noble`、日期 tag；沒有 `noble-slim` | Ubuntu image 可用，但不能把不存在的 slim tag 寫入契約。 |
| Image provenance | `debuerreotype/docker-debian-artifacts` | Canonical `cloud-images/+oci/ubuntu-base` | 都是 Docker Official Images；固定 digest，不信任 mutable tag。 |
| OS 官方 architectures | amd64、arm64、armhf、ppc64el、riscv64、s390x；i386/armel 僅受限角色 | amd64、armhf、arm64、s390x、riscv64、ppc64el-p9 | 都包含主要 amd64/arm64。 |
| 研究日 image architectures | `trixie-slim`：amd64、arm32v5、arm32v7、arm64v8、i386、ppc64le、riscv64、s390x | `24.04`：amd64、arm32v7、arm64v8、ppc64le、riscv64、s390x | Image 發布集合不等於 lifecycle 對每個 architecture 的完整 support claim。 |

第一方來源：

- [Debian 13 release information](https://www.debian.org/releases/trixie/)：release、support 與 architecture。
- [Ubuntu release cycle](https://ubuntu.com/about/release-cycle)：24.04 Standard/ESM/Legacy 日期，以及 Main/Universe coverage。
- [Docker Official Debian manifest](https://github.com/docker-library/official-images/blob/master/library/debian)：`trixie-slim`、日期 tag、architectures 與 provenance。
- [Docker Official Ubuntu manifest](https://github.com/docker-library/official-images/blob/master/library/ubuntu)：`24.04`/`noble`、architectures 與 Canonical provenance；沒有 slim variant。
- [Docker digest pinning](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)：tag 可變、digest 固定 artifact。

**未知：**官方 lifecycle 頁面沒有替「Devbox 的完整 CLI + native libraries」給單一終止日。實際 support claim 必須納入 Ubuntu package component、Debian LTS package/architecture 範圍與是否啟用 Pro，不能只引用最長年份。

## 2. glibc、toolchain、package naming 與 ABI

### Node official binary

研究日 package indexes 顯示 Trixie `libc6` 為 glibc 2.41（當時 `2.41-12+deb13u3`），Noble 為 2.39（當時 amd64 `2.39-0ubuntu8.8`）：[Debian `libc6`](https://packages.debian.org/trixie/libc6)、[Ubuntu `libc6`](https://packages.ubuntu.com/noble/libc6)。Node current contract 對 GNU/Linux x64/arm64 列 `kernel >= 4.18`、`glibc >= 2.28`，official binaries 相容 `libstdc++ >= 6.0.25 (GLIBCXX_3.4.25)`；Node 25 起需 `libatomic` runtime（[Node `BUILDING.md`](https://github.com/nodejs/node/blob/main/BUILDING.md#official-binary-platforms-and-toolchains)）。

因此 ADR-0036 的 `linux/amd64 -> linux-x64`、`linux/arm64 -> linux-arm64` archive mapping 不因 Debian/Ubuntu 改變；兩邊都通過 Node ABI 下限。Node 25+ 要把 `libatomic1` 納入 Base plan。每個 Node major 的同版 `BUILDING.md` 才是該 line 契約，不能把 `main` 要求回推所有舊 line。

### `build-essential`

兩邊都有 `build-essential`，都依賴 `dpkg-dev`、`gcc`、`g++`、`libc6-dev`、`make`，但 closure 不同：

- Trixie `build-essential` 12.12 使用 default GCC/G++ 14.2，`gcc` 指向 `gcc-14`（[Debian `build-essential`](https://packages.debian.org/trixie/build-essential)、[Debian `gcc`](https://packages.debian.org/trixie/gcc)）。
- Noble `build-essential` 12.10ubuntu1 使用 default GCC/G++ 13.2，`gcc` 指向 `gcc-13`（[Ubuntu `build-essential`](https://packages.ubuntu.com/noble/build-essential)、[Ubuntu `gcc`](https://packages.ubuntu.com/noble/gcc)）。

相同 meta-package 名稱不代表 compiler、headers 或 package revisions 相同。特定 addon/extension 的 C/C++ 要求仍由 family recipe 驗證。

### Native addons、PHP extensions 與 package names

- Trixie 是 glibc 2.41、Noble 是 2.39；在 Trixie 建置且引用新 glibc symbol 的 binary 不能因 Ubuntu 也是 glibc 就搬過去。
- SONAME package 隨 distro generation 改名；例如 Trixie 是 `libicu76`，Noble 是 `libicu74`（[Debian `libicu76`](https://packages.debian.org/trixie/libicu76)、[Ubuntu `libicu74`](https://packages.ubuntu.com/noble/libicu74)）。相同 `libicu-dev` request 也會解析到不同 runtime owner/ABI。
- Node-API 可保護 Node-version ABI，但不涵蓋 external libraries，也不涵蓋非 Node-API 的 V8/Node C++ APIs（[Node-API guarantees and exclusions](https://nodejs.org/docs/latest-v24.x/api/n-api.html#implications-of-abi-stability)）。
- PHP extension 依賴 exact PHP/Zend module ABI、headers、architecture 與 external libraries；Trixie `.so` 不能當 Noble artifact。

**規則：**切 Base OS 時，所有 Node native addons、PHP binaries/extensions 與 owner-package closure 都要重建、重解、重驗證；不可用 package-name translation shim 假裝 ABI 不變。

## 3. PHP 官方 archive 與第三方 repository

### OS 官方 archive 只各有一條 line

| | Debian 13 官方 archive | Ubuntu 24.04 官方 archive |
| --- | --- | --- |
| Default | PHP 8.4；`php` `2:8.4+96` 依賴 `php8.4` | PHP 8.3；`php` `2:8.3+93ubuntu2` 依賴 `php8.3` |
| CLI | `php8.4-cli`；研究日 security revision 8.4.24 | `php8.3-cli`；研究日 amd64 security revision 8.3.6 Ubuntu backport |
| 多版本共存 | **官方 archive 不提供** 8.2/8.3 lines | **官方 archive 不提供** 8.2/8.4 lines |

來源：[Debian `php`](https://packages.debian.org/trixie/php)、[`php8.4-cli`](https://packages.debian.org/trixie/php8.4-cli)、[Trixie 無 `php8.2-cli`](https://packages.debian.org/trixie/php8.2-cli)、[Ubuntu `php`](https://packages.ubuntu.com/noble/php)、[`php8.3-cli`](https://packages.ubuntu.com/noble/php8.3-cli)、[Noble 無 `php8.2-cli`](https://packages.ubuntu.com/noble/php8.2-cli)。Versioned package name 不等於 suite 同時發布多條 major/minor。

所以不能因 Ubuntu 社群常用 `ppa:ondrej/php`，就寫成「Ubuntu 官方支援多版本 PHP」；兩個 OS 的官方 archive 都解不了 Devbox open release-line 契約。

### Docker Official PHP / upstream source

研究日 [Docker Official PHP manifest](https://github.com/docker-library/official-images/blob/master/library/php) 同時列 PHP 8.2、8.3、8.4、8.5（另有 8.6 pre-release）的 `cli-trixie` variants，也列 Bookworm/Alpine；沒有 Noble/Ubuntu variant。

- 維持 Trixie：PHP family recipe 可沿用同 ABI generation 的 digest-pinned `php:<exact>-cli-trixie` source stage，再 resolve owner packages、建置 extensions、驗證每條 exact line。
- 改 Noble：不能假設把 glibc 2.41 Trixie stage 的 `/usr/local` 複製到 glibc 2.39 Noble 受支援。必須改成在 Noble 從 PHP official source 原生編譯並建立 Ubuntu dependency plan，或接受第三方 packages。

PHP 官方提供 source downloads，Unix 文件描述 `./configure`、`make`、`make install`；沒有 Node/Go 那種通用 GNU/Linux x64/arm64 binary tarball ABI contract（[PHP downloads](https://www.php.net/downloads.php)、[Unix installation](https://www.php.net/manual/en/install.unix.php)）。ADR-0036 允許 source-build recipe，但不會消除 OS-specific dependencies、extension linkage 與驗證成本。

**未知：**官方資料未承諾未來提供 Ubuntu image variant，也未保證所有 open PHP lines 永遠有 Trixie variant。Devbox 仍需 build-time availability/compatibility gate。

### `ppa:ondrej/php` 與 `packages.sury.org`

Ubuntu [Ondřej PPA 頁面](https://launchpad.net/~ondrej/+archive/ubuntu/php) 在研究日明示：

- Jammy/Noble 仍可用；repository 正在合併到 `packages.sury.org/php`，Resolute 改走後者；
- Launchpad 安裝區稱其為 “unsupported packages” 與 “untrusted PPA”；
- 使用獨立 signing key，不是 Ubuntu primary archive identity。

Debian 的 [`packages.sury.org` distributions](https://packages.sury.org/php/dists/) 列 Trixie；其 [README](https://packages.sury.org/php/README.txt) 要求安裝自己的 `debsuryorg-archive-keyring.deb` 並新增 apt source；[Trixie package index](https://packages.sury.org/php/dists/trixie/main/binary-amd64/Packages) 發布多個 versioned PHP lines。研究日 index 也列 Noble，但它仍不是 Ubuntu 官方 archive。

採用任一路徑都新增：repository URL/suite、signing-key lifecycle、第三方 build/publish boundary、apt pinning/同名 package replacement、dependency drift、PPA-to-Sury migration，以及不受 Debian LTS/Ubuntu Standard/Pro 自動涵蓋的 support claim。

**未知：**來源沒有給 Devbox 可依賴的 immutable snapshot retention SLA、每條 PHP line 終止日期，或與 OS lifecycle 等長的保證。簽章只能驗證 repository identity，不能消除上述 lifecycle/trust 成本。

## 4. ADR-0036 後的 Python、Go、Rust

| Family | 第一方安裝物 | 特定 Base OS？ | Base 仍影響什麼 |
| --- | --- | --- | --- |
| Node | signed `linux-x64`/`linux-arm64` tarball | 否；要求 GNU/Linux ABI baseline，兩候選都符合 | glibc/libstdc++/libatomic、native addons、arch mapping（[Node](https://github.com/nodejs/node/blob/main/BUILDING.md#official-binary-platforms-and-toolchains)）。 |
| Go | `linux-amd64`/`linux-arm64` tarball | 否；官方安裝是解壓 archive | `cgo` 使用 target Base compiler、headers、libc/SONAME（[install](https://go.dev/doc/install)、[downloads](https://go.dev/dl/)）。 |
| Rust | `rustup` 選 GNU/Linux target toolchain | 否；target triple/platform requirement 不是 distro brand | GNU target 的 platform baseline、linker、system crates/libraries（[rustup](https://rust-lang.github.io/rustup/installation/index.html)、[platforms](https://doc.rust-lang.org/rustc/platform-support.html)）。 |
| Python | python.org source tarball | 否；可在兩邊編譯，但無通用官方 Linux binary tarball contract | build deps、OpenSSL/SQLite/readline 與 native extensions（[sources](https://www.python.org/downloads/source/)、[Unix build](https://docs.python.org/3/using/unix.html#building-python)）。 |
| PHP | php.net source；Official Images 是 Debian/Alpine variants | Source build 不要求 distro；現成 image 有 distro seam | PHP/extension ABI、dev packages、shared libraries（[PHP](https://www.php.net/downloads.php)、[images](https://github.com/docker-library/official-images/blob/master/library/php)）。 |

結論：family-owned recipe 已消除「每個 Runtime 必須有同名 Base image variant」的假約束，但沒消除 architecture、glibc、compiler、headers、SONAME 與 owner manifest。未來 Python/Go/Rust 都不是改 Ubuntu 的必要理由，也不是 Debian 專屬理由。現在唯一有明顯既有 distro alignment 的 family 是 PHP。

## 5. 切 Ubuntu 會使哪些 ADR-0004 證據/契約失效

ADR-0035 已淘汰 separate local Base image、Base `image_id` 與 `update --base` lifecycle。除此之外，切換仍會使以下 Trixie-specific 內容失效：

### Profile 與 support claim

- `Debian 13 Trixie Slim` shared ABI/profile identity；
- `debian:trixie-slim` exact source、digest 與 Debian package-plan vocabulary；
- 「Trixie current stable 且有 PHP/Node official variants」的理由：Node variant 已被 ADR-0036 淘汰為約束，PHP variant 仍有價值；
- Trixie support/LTS/architecture claim。

Ubuntu 必須是新 profile identity，記 Ubuntu source revision/digest 與 Ubuntu exact package plan；不能在原 identity 下 silent ABI change，也不能重用舊 Workspace fingerprint/Base layers。

### 2026-08-02 prototype evidence

ADR-0004 第 17–19 行全部失效：

- exact Trixie digest/local image ID/tag 與 12 shared Base layers；
- Base-only、Node-only、PHP-only、combined image pass；
- CLI/build helpers、`fd` symlink、timezone、`C.UTF-8`、unset `LC_ALL`、no `sudo`、apt state 不可寫；
- `passwd`、`util-linux`/`setpriv` provider/behavior；
- Trixie amd64 約 342 MB uncompressed toolchain closure。

Timezone/locale/non-root/no-sudo 的產品意圖可保留，但 Ubuntu 的 package path、locale、permissions、size 必須重測。

### Package manifests 與 native closure

ADR-0004 第 21–38 行全部失效：

- PHP 8.4.24 + Node 22.23.2 runtime owner union 全表；
- `libicu76`、`libzip5`、`libssl3t64` 等 exact owners；
- Node 只需 `libc6`/`libgcc-s1`/`libstdc++6` 且已被 PHP union 包含的集合關係；
- PHP build 的 `libfreetype-dev`、`libicu-dev`、`libjpeg62-turbo-dev`、`libpng-dev`、`libpq-dev`、`libsqlite3-dev`、`libwebp-dev`、`libzip-dev` actual-provider evidence；
- extensions 的 `ldd` closure/load pass 與 PHP/Node cross-invocation。

Node upstream minimum ABI claim仍成立；Ubuntu exact package-owner union 是**未知**，要對 amd64/arm64 重新 resolve/observe。

### 仍可保留

- ADR-0035：單一 machine-owned generated Dockerfile、Base stages first、lock 固定 source 與 package plan；
- ADR-0036：family recipe seam、release-line isolation、Node tarball + signed checksum；
- 單一 non-user-selectable profile、shared ABI、timezone/locale/non-root 的產品意圖；
- distro generation 必須顯式 rebuild，不能 silent ABI change。

切 Ubuntu 不推翻 build topology，但會替換其中所有 Trixie-specific inputs、manifests、evidence 與 support wording。

## 6. 建議

| 準則 | Debian 13 | Ubuntu 24.04 | 判斷 |
| --- | ---: | ---: | --- |
| 保留既有 Base/PHP 證據 | 5 | 1 | Ubuntu 要重跑全部 gate。 |
| Node tarball | 5 | 5 | 都符合 upstream baseline。 |
| Official PHP 多-line source alignment | 5 | 2 | Trixie 有 variants；Noble 沒有。 |
| OS archive 多版本 PHP | 1 | 1 | 都只有一條。 |
| 避免第三方 PHP repo | 5 | 3 | Noble 必須 source-build 或接受第三方。 |
| 無訂閱 standard/full window | 3 | 4 | Ubuntu 到 2029-05；Debian full 到 2028-08、縮減 LTS 到 2030-06。 |
| 最長額外 coverage | 2 | 5 | Ubuntu Pro/Legacy 較長，但增加 entitlement/state。 |
| 未來 Python/Go/Rust | 5 | 5 | 無 distro 必要條件。 |
| 最少變更/unknown | **5** | **2** | Debian 是 continuation；Ubuntu 是 migration。 |

### 建議維持 Debian 13 Trixie Slim

1. 保留現有 Base identity、Trixie package vocabulary 與 Docker Official PHP path，不新增 PPA/Sury key、pinning、migration state。
2. Node 已由 ADR-0036 解耦；切 Ubuntu 只會把已解掉的 Node image 問題換成新的 PHP source-build/cross-distro 問題。
3. Ubuntu 官方 archive 的 8.3-only 與 Debian 的 8.4-only 一樣不能解多版本；PPA availability 不能算 Ubuntu 官方 support。
4. 現有 Trixie amd64 prototype 可作基線；後續仍需 arm64、Node tarball 與每條 PHP recipe gate，但不必先清空 OS 證據。
5. Debian full support 到 2028-08、LTS 到 2030-06，足以先完成分支 8；應顯式規劃下一個 Base generation，而不是為約九個月 standard window 立即重做 PHP/Base。

### 只有符合以下條件才改 Ubuntu

- 把 Main 到 2029-05、可能啟用 Pro 到 2034/Legacy 到 2039 視為高於既有證據的硬需求；
- 明確選擇 Noble-native PHP source-build recipe，或明確接受第三方 Sury/PPA trust boundary；
- 建立新 Ubuntu profile/lock，而非原 profile 改名；
- 對 amd64/arm64 重跑 Base CLI、locale/timezone/non-root、Node tarball、PHP/extensions、`ldd` owners、combined Workspace 與 layer/cache evidence；
- 不把 PPA/packages.sury.org 寫成 Ubuntu 官方 support claim。

若這些條件未成立，Ubuntu 增加的狀態、特殊處理與未知大於 lifecycle 收益，且沒有解決多 release-line PHP。
