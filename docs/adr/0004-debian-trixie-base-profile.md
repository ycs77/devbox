# Use Debian 13 Trixie Slim as the initial Base profile

Devbox uses one non-user-selectable Debian 13 Trixie Slim Base profile as the shared userland ABI for its Sandbox and Runtime bundles. Trixie is the current Debian stable release with PHP and Node official-image variants and a longer remaining support window than Bookworm; limiting the first release to one versioned profile avoids multiplying Runtime bundles, while future distribution generations require a new profile and explicit bundle rebuild rather than a silent ABI change.

During first Platform bootstrap and every explicit Base update, Devbox resolves the exact upstream Debian source, installs the curated native package set once, verifies the result, and materializes it as a Devbox-owned local Base image. The Platform lock records that image's content-addressed local image ID in addition to its source provenance. Normal Runtime and Workspace preparation reuses the locked Base image without rerunning `apt`; if the active image is missing or does not match its locked ID, Devbox fails with an instruction to run `devbox update --base` rather than silently producing different content under the same Platform lock.

The curated native package set is the union required by the Base tools and every Runtime, PHP extension, and package-manager bundle supported by that Devbox release. Runtime bundles do not carry private copies of Debian shared libraries. This makes Base-only and no-Runtime Workspace images larger, but keeps dynamic linking, library security updates, and cross-Runtime reuse behind one verified Base artifact. Adding or removing a required native package changes the versioned Base recipe and takes effect only through explicit `devbox update --base`; a Runtime incompatible with the active Base fails preparation rather than mutating it.

The Base also includes the complete basic native dependency build toolchain: Debian `build-essential`, `python3`, `python-is-python3`, and `pkg-config` with their required packages. This shared layer costs approximately 342 MB uncompressed on the 2026-08-02 Trixie `linux/amd64` prototype before the negligible alias package is added, but is stored once per retained Base generation rather than once per Project. The system Python and its `python` alias are fixed Base build helpers for tools such as `node-gyp`, not a user-selected Python Runtime or an addition to the first-release Runtime catalog.

The Base's fixed practical CLI set is `ca-certificates`, `curl`, `git`, `openssh-client`, `zip`, `unzip`, `jq`, `less`, `ripgrep`, `fd-find`, `procps`, `lsof`, `iproute2`, `dnsutils`, `netcat-openbsd`, `rsync`, and `tree`. The Base adds `/usr/local/bin/fd` as a symlink to Debian's `/usr/bin/fdfind`, retaining both command names. These tools support Agent installation, source retrieval, archive handling, repository work, search, and Sandbox diagnostics; their resolved Debian revisions are captured by the materialized Base image ID rather than separate Platform-lock entries. `openssh-client` supplies client capability only and does not expose host SSH identity or weaken the no-host-SSH boundary.

The Base installs `tzdata` and fixes the Sandbox system timezone and `TZ` environment to `Asia/Taipei`. It sets `LANG=C.UTF-8` without installing or generating a larger locale archive and leaves `LC_ALL` unset so individual processes may deliberately override locale categories. Devbox does not detect, bind-mount, or inherit the host timezone or locale; changing either opinionated default is a Base-recipe change applied through explicit Base update.

## Base materialization evidence

On 2026-08-02, a disposable integrated prototype on WSL2 `linux/amd64` materialized `debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd` as a Base with local image ID `sha256:6ea212f6eb24f351a0bcbc556476844d58d401279423780a953fb20144b7ac3c`. Its derived stable tag resolved to that exact ID, and Base-only, Node-only, PHP-only, and combined Workspace images reused the same 12 Base layers. The accepted tools, build helpers, `fd` symlink, timezone, locale, unset `LC_ALL`, lack of `sudo`, and non-writable package-manager state all passed verification. The host-matched bootstrap also required `passwd` and `util-linux`'s `setpriv` as internal implementation dependencies rather than user-facing tool choices.

For the exercised PHP 8.4.24 and Node 22.23.2 inputs, the Runtime-linked Debian package-owner union was:

```text
libargon2-1:amd64 libbrotli1:amd64 libbz2-1.0:amd64 libc6:amd64
libcom-err2:amd64 libcurl4t64:amd64 libffi8:amd64 libfreetype6:amd64
libgcc-s1:amd64 libgmp10:amd64 libgnutls30t64:amd64 libgssapi-krb5-2:amd64
libhogweed6t64:amd64 libicu76:amd64 libidn2-0:amd64 libjpeg62-turbo:amd64
libk5crypto3:amd64 libkeyutils1:amd64 libkrb5-3:amd64 libkrb5support0:amd64
libldap2:amd64 liblzma5:amd64 libnettle8t64:amd64 libnghttp2-14:amd64
libnghttp3-9:amd64 libonig5:amd64 libp11-kit0:amd64 libpng16-16t64:amd64
libpq5:amd64 libpsl5t64:amd64 libreadline8t64:amd64 librtmp1:amd64
libsasl2-2:amd64 libsharpyuv0:amd64 libsodium23:amd64 libsqlite3-0:amd64
libssh2-1t64:amd64 libssl3t64:amd64 libstdc++6:amd64 libtasn1-6:amd64
libtinfo6:amd64 libunistring5:amd64 libwebp7:amd64 libxml2:amd64
libzip5:amd64 libzstd1:amd64 zlib1g:amd64
```

Node independently required only `libc6`, `libgcc-s1`, and `libstdc++6`, already present in that union, and added no apt Build packages. PHP Build resolved actual provider packages rather than retaining virtual request names; observed development providers included `libc6-dev`, `libfreetype-dev`, `libicu-dev`, `libjpeg62-turbo-dev`, `libpng-dev`, `libpq-dev`, `libsqlite3-dev`, `libwebp-dev`, and `libzip-dev`. This observed closure is evidence for those exact inputs, not a substitute for resolving and recording the exact package manifest during each Base materialization.
