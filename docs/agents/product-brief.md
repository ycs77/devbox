# Product Brief

How agents consume the developer-authored briefs in `docs/brief/`.

## What a brief is

`docs/brief/` holds the developer's **intent**: the goals, product direction, and user-facing outcomes Devbox exists to deliver. Briefs are written before implementation. Read the relevant brief before planning or implementing a change.

## What binds

A brief binds at the level of intent. Within each brief, separate two kinds of content:

- **Goals and direction**: what the product must achieve, for whom, and the shape of the approach it commits to, such as configuration living under the user's home or no Devbox files in the Project repository. These are authoritative: every plan, ADR, and change must serve them.
- **Examples, sketches, and inspirations**: sample values, command flows, named references, and "might wrap X" ideas. These illustrate the intent; read them for what they point at, not as a checklist to match literally.

Details the brief leaves open, such as schemas, command semantics, validation rules, and constraints discovered while building, are settled in `GLOSSARY.md`, `docs/adr/`, and the code. Choose the option that best serves the brief's intent, and record lasting decisions in an ADR.

## Conflicts

A conflict exists when a plan, ADR, or the code would defeat or narrow a brief goal. Differing from an example or filling in an open detail is not a conflict. Test against intent: reading the result, would the developer say the goal is still met?

- **Conflict with intent**: stop and raise it with the developer, quoting the brief sentence and the competing constraint, before overriding or working around it.
- **Open detail**: proceed, and record any lasting decision in an ADR.

Brief reviews apply the same test and report only conflicts with intent.

## Editing

Files under `docs/brief/` change only with the developer's explicit permission.
