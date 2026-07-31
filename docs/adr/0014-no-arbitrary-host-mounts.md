# Do not support arbitrary host mounts initially

The initial Devbox release mounts the writable Project workspace and only currently supported Devbox-managed capabilities such as the shared Agent home; users cannot add arbitrary host bind mounts through Local configuration. This keeps the Sandbox host boundary predictable and avoids exposing host data or adding path, permission, and cross-platform complexity before a concrete capability requires it.
