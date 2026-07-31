# Require explicit Base updates

Global `devbox update` updates locked Runtime and Service artifacts but never changes the Base point release, revision, image digest, or profile. Base changes require `devbox update --base`, which explicitly lets the user update within the current Debian major release, such as a Trixie 13.x point/image revision, or migrate every project to a newer Devbox-supported stable Base profile, such as Debian 14 Forky; either path prepares and verifies a new Platform lock generation before atomically activating it.
