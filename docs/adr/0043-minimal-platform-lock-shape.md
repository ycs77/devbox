# Keep the Platform lock provider-specific and minimal

The current machine-owned `platform-lock.yaml` uses one clean-cutover `version: 1` shape with top-level `platform`, `base`, and `runtimes` fields. `base` contains only the `ubuntu:24.04` image reference, resolved digest, and `apt` mapping with one official Ubuntu snapshot timestamp and the ordered curated top-level package names; `runtimes` contains only Configured Runtime families and release lines, with no placeholders.

A Node entry contains `revision`, `archive.url`, `archive.sha256`, `signedChecksums.url`, and `signedChecksums.signer`; family and release-line mappings are serialized canonically, and an empty Configured Runtime set is `runtimes: {}`. The lock contains no AI Agents, Node package managers, Services, Workspace identity, Base local image ID, recipe identity, generic artifact list, or PHP placeholder; PHP enters the current version-1 shape only when its family-owned recipe contract is decided.
