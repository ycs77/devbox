# Writing tests

Tests protect observable behaviour. They are not a line-coverage exercise or a record of implementation details.

## Process

### 1. Read the seam

Before writing a test, read the implementation, its existing tests, the test configuration, and the repository rules that apply to the area.

Choose the smallest public interface through which a caller can observe the behaviour. Prefer one integration-style seam over tests that reach into private helpers.

**Done when:** the behaviour under test, its observable outputs, and the existing test conventions are explicit.

### 2. Choose the behaviours

Start with the normal successful behaviour. Add one or two high-value failure or boundary behaviours that protect user-visible errors, invariants, or state transitions.

Add another case only when it represents a different behaviour, precedence rule, boundary, or recovery path. Equivalent inputs that follow the same path do not need separate tests.

**Done when:** every planned test has a concrete regression it would catch.

### 3. Write meaningful assertions

Assert concrete outcomes such as returned values, thrown errors, persisted state, emitted output, status codes, or externally visible effects.

Keep each test focused on one logical behaviour. Multiple assertions are appropriate when they describe the same outcome and its required side effects.

Use concise names that describe the behaviour, such as `rejects an expired token` or `returns the cached profile`.

**Done when:** the test would fail for a plausible regression and would survive an internal refactor that preserves the behaviour.

### 4. Keep the test boundary honest

Use the real implementation for modules owned by the project. Replace only dependencies at genuine system boundaries, such as external services, clocks, randomness, or deliberately isolated filesystem and database adapters.

Do not assert private method calls, collaborator call order, incidental serialization, or a mock's own configuration. Restore spies and mocks after each test and clean every temporary resource.

**Done when:** the test observes the chosen seam rather than reconstructing the implementation behind it.

### 5. Run and review

Run the focused test file immediately, then run the applicable typecheck and full suite after the change. Use a non-watch test command in automation and agent sessions.

Review every generated or copied test as a first draft. Remove tests that only prove that code does not throw, that a value is defined, or that a mock was called. Treat coverage reports as diagnostic signals; do not add cases solely to raise a percentage.

**Done when:** the tests execute successfully, remain isolated, and each retained case has a clear behavioural reason to exist.

## Defaults

- Prefer behaviour tests over implementation tests.
- Prefer a small, high-value test set over exhaustive input enumeration.
- Test error behaviour where it is user-visible or protects an invariant.
- Use parameterized tests when several inputs genuinely share one contract.
- Use snapshots only when the complete snapshot is itself the maintained contract; otherwise assert the relevant behaviour directly.
- Keep tests deterministic, isolated, and safe to run with the full suite.
