# Support Linux, WSL2, and macOS hosts initially

The initial Devbox release supports Linux, WSL2, and macOS with Docker Engine or Docker Desktop plus Docker Compose available; Windows users run Devbox inside WSL2 rather than as a native Windows CLI. This keeps the host interface Unix-like while still requiring platform-specific handling and verification for Docker Desktop networking, filesystem performance, ownership, and user-data paths on macOS and WSL2.
