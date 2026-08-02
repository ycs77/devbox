# Use a fixed PHP extension set initially

Each PHP Runtime bundle contains and enables one Lucas-curated, Laravel-oriented extension set for that PHP release line. The initial Project and Local configuration schemas expose no `extensions` option, so users cannot add, remove, enable, or disable extensions; this favors a ready-to-use Laravel development experience over the smallest possible Runtime bundle, avoids per-project compilation and extension-combination images, and keeps shared bundles and startup predictable.

The set includes PDO drivers for MySQL, PostgreSQL, and SQLite so the same PHP Runtime bundle can run the three common Laravel database configurations without per-project Runtime variants.

The set includes PhpRedis for Laravel cache, queue, and session use, but does not include the Memcached extension.

Beyond Laravel's minimum PHP requirements, the set includes `bcmath`, `intl`, `pcntl`, `zip`, and OPcache for common application packages, localization, queue workers, archive handling, and execution caching.

The set includes GD and EXIF for common Laravel image upload and transformation workflows, but excludes Imagick and its heavier native dependency and security-update surface.

The first release excludes Xdebug rather than shipping a permanently enabled debugger or an installed-but-unreachable toggle; debugger configuration requires a future concrete interface.

The set includes `sockets` alongside `pcntl` for Laravel Reverb, long-running workers, and packages that require low-level network access.

The first release excludes the project-specific SOAP, LDAP, and IMAP extensions until a concrete supported workflow requires their native dependencies and maintenance surface.

If any required extension cannot be built and enabled for a selected open PHP release line, preparation fails as an incompatible Runtime without omitting the extension, falling back to another extension revision, or publishing a Workspace stable tag.

PhpRedis's exact revision and immutable PECL archive digest are part of the applicable PHP entry in the Platform lock rather than mutable build-time input or a Devbox package-only version. Resolution independently selects the newest stable PhpRedis 6.x release compatible with each exact PHP revision; Devbox derives the official PECL source location from that selected revision.
