# Playbooks

Three files written to be **copied into a new repository**, so an agent working
there can reach the same standard as this one without ever seeing it. They are
deliberately repo-agnostic: nothing in them is about this app's subject matter,
only about how it is built, deployed and reviewed.

Copy the whole folder. They cross-reference each other by filename and expect
to sit side by side.

| File | Read it | What it settles |
|---|---|---|
| `GITHUB-PLAYBOOK.md` | **Before the first commit** | The repository: ignore rules and the one irreversible step, how to commit, what never to run, the Windows traps, and how a key reaches a server without a push being able to change what runs as root |
| `PLAYBOOK.md` | **Before writing any code** | The whole brief: the bar, the stack and layout, design tokens and theming, accounts for a public server, the verification ladder, data-integrity rules, guards, and the pipeline from `git init` to a live HTTPS site |
| `AI-PLAYBOOK.md` | Before writing any AI feature | The provider abstraction and why the vendor stays configuration, the mock provider that makes AI features testable without a key or a bill, the current API call shape, the four errors worth telling apart, and key handling |

## In what order

1. `GITHUB-PLAYBOOK.md` — the first commit is the only step here that cannot be
   undone, and it happens in the first five minutes.
2. `PLAYBOOK.md` top to bottom, then build in the order its "first hour" sets
   out.
3. `AI-PLAYBOOK.md` when and if an AI feature is on the list.

## How to treat them

- They describe **defaults with reasons**. Deviate where the app needs
  something else — and write down what changed and why, in the same change. A
  default you cannot justify for this app is not worth keeping.
- Nothing in them is aspirational. All of it has run in production on a small
  server.
- `PLAYBOOK.md` becomes the new app's own `CLAUDE.md`, or is pointed at by a
  short one. From then on the new repository's handbook is where its decisions
  go, not these files.
- **Model IDs, prices and version numbers date.** Check them before quoting
  them back; the tables are a snapshot of the day they were written.

## Keeping them true

The reason to keep these in the repository rather than in a gist is that they
go stale silently. When a practice here changes, change it in the playbook in
the same commit — otherwise the copy in the next repository teaches the old
way, confidently, to somebody with no way of knowing.
