# Use Debian 13 Trixie Slim as the initial Base profile

Devbox uses one non-user-selectable Debian 13 Trixie Slim Base profile as the shared userland ABI for its Sandbox and Runtime bundles. Trixie is the current Debian stable release with PHP and Node official-image variants and a longer remaining support window than Bookworm; limiting the first release to one versioned profile avoids multiplying Runtime bundles, while future distribution generations require a new profile and explicit bundle rebuild rather than a silent ABI change.
