# Adopt CAC as the CLI parser

Devbox adopts `cac` as the CLI parser, superseding only the Citty selection and CAC exclusion in ADR-0025. The current implementation uses CAC because it is more familiar to the maintainer and its generated help better matches the intended CLI.

CAC owns generated help for bare `devbox`, root `--help` and `-h`, and `devbox init --help` and `-h`. Parser usage failures are not translated into a Devbox `Result`: the outermost CLI boundary catches CAC's `CACError`, writes its message unchanged to stderr, and exits with usage status `2` as defined by ADR-0023. The Devbox presenter continues to own operation results and errors, normal operation output, cancellation, and non-parser exit statuses.

This decision knowingly accepts CAC's unresolved prototype-pollution path: crafted ordinary CLI option names can modify `Object.prototype` in both `cac@6.7.14` and `cac@7.0.0`, the current npm `latest` release, and no fixed upstream release or formal advisory is known as of 2026-08-11. The risk is accepted as a trade-off rather than treated as fixed or irrelevant.
