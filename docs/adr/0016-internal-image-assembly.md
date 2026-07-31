# Keep image assembly behind Devbox operations

Devbox exposes no public `build` command or internal-artifact targets. Commands such as `up`, Platform update, Base update, and AI Agent update call one internal Build module directly to prepare the required Workspace images; update operations pass a candidate generation to that module and activate it only after every required build and verification succeeds, keeping bundle and image composition out of the CLI interface.
