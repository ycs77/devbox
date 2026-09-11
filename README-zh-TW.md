<div align="center">

# @ycs77/devbox

**為 AI Agent 設計的容器化 Devbox。**

[![NPM version][ico-version]][link-npm]
[![Software License][ico-license]](LICENSE)
[![GitHub Tests Action Status][ico-github-action]][link-github-action]
[![Total Downloads][ico-downloads]][link-downloads]

[English](README.md) | 繁體中文

</div>

---

## 概覽

Devbox 為每個專案提供獨立的 Docker 沙箱，內建 Lucas 偏好的 AI Agent 開發設定。選擇 Node.js 版本與要使用的 AI Agent，即可在一致的容器環境中工作，無須自行設定容器。

## 功能

- **為 AI Agent 設計的容器環境：** 可在設定期間選擇 Claude Code、Codex 等，並在沙箱內使用。
- **簡單管理專案沙箱：** 透過幾個指令即可初始化、啟動、進入、停止與移除沙箱。
- **彈性的 Node.js 版本：** 選擇要建進 Workspace Image 的版本，再為各專案選擇。
- **依需求建置：** 只將你選擇的 Node.js 版本和 AI Agent 建進 Image。
- **不需要專案設定檔：** Devbox 設定只儲存在本機，不會寫入儲存庫。

## 系統需求

- **Node.js 22 或更新版本：** 用來透過 npm 安裝並執行 CLI。
- **Docker 與 Docker Compose：** 用來執行開發沙箱。
- **Windows：** 請在已啟用 Docker Desktop 整合的 **WSL2** Linux 發行版中使用 Devbox。

## 快速開始

全域安裝 Devbox：

```bash
npm install -g @ycs77/devbox
```

在專案目錄中初始化 Devbox：

```bash
devbox init
```

互動式設定會讓你選擇要加入的 Node.js 版本與 AI Agent，再為目前專案選擇 Node.js 版本。

全域設定決定共用 Workspace Image 包含哪些內容。每加入一個 Node.js 版本或 AI Agent，都會讓 Image 變大並多占用一些磁碟空間。專案只能使用已包含在 Image 裡的 Node.js 版本。

首次設定完成後，或變更全域設定後，請建置共用 Workspace Image：

```bash
devbox build
```

啟動專案沙箱：

```bash
devbox up
```

在執行中的沙箱內開啟 Shell，開始使用 AI Agent：

```bash
devbox sh
```

若你在設定時選了 Agent，進入 Shell 後可以執行 `claude`、`codex`、`agy` 或 `omp`。

## 指令

請在已初始化的專案目錄中執行以下指令：

| 指令 | 說明 |
| --- | --- |
| `devbox up` | 啟動專案沙箱。 |
| `devbox sh` | 在執行中的沙箱內開啟 Bash Shell。 |
| `devbox stop` | 停止沙箱，保留它以便稍後重新啟動。 |
| `devbox down` | 停止並移除沙箱容器。 |
| `devbox config` | 變更全域設定，或目前專案的設定。 |
| `devbox cleanup --missing-projects` | 移除根目錄已不存在的專案註冊。 |

## 疑難排解

### Devbox 顯示指令標記正在使用中

指令被中斷或系統突然關機後，可能會留下指令標記。先確認沒有其他 Devbox 指令還在執行，再移除過期標記並重試：

```bash
rm -rf ~/.devbox/locks/<marker>
```

指令標記是名為 `global` 或 `project-<hash>` 的目錄。Devbox 指令仍在執行時，請勿移除其標記。

## 贊助

如果這個套件對你有幫助，歡迎到 Patreon 贊助我。贊助者的大頭貼會顯示在我的主要專案中。

<p align="center">
  <a href="https://www.patreon.com/ycs77">
    <img src="https://cdn.jsdelivr.net/gh/ycs77/static/sponsors.svg" alt="Sponsors" />
  </a>
</p>

<a href="https://www.patreon.com/ycs77">
  <img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Become a Patron" />
</a>

## License

[MIT LICENSE](LICENSE)

[ico-version]: https://img.shields.io/npm/v/%40ycs77%2Fdevbox?style=flat-square
[ico-license]: https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square
[ico-github-action]: https://img.shields.io/github/actions/workflow/status/ycs77/devbox/ci.yml?branch=main&label=tests&style=flat-square
[ico-downloads]: https://img.shields.io/npm/dt/%40ycs77%2Fdevbox?style=flat-square
[link-npm]: https://www.npmjs.com/package/%40ycs77%2Fdevbox
[link-github-action]: https://github.com/ycs77/devbox/actions/workflows/ci.yml?query=branch%3Amain
[link-downloads]: https://www.npmjs.com/package/%40ycs77%2Fdevbox
