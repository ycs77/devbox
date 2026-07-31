# Generate Compose outside the project

Devbox manages a Sandbox and any future Services by generating an internal Compose definition in Devbox-owned user data and invoking Docker Compose. The initial release ships no Service catalog and generates Sandbox-only definitions, while retaining Compose as the lifecycle and networking foundation for later curated Services. This keeps projects free of required Docker configuration and avoids rebuilding Compose semantics around individual `docker run` calls; generated Compose is an implementation detail, not a user extension surface.
