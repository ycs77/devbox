# Defer Devbox-managed Git configuration

The initial release does not read the developer's host Git identity, prompt for `user.name` or `user.email`, create a shared Git configuration, or mount Git configuration into Sandboxes. Users may rely on repository-local configuration or configure Git themselves inside the supported Sandbox boundaries. A future CLI may manage Devbox-specific Git identity, but its storage and mounting model remain intentionally undecided; Devbox creates no placeholder configuration or Docker volume for it now.
