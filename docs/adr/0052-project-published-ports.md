# Configure published Sandbox ports per Project

> **Status: Accepted (2026-09-10).** This ADR supersedes only ADR-0049's restriction that Local configuration contains only the Project's Selected Node Runtime.

## Decision

Local configuration adds a `ports` list. Each value is a normalized short port mapping for that Project's Sandbox: either `host:container` or `ENV_NAME:fallback-host:container`. `init` and current-Project `devbox config` edit this list through a multiline prompt. New Local configuration starts with `APP_PORT:5173:5173`; an existing Local configuration preserves its current list, including an intentionally empty list.

The Local configuration retains the mapping expression rather than a resolved host environment value. Devbox validates mapping syntax, numeric port ranges, and duplicate host ports within the same Local configuration. It does not read, validate, set, or otherwise resolve the named host environment variable. Empty input produces no `ports` field in the generated Sandbox definition.

The static Sandbox renderer converts an environment mapping such as `APP_PORT:5173:5173` to Compose interpolation `${APP_PORT:-5173}:5173`. Literal mappings pass through unchanged. This is a limited Compose-time interpolation exception for published ports; the renderer continues to publish a literal `NODE_VERSION` and has no general host-environment templating mechanism.

Devbox does not reserve or preflight host ports across Projects. Docker Compose remains responsible for reporting an actual bind conflict when Sandboxes start.

## Consequences

Local configuration and generated Sandbox definitions now capture Project-specific published network entry points. Existing Local configurations that omit `ports` remain valid and behave as an empty list. A Project can use a host environment variable at Compose invocation time without moving that environment into container `environment:` configuration.

## ADR relationships

This ADR supersedes ADR-0049 only where it limits Local configuration to the Selected Node Runtime. It preserves ADR-0049's user-owned Global and Local configuration scopes, machine-owned static Sandbox definitions, and Project-scoped configuration publication.