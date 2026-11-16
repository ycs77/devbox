# Product Brief

How agents consume the developer-authored briefs in `docs/brief/`.

## What a brief is

`docs/brief/` holds the developer's **intent**: the goals, product direction, and user-facing outcomes the product is intended to deliver. Briefs are written before implementation. Read the relevant brief before planning or implementing a change.

## What binds

A brief binds at the level of intent. Within each brief, separate two kinds of content:

- **Goals and direction**: what the product must achieve, for whom, and any explicit constraints on the approach. These are authoritative: every plan and change must serve them.
- **Examples, sketches, and inspirations**: sample values, command flows, named references, and "might wrap X" ideas. These illustrate the intent; read them for what they point at, not as a checklist to match literally.

## Conflicts

A conflict exists when a plan or implementation would defeat or narrow a brief goal. Differing from an example or filling in an open detail is not a conflict. Test against intent: reading the result, would the developer say the goal is still met?

- **Conflict with intent**: stop and raise it with the developer, quoting the brief sentence and the competing constraint, before overriding or working around it.
- **Open detail**: proceed with the option that best serves the brief's intent.

Brief reviews apply the same test and report only conflicts with intent.

## Editing

Files under `docs/brief/` change only with the developer's explicit permission.
