# Flatten Project-state mirror directories

ADR-0042 supersedes only this decision's collision behavior: Project state remains in a path-derived flat mirror, but the Project registry assigns colliding roots distinct `-2`, `-3`, and later suffixes instead of sharing state.

ADR-0021 continues to define `~/.devbox` as the user-scope data root, but this ADR supersedes its nested Project-root mirror encoding. Each absolute Project root maps to one direct child of `~/.devbox/projects/`: remove the leading path separator and replace every remaining path separator with `-`, so `/home/lucas/work/example` stores state in `~/.devbox/projects/home-lucas-work-example/`. The filesystem root has no remaining path segments, so it uses the `root` child.

This deliberately favors shallow, human-locatable state directories. If the unsuffixed path-derived name is already assigned or exists on disk, the Project registry assigns the first safe `-2`, `-3`, or later suffix; distinct Project roots never share Local configuration or retained Compose.
