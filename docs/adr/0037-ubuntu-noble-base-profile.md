# Use Ubuntu 24.04 LTS as the Base profile

Devbox replaces Debian 13 Trixie Slim with one non-user-selectable Ubuntu 24.04 LTS Base profile, built from a digest-pinned `ubuntu:24.04` source. Devbox is Lucas's opinionated personal development environment; his greater familiarity with and regular use of Ubuntu outweigh retaining the existing Trixie-specific prototype evidence. This is a product preference, not a claim that Ubuntu provides broader official multi-version Runtime packages.

The Platform lock uses `ubuntu:24.04` itself as the Base profile identifier and separately pins the resolved source digest. Devbox stores no additional Base ABI generation, recipe version, or recipe hash; packaged recipe changes within the Noble profile may therefore change a later Build from the same Platform lock, while a future Ubuntu profile changes the identifier and requires `update`.

The Base profile remains the shared versioned userland ABI for every Runtime recipe and Workspace. ADR-0004's curated CLI, build-toolchain, timezone, locale, non-root, and no-host-identity intentions remain, but the Ubuntu implementation must establish new exact Base and Runtime package plans plus PHP-extension, shared-library, architecture, layer, and executable evidence; no Trixie package revision, provider, ABI closure, size, digest, or prototype result carries forward. ADR-0035's inline Base stages and ADR-0036's family-owned Runtime recipes remain in force.

Ubuntu 24.04's official archive supplies only its release PHP line and does not solve multi-version PHP. This decision therefore does not select a PHP installation source, accept a third-party repository, or describe one as Ubuntu support; those remain Runtime-recipe decisions with their own trust and lifecycle trade-offs. When PHP implementation begins, Devbox should evaluate Ondřej Surý's PPA and `packages.sury.org` as preferred third-party package-source candidates alongside an official-source build, without treating that interest as prior acceptance.

This supersedes ADR-0004's Debian 13 Trixie Slim profile choice and all Trixie-specific compatibility and materialization evidence.
