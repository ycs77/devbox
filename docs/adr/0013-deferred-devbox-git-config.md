# Defer Devbox-managed Git configuration

Devbox does not read the developer's host Git identity, prompt for `user.name` or `user.email`, or mount host Git configuration into Sandboxes. The Workspace image does include Devbox-owned non-identity Git defaults from its packaged `.gitconfig`; users may override them with repository-local configuration or configure their own identity inside the Sandbox. Devbox creates no shared host Git configuration or Docker volume for Git state.
