# Use a fixed PHP extension set initially

Each PHP Runtime bundle contains and enables one Lucas-curated extension set for that PHP release line. The initial Project and Local configuration schemas expose no `extensions` option, so users cannot add, remove, enable, or disable extensions; this avoids no-op placeholder configuration, per-project compilation, and extension-combination images while keeping shared bundles and startup predictable.
