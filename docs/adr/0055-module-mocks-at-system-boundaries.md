# Prefer module mocks at initialization and configuration system boundaries

For initialization and configuration flows, Lucas prefers direct imports and `vi.mock` of terminal-interaction and host-process adapters over dependency parameters added solely for tests. This is an explicit style preference departing from the TDD skill's default DI recommendation, not a requirement to eliminate DI: `root`, `devboxHome`, `signal`, and genuine operational inputs remain appropriate parameters. All other TDD principles remain in force, including agreed public test seams, one behavioural Red → Green slice at a time for interface changes, and real internal collaborators.

Only system-boundary adapters may be mocked: terminal interaction, external processes, and filesystem failure injection with `node:fs/promises` and memfs. Publication, Project-registry, and command-lock logic remain real. Boundary arguments and whether interaction occurs may be observed when they represent user-visible behaviour, such as confirmation details or no prompt when a required lock is busy; internal call order and incidental collaborator calls are not contracts.

The main sources of unnecessary complexity are the parallel interactive/programmatic input paths and exposed publication state, not DI itself. Remove the test-only `initial*`/`next*` paths, use named interaction functions with explicit I/O options, and encapsulate raw publication state while preserving validation, configuration snapshots, semantic no-change decisions, user-owned YAML bytes, and rollback behaviour. Removing the parallel paths is a separate simplification enabled by driving tests through interaction; it does not technically require module mocking.

## Trade-off and scope

DI with a fake prompter could also remove the parallel input paths. Module mocks were chosen for Lucas's preferred direct-import style despite their dependence on import paths and their setup/reset cost in `test/project/index.test.ts` and the four tests using initialization as setup: filesystem, lifecycle, generated artifacts, and Compose smoke. Do not compensate with a generic mock framework, module-level mutable I/O state, or mocks of internal collaborators.

This records an accepted design direction, not completed implementation. Issue #41 tracks the follow-up specification and implementation gate; the completed #42 / PR #46 delivery remains historical fact. ADR-0045's command-lock and ADR-0049's configuration/publication contracts are unchanged.
