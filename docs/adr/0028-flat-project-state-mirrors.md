# Flatten Project-state mirror directories

ADR-0021 continues to define `~/.devbox` as the user-scope data root, but this ADR supersedes its nested Project-root mirror encoding. Each absolute Project root maps to one direct child of `~/.devbox/projects/`: remove the leading path separator and replace every remaining path separator with `-`, so `/home/lucas/work/example` stores state in `~/.devbox/projects/home-lucas-work-example/`. The filesystem root has no remaining path segments, so it uses the `root` child.

This deliberately favors a shallow, manageable directory layout over collision resistance; distinct roots that encode to the same name share that Project mirror, and Devbox preserves its existing state rather than detecting or resolving the collision. The filesystem root and `/root` are one such accepted collision.
