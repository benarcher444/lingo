# Lingo

A personal language-learning web app: build a vocabulary, get tested on it,
listen to it, talk to a tutor about it, and watch how much of it is actually
holding.

Runs locally, or on a small server behind a domain — see [DEPLOY.md](DEPLOY.md).

<https://github.com/benarcher444/lingo>

---

## Quick start

```bash
npm install
cp env.example .env      # optional — sensible defaults without it
npm run dev              # http://localhost:3000
```

Sign-up is by invitation. Create `allowed_emails.csv` with an `email,ai` header
line and `your@address,yes` beneath it (the `ai` column says who may use the
AI tutor), then register at
`/register` and add your first language. A starter set of categories (nouns,
verbs, adjectives, …) is created with it.

To poke around with realistic data instead:

```bash
npm run seed             # demo@lingo.local / demopassword
```

That also creates `empty@lingo.local` (same password) with a language but no
words, for looking at the empty states.

---

## What it does

**Vocabulary** — add and edit words in the browser, grouped into categories you
define. The banner at the top of the page shows what percentage of each category
is learnt, and tints the thin ones, so it is obvious where new words are worth
adding.

Adding is keyboard-driven: pick the category once, then
`word` → <kbd>Tab</kbd> → `translation` → <kbd>Enter</kbd>, repeatedly, with no
page reload.

Editing happens in place: Edit, change it, <kbd>Enter</kbd> to save or
<kbd>Esc</kbd> to cancel, and the list stays where it was. A word already in the
language can't be added twice, whatever its case, spacing or category, and the
message points to the entry you already have.

**Accents without changing keyboard layout.** Type the plain letter then the
accent key:

| Type | Get | | Type | Get |
|---|---|---|---|---|
| `e` `'` | é | | `c` `,` | ç |
| `e` `` ` `` | è | | `n` `~` | ñ |
| `e` `^` | ê | | `o` `e` | œ |
| `i` `"` | ï | | `o` `/` | ø |

Press the accent key twice to keep it literal (`e''` gives `e'`). Only letters
the language actually uses are converted, so French `qu'est` and `d'abord` are
left alone — `ú` is not a French letter. There is also a clickable bar of the
language's accents under the field, with <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd>
for the common ones.

**Written practice** — each word is tested in both directions and keeps coming
back until you get both right. Answers are matched case- and accent-insensitively
(`etre` is accepted for `être`), and a hyphen can be typed as a space or left out
(`grand mother` or `grandmother` for `grand-mother`). When you were right and the
checker disagreed, "I was right — count it" turns that miss into a correct
answer. Leave the page mid-session and it picks up where you were.

**Listening practice** — the word is spoken in the target language and you type
what it *means* in English, so it tests comprehension rather than spelling back
what you just heard. Type `r` then <kbd>Enter</kbd> to hear it again, or just `r`
once you've answered. Speech uses the browser's own voices, so there is no audio
to download or cache. But voices vary by browser, and Chrome's French and
Spanish ones are synthesised online, so they need a connection. Spanish is read
with a Latin American accent wherever the device has one.

**Conversation** — pick general conversation, a scene (restaurant, hotel, train
station…), "Surprise me", or describe your own, and a level from A1 to C1. The
tutor opens in the language you are learning and keeps the conversation moving.
What you write is corrected first, then answered. Each reply is spoken before
its words appear, and they show once you have answered, so every turn is
listening practice too. There are replay and slow buttons, and "Show text" if
you're stuck. Ask the teacher about any message for an English
breakdown, then keep asking follow-ups. Only accounts marked `yes` in the `ai`
column of `allowed_emails.csv` can use it, because every message costs money.

Which AI answers is configuration, not code. In `.env`:

```ini
AI_PROVIDER=anthropic         # anthropic | openai | none
ANTHROPIC_API_KEY=sk-ant-...  # or OPENAI_API_KEY for openai
AI_MODEL=claude-sonnet-5      # optional; overrides the provider default
```

Defaults are `claude-opus-5` for Anthropic and `gpt-4o-mini` for OpenAI. Sonnet
costs far less than Opus and is plenty for a tutor. Leave `AI_PROVIDER` unset and
it uses whichever key is present, preferring Anthropic. The key is **API**
billing, separate from any Claude or ChatGPT subscription. Create one at
console.anthropic.com (or platform.openai.com).
Run `npm run ai:check` to confirm it works before relying on it. Without a
provider the page says so and everything else still works.

**Progress** — the chart leads: pick any recorded measure (it opens on words
learnt; also percentage learnt, words solid, average accuracy, longest neglect…)
and choose which categories to plot. Below it are three more views:

- today's practice, per mode
- where every word currently stands: solid, learnt, learning and untouched, four
  bands that add up to the whole vocabulary
- answers per day over the last month, with written and listening stacked

**Settings** — your account, your languages (switch, or create a new one), and
the theme: Auto (follow the device), Light or Dark. The theme is saved to your
account, so it holds on every device. On a phone, Settings is a tab in the
bottom bar.

Clicking a word on the vocabulary page opens its full record: times tested,
correct and wrong per direction, accuracy, streak, when it was last seen, an
itemised breakdown of how its score is composed, and its score replayed over
time from every answer ever given.

---

## The scoring algorithm

Every word carries one score per mode:

```
score = accuracy + volume + streak − neglect
```

- **accuracy** — percentage right, per direction
- **volume** — a word answered right ten times outranks one answered right twice
- **streak** — a 0.5 bonus at three correct in a row, lost entirely on one miss
- **neglect** — subtracts ~0.01 per day since the word was last tested

Above **2.3** a word counts as learnt; above **2.556**, solid.

The neglect term is why this is worth having: scores decay, so words drift back
below the line if you ignore them, and the completion percentage stays honest
instead of only ever going up. Score is derived on every read rather than stored,
so it can never go stale as the calendar moves.

Word selection weights by `floor(50 · e^(−2(score − 0.6)))` — a learnt word is
about 50× less likely to come up than an unseen one, but never impossible.

Carried over from the original Python app; `npm test` covers it.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with reload on `http://localhost:3000` |
| `npm start` | Run without watching (what the server runs, under systemd) |
| `npm test` | Scoring, matching and sampling checks, and which voice speaks |
| `npm run typecheck` | TypeScript, no emit |
| `npm run seed` | Demo account with vocabulary and history (`--reset` to wipe) |
| `npm run shot` | Screenshot every page, both widths, both themes |
| `npm run audit:mobile` | Check touch targets, iOS input zoom, overflow |
| `npm run test:entry` | Drive the keyboard word-entry flow |
| `npm run test:accents` | Accent composition rules |
| `npm run test:accents:browser` | Accent typing in a real browser |
| `npm run test:search` | Vocabulary search and category filter |
| `npm run test:session` | Session size, skip-on-empty, `y` override |
| `npm run test:override` | "I was right" counts a miss as right, once |
| `npm run test:listening` | Speech warm-up, and `r` to replay |
| `npm run test:vocab-edit` | Editing words in place |
| `npm run test:duplicates` | A word can't be added twice |
| `npm run test:auth` | Invitation-only sign-up, lockout, secure cookie |
| `npm run test:theme` | Theme saved per account; the phone's Settings tab |
| `npm run test:daily` | Counting a day's practice by session |
| `npm run test:all` | Every suite in sequence |
| `npm run seed:clean` | Remove seeded demo accounts, keep your own |
| `npm run test:ai` | Check AI_PROVIDER / AI_MODEL resolve correctly |
| `npm run ai:check` | Send one real message to the configured provider |
| `npm run reset:users` | Delete all accounts and their data (`--yes` to confirm) |
| `npm run set-password` | Set a new password for an account (run bare to list them) |
| `npm run unlock` | Unlock an account after 5 wrong passwords (run bare to list them) |
| `npm run backup` | Consistent copy of the database into `data/backups/` |
| `npm run db:generate` | Generate a migration after changing the schema |
| `npm run db:studio` | Browse the database |

### Screenshots

`npm run shot` writes to `screenshots/` and flags any page with console errors or
horizontal overflow.

```bash
npm run shot -- --only=vocab     # pages matching a key
npm run shot -- --light          # skip the dark pass
npm run shot -- --desktop        # skip the mobile pass
npm run shot -- --viewport       # visible area only — for checking fixed chrome
```

Use `--viewport` when reviewing the mobile nav bar: a `fullPage` capture renders
`position: fixed` elements at their scroll offset, which makes the bar look like
it is floating mid-page when it is not.

`scripts/diagnose-overflow.ts` names the specific elements pushing a page wider
than the viewport:

```bash
MSYS_NO_PATHCONV=1 npx tsx scripts/diagnose-overflow.ts /vocab 390
```

---

## How it is put together

```
src/
  algorithm.ts       Scoring, decay, selection weighting, answer matching
  practice.ts        Session building and answer recording
  stats.ts           Scoring words in bulk, summaries, history snapshots
  auth.ts            Argon2 password hashing, session cookies
  context.ts         Signed-in user and selected language per request
  env.ts             Loads .env before anything else reads it
  allowlist.ts       Who may sign up (allowed_emails.csv)
  rate-limit.ts      Per-address limit on sign-in and sign-up
  db/
    schema.ts        Drizzle schema
    index.ts         SQLite connection (WAL)
    migrate.ts       Migrations, applied at startup
  routes/            auth, vocab, practice, chat, progress
  views/             HTML templates, chart SVG, shared components
public/              Stylesheet and browser JS — no build step
scripts/             seed, screenshot, tests, diagnostics
drizzle/             Generated migrations
deploy/              systemd units, Caddyfile, deploy script (see DEPLOY.md)
.github/workflows/   Checks, then a deploy, on every push to main
```

Server-rendered HTML with small vanilla-JS modules for the quiz and chat. No
bundler, no framework, nothing to compile at runtime, which keeps a small
server simple to run.

**Storage** is SQLite via Drizzle. The schema is written so a move to Postgres
for a hosted deployment is a driver change rather than a rewrite; every table
hangs off `user_id`, so multi-user is structural rather than retrofitted.

**Data model** — languages and categories are rows, not folders, so adding a
language is an insert. `progress` holds one row per word/mode/direction;
`attempts` holds one row per answer, so the scoring formula can be retuned
against real history later. `stat_snapshots` is append-only.

---

## Using it on your phone

The hosted site works on a phone from anywhere (see DEPLOY.md).

The local development server binds to every interface, so any device on the same
Wi-Fi can reach it too. Its startup log prints the address:

```
On this machine:  http://localhost:3000
On your phone:    http://192.168.0.6:3000   (same Wi-Fi)
```

Use that second one. `0.0.0.0` is the bind address, not somewhere you can
browse to. The IP changes when you join a different network, which is why the
server reports it rather than the README hard-coding one.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)**: a Hetzner server, Caddy for HTTPS, systemd, and
nightly backups. Migrations run at startup, so an update is pull, install,
restart — `deploy/deploy.sh` does all three.

**Back up `data/app.db`** — `npm run backup` takes a consistent copy. It is the
vocabulary and the entire learning history, and it is gitignored deliberately.

### Locked out

Passwords are argon2id hashes and cannot be read back, so there is no recovery —
only replacement:

```bash
npm run set-password                                    # list accounts
npm run set-password -- you@example.com newpassword123
```

Existing sessions are signed out; vocabulary and progress are untouched.

Five wrong passwords in a row lock an account until it is unlocked. Setting a
new password, as above, also unlocks it.

```bash
npm run unlock                        # list locked accounts
npm run unlock -- you@example.com
```

### Resetting

`npm run reset:users` lists what it would delete and stops. Add `--yes` to go
ahead; it writes a timestamped `.backup-…` copy of the database alongside it
first, because everything cascades from `users` and is otherwise unrecoverable.

---

## Notes

- `old_code_repo/` is the original Python terminal app, kept for reference only.
  Nothing imports from it.
- Never commit `.env`. The old repo has a plaintext OpenAI key in `config.yaml`
  and `.env` that was pushed to GitHub — that key should be rotated.
