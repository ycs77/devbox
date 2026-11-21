# Prefer module mocks at initialization and configuration system boundaries

Initialization and configuration operations use direct imports of system-boundary adapters and module mocks in tests, rather than dependency parameters added solely for tests. This favors a small production interface and a single interactive configuration path while keeping publication, Project-registry, and command-lock behaviour under test.

## Interaction boundary

Only system-boundary adapters may be mocked: terminal interaction, external processes, and filesystem failure injection through `node:fs/promises` and memfs. Internal publication, registry, and lock collaborators remain real so operation tests exercise validation, coordination, and persistence together.

Named terminal functions receive explicit per-call `signal`, `input`, and `output` options; they do not share mutable module-level I/O state or require a prompter factory. CLI scope selection and removal confirmation use this boundary too, while removal keeps its narrow confirmation callback. Each operation or initialization-setup test file owns and resets its boundary mocks instead of sharing a generic mock framework.

Tests may observe boundary arguments and whether interaction occurs when these express user-visible behaviour, such as confirmation details or no prompt while a required lock is busy. Internal call order and incidental collaborator calls are not contracts. Public interface changes use behavioural Red → Green tests with real internal collaborators.

## Minimal operation interfaces

`initializeProject` and `configureLocalProject` each accept one options object containing only `root`, `devboxHome`, and `signal`; `configureGlobal` accepts only `devboxHome` and `signal`. These are genuine operational inputs, not test dependencies. Configuration answers and per-Project Node replacements come from named interaction functions and are validated against the packaged catalog before publication. Parallel programmatic `initial*` or `next*` configuration inputs and injectable catalogs are excluded so tests and users follow the same validation and cancellation path.

Initialization collects Global then Local configuration when Global configuration is absent, and only Local otherwise. An already registered Project returns before reading configuration, prompting, or publishing a definition. Global configuration is observed before the registry, and editing requires Global, registry, and all registered Project locks, including retained Missing-root registrations. All registered Projects participate in Global updates; Node replacements preserve their port mappings.

Local configuration reads only the registry, Global configuration, and the current Project's Local configuration. Invalid Local YAML in another Project must not block the current Project's operation; shared helpers must not broaden these reads into an all-Project load. Validation, error precedence, confirmation, refusal, cancellation, and lock scope remain operation contracts rather than implementation details of the terminal adapter.

## Registry ownership

Path construction, Sandbox identity and name encoding, and allocation belong to `src/project/registry.ts`. Consumers, including Workspace builds, import directly from that module rather than through Project-operation re-exports. This keeps identity and collision rules in one place without coupling noninteractive consumers to configuration operations. Interaction boundaries do not redefine registry schema or collision rules.

## Publication contract

Each operation owns a `ProjectPublication` instance that captures raw file snapshots privately at the operation's domain-read observation points, never by rereading at publish time. Operations describe desired configuration, semantic changes, and registry data; they do not manipulate `FileState`, previous bytes, or prepared writes. This keeps rollback tied to the original observation instead of a later filesystem state.

Initialization prepares its definition before confirmation; Global and Local prepare after confirmation. Publication stages every file before any rename, rolls back in reverse order on failure, and preserves the original error. Semantic equality determines whether user-owned YAML is written, preserving comments and original bytes when unchanged. Content-identical machine-owned Compose is not rewritten. Accepting an unchanged Local form still refreshes the current Sandbox definition when it is stale, without rewriting unchanged YAML or unrelated Project state. Plain-text reads needed by removal and Sandbox startup do not expose publication snapshots.

## Trade-offs

Dependency injection with a fake prompter could also provide a single interactive path; module mocking is not technically required to remove parallel configuration inputs. Direct imports are the chosen style despite import-path coupling and per-test-file mock setup/reset costs. Genuine operational inputs and narrow callbacks remain appropriate parameters: this decision does not prohibit dependency injection in general.

Encapsulating publication state limits operation-level control over filesystem mechanics in exchange for one owner of snapshot, staging, no-change, and rollback rules. Boundary mocks isolate the terminal and host without hiding these internal contracts or introducing a generic testing abstraction.
