# Language Learning — Project Guide

## What this repo is

A rebuild of a personal language-learning tool. The original was a Python
terminal app (`old_code_repo/`, formerly `learning_spanish` — the name is a
misnomer, the real dataset is French). The new build is a **web app**,
hosted on a Hetzner server (see "The live server") and developed on the
laptop.

`old_code_repo/` is **reference only**. It is frozen, its git history removed,
and nothing new should be written into it. Its value is the data model, the
scoring algorithm, and the vocabulary/statistics CSVs.

---

## Part 1 — How the old app worked

### Entry point

`old_code_repo/main.py` → `MainOrchestrator`. A REPL loop:

1. Pick a language (folder names under `data/`) — `french` or `spanish`.
2. Pick a mode from `config.yaml`: `word_testing`, `audio_testing`, `ai_chat`,
   `ai_roleplay`.
3. Instantiate the mode class, call `.run()`. `q` at any prompt raises
   `QuitInput` and unwinds to the top.

### Directory / data layout

```
data/<language>/<word_type>.csv        # the vocabulary (source of truth)
completion/<language>/<mode_folder>/<mode_folder>_<word_type>.csv
                                       # per-word learning state, derived
data_backup/<language>/...             # stale hand-made snapshots
statistics/statistics.csv              # long-format history, written mode
statistics/statistics_audio.csv        # long-format history, audio mode
audio_files/<sha1[:10]>.mp3            # gTTS cache
5000_wordlist_french.csv               # raw import source, not used at runtime
```

`mode_folders` maps `word_testing → written` and `audio_testing → audio`, which
is why completion files are named `written_nouns.csv` / `audio_nouns.csv`.

### CSV schemas

**Vocabulary — `data/french/nouns.csv`** (french: 9 files, 2,531 words;
spanish: 9 files, 248 words — counting rows that carry a term)

| col | meaning |
|---|---|
| `index` | integer id, **unique within the word_type file only** — not globally |
| `french` / `spanish` | the target-language term, usually with its article (`la femme`) |
| `english` | the translation (`the woman`) |
| `audio` | `y` = eligible for audio testing. French only; Spanish files lack this column |

Word types (= filenames): `nouns`, `verbs_infinitive`, `conjugations`,
`adjectives`, `adverbs`, `prepositions`, `conjunctives`, `phrases`,
`nadj` (french, noun-adjectives), `others` (spanish).

**Completion, written — `completion/french/written/written_nouns.csv`**

`index, french, english, word_type, to_english_tested, to_english_correct,
from_english_tested, from_english_correct, last_tested, to_english_accuracy,
from_english_accuracy, to_english_latest_accuracy, from_english_latest_accuracy,
score`

Two independent directions per word. `*_latest_accuracy` is a streak counter
clamped to 0–3: +1 on a correct answer, reset to 0 on a miss. `last_tested` is
`YYYY-MM-DD`.

**Completion, audio — `completion/french/audio/audio_nouns.csv`**

`index, french, english, word_type, tested, correct, accuracy, last_tested,
latest_accuracy, score` — same idea, one direction (hear it, type it).

**Statistics — `statistics/statistics.csv`** (~25.7k rows, 2025-01-23 →
2025-11-08) and `statistics_audio.csv` (~1.6k rows, 2025-10-16 → 2025-11-08).

Long format: `language, word_type, date, measure, value`. `date` is a
`YYYY-MM-DD HH:MM:SS` timestamp. `word_type` includes the pseudo-type `all`.
Measures: `total_words`, `average_score`, `average_accuracy` /
`average_to_english_accuracy` / `average_from_english_accuracy`, `words_learnt`,
`words_completely_learnt`, `percentage_learnt`,
`percentage_completely_learnt`, `new_words`, `highest_days_since_last_tested`.

A row is appended **every time a completion table is built** (i.e. at the start
of every session, before any answers), then deduped and re-sorted. So the series
is "state at session start", not "state after studying".

### The scoring algorithm (`old_code_repo/algorithm.py`)

This is the interesting part and should carry over essentially unchanged.

Every word gets a single `score`, recomputed from scratch on every read and
after every answer. Three additive components:

**Written mode**
```
accuracy_part = to_acc/100 + from_acc/100 + to_correct/20 + from_correct/20
neglect_part  = (last_tested - today).days / 100          # NEGATIVE, ≈ -0.01/day
streak_part   = 0.5 if to_latest == 3 and from_latest == 3 else 0
score         = round(accuracy_part + neglect_part + streak_part, 4)
```

**Audio mode**
```
accuracy_part = accuracy*2/100 + correct/10
neglect_part  = (last_tested - today).days / 100
streak_part   = 0.5 if latest_accuracy == 3 else 0
```

Key properties, worth preserving:

- **Scores decay.** `neglect_part` is negative and grows with time since the
  last test, so a word drifts back below the "learnt" line if left alone. This
  is what makes the completion percentage a live number rather than a ratchet.
- **Volume matters as well as accuracy.** `correct/20` (or `/10`) means a word
  answered right 10 times outscores one answered right twice, even at equal
  accuracy.
- **The streak bonus is a cliff.** 0.5 arrives all at once at a 3-in-a-row
  streak, and vanishes entirely on a single miss.

**Thresholds** (hard-coded, used in `save_statistics.py` and both testers):
- `score > 2.3` → **learnt**
- `score > 2.556` → **completely learnt**

### Word selection (`old_code_repo/fetch_data.py`)

`filter_to_word_count` does weighted sampling without replacement:

```
odds = floor(50 * exp(-2 * max(0, score - 0.6)))
```

Flat 50 for anything at or below 0.6, then exponential decay. At score 2.3 the
weight is 1 — a learnt word is ~50× less likely to be drawn than an unseen one,
but never impossible. Selection walks a cumulative-odds column with a random
integer until `word_count` distinct words are picked. Passing `0` (blank input)
means "all words".

### Session flow, written mode (`old_code_repo/word_testing.py`)

1. Build/refresh completion tables from vocab (`create_completion_table`), which
   left-joins vocab → completion so new vocab rows appear with zeroed counters,
   and writes a statistics snapshot.
2. Sample `word_count` words. Add `to_english_finished` / `from_english_finished`
   flags, both `False`.
3. Loop until every word is finished **in both directions**: sample one unfinished
   word, pick a direction (random if both open, else the open one), prompt.
4. Answer compared case-insensitively against a **de-accented** target
   (`shared_testing_functions.deaccent`) so `etre` matches `être`. On a miss the
   answer is shown and the user can type `y` to override to correct.
5. A correct answer sets that direction's `finished` flag — so each word is asked
   until it is right in both directions. `tested` increments either way.
6. Recompute all scores, reprint average score / remaining / completion %.
7. On exit, print a before/after diff table (`score_change`, `learnt_now`,
   `c_learnt_now`) and write the completion CSVs back.

Audio mode is the same shape with one direction: gTTS speaks the word (`r` to
repeat, `s` to repeat slowly), the user types what they heard.

### AI modes

`ai_interface.py` wraps the OpenAI API with three system roles used per turn:

- **interpreter** (temperature 0) — silently repairs the user's broken sentence
  into correct target-language text.
- **response** — a conversational partner that stays in-language, holding the
  full message history.
- **teacher** — on-demand English breakdown of a sentence (translation, grammar,
  cultural notes, pronunciation) as its own sub-loop.

`ai_chat` is free conversation; `ai_roleplay` seeds it with "invent an everyday
situation and start". Replies are spoken via gTTS. Learner level is hard-coded
to `A1`.

### Text-to-speech (`old_code_repo/tts.py`)

gTTS + pygame. Filename is `sha1(f"{text}_{slow}")[:10]`, cached in
`audio_files/` (266 files present). Language codes: `french → fr`,
`spanish → es`.

### Known breakage in the old code

Do not treat the old repo as a working reference — it was mid-refactor:

1. `fetch_data.py:73` filters `vocab_df['written'] == 'y'`, but no vocab CSV has
   a `written` column. Word testing raises `KeyError` as it stands. The intent
   was clearly an opt-in flag mirroring `audio`.
2. `audio_testing.get_setup` expects `discrete_input_checker` /
   `number_input_checker` to return dicts (`{'continue': ..., 'text': ...}`),
   but `input_testing.py` returns bare strings. Audio mode raises `TypeError`.
   Two different input-API generations, half-migrated.
3. `fetch_data.py` has `raise "Mode Not Programmed"` — raising a `str` is itself
   a `TypeError`.
4. `algorithm.days_different_wrapper` returns `10000` (→ `+100` score) when
   `last_tested == 0`. Masked in practice because `last_tested` is filled with
   today's date, but it is a live landmine.
5. Spanish vocab has no `audio` column, so audio mode can only work for French.
6. `index` is only unique per word-type file, so any cross-type join must key on
   `(word_type, index)`. The old merges do this; a naive rewrite would not.
7. **Secrets are committed**: `config.yaml` carries a plaintext `chatgpt_key`
   and `.env` an `OPENAI_API_KEY`. Both are in `old_code_repo/`. These must not
   be carried into the new repo, and the keys should be rotated.

`old_code_repo/statistics.ipynb` is a small seaborn/matplotlib scratchpad for
plotting one measure over time — the seed of what the new dashboard should do.

---

## Part 2 — The new build

A server-rendered TypeScript web app on Node + Fastify, SQLite via Drizzle,
plain CSS and vanilla JS. No bundler and no build step at runtime — deliberate,
because it has to run on a Raspberry Pi.

`README.md` covers how to run it. This section is the reasoning behind the
shape, and the traps that cost time.

Repo: <https://github.com/benarcher444/lingo>

### Decisions and why

**SQLite, not CSVs.** CSVs were fine for a single blocking terminal loop. With
login, a web server and concurrent requests they break: read-modify-write races
silently lose data, password hashes would sit in a text file, and rewriting a
25k-row file per answer is real SD-card wear. SQLite is one file, no server
process, and *less* code — no hand-rolled locking or joins.

**Drizzle as the ORM.** The schema is TypeScript, so swapping SQLite for
Postgres when this becomes multi-tenant is a driver change, not a rewrite. Not
Prisma: its query engine ships as a native binary that has been a recurring
problem on ARM, and the Pi is ARM.

**Score is derived, never stored.** Score depends on today's date via the
neglect term, so a stored value is stale the next morning. `loadScoredWords`
pulls a language's words in one query and scores them in TypeScript — under a
millisecond at a few thousand words, and it removes a whole class of staleness
bug. It also means score cannot be an `ORDER BY`; the vocabulary list sorts by
score in memory over the filtered set.

**The AI provider is configuration, not a code decision.** `src/ai.ts` exposes
one `complete()` interface; OpenAI and Anthropic are implementations behind it,
chosen by `AI_PROVIDER`. With it unset, Anthropic is preferred — the owner asked
for that on 2026-09-10; before, it was OpenAI, as the original app used. Early
on I hard-coded Anthropic without asking, which was the wrong call: the
abstraction exists so the choice stays the user's. Every key is **API billing,
separate from any subscription** — a Claude Pro or ChatGPT Plus plan does not
include API access, which surprised the owner, so say it plainly when it comes
up. A third provider is a new
class, not a change to the tutor pipeline.

**Browser speech synthesis, not gTTS.** No cache directory, no dependency, no
service of our own. The trade is that voices vary by browser — and "works
offline" only holds where a voice is installed on the device. In Chrome on the
Windows laptop the only French and Spanish voices are Google's, synthesised
over the network. Check what the Pi's browser offers before relying on it
offline.

**Email + password with a session cookie, argon2id.** No third-party identity
provider: works offline, no dependency. Every table hangs off `user_id`, so
OAuth later is additive. Passwords cannot be recovered, only replaced —
`scripts/set-password.ts` exists because being locked out of a local install
otherwise has no remedy.

**Sign-in hardened for a public server.** The GitHub repo is public and the app
is meant to be reachable from anywhere, so:

- **Sign-up by invitation.** `allowed_emails.csv` at the root: an `email,ai`
  header, then one address per line. It is read on every request, so edits
  apply without a restart, and it fails closed when missing. The **`ai`
  column** (`yes`/`no`) says who may use Conversation, which costs money: the
  chat page and every chat request check it. It is **gitignored** — the repo is public and these are people's
  addresses. There is deliberately no template file. Only sign-up checks
  it, not sign-in, so the seeded demo accounts still work for tests.
- **Five wrong passwords lock the account** (`users.failed_logins`,
  `users.locked_at`), and it stays locked even for the right password until
  `npm run unlock -- <email>` or `set-password`. The owner asked for a hard
  lock. The trade-off: anyone who knows an address can lock it out, and
  unlocking needs a shell on the server. A timed lock is the alternative, if it
  ever bites. The remaining attempts are shown, which reveals the account
  exists; with invitation-only sign-up that seemed worth it, so the owner
  doesn't lock themselves out.
- **A per-address limit** in memory (`src/rate-limit.ts`: 10 sign-ins per 15
  min, 5 sign-ups per hour). argon2 is slow on purpose, so a flood of attempts
  is also a CPU attack. Loopback is exempt, because tests and screenshot runs
  sign in dozens of times.
- **`trustProxy` is loopback only**, so behind Caddy `request.ip` is the visitor
  and `request.protocol` is `https`. The cookie is `Secure` exactly when the
  request came in over HTTPS, so the home Wi-Fi over plain HTTP keeps working.
- **`HOST=127.0.0.1` on the server.** The `0.0.0.0` default is for the LAN.

Deployment is in `DEPLOY.md` with the files in `deploy/`: Hetzner, Caddy,
systemd with hardening, a nightly backup timer, and `deploy.sh` (back up, pull,
`npm ci --omit=dev`, restart, then wait for `/login` to answer or fail). `tsx`
is in `dependencies`, not dev, because production runs through it.

**Pushes to `main` deploy themselves.** `.github/workflows/deploy.yml` runs the
typecheck and the server-free suites (`npm test`, `test:accents`, `test:ai`),
then SSHes in. The deploy key's `authorized_keys` entry forces
`command="/usr/local/bin/lingo-deploy",restrict`. That is a copy of `deploy.sh`
**installed by hand**, so a push — and this repo is public — cannot change what
runs as root. Reinstall it after editing `deploy.sh`. The deploy job is skipped
until the repo variable `DEPLOY_ENABLED` is `true`. The browser suites don't
run in CI, so run them locally before pushing anything visual.

**Backups live on the server's own disk only.** The owner left Hetzner Backups
off on 2026-09-10; they can be switched on later. So nightly and pre-deploy
copies undo mistakes but don't survive losing the server. If the data comes
to matter more, the next step is an off-site copy: another server, or object
storage via rclone.

**Charts are hand-written inline SVG.** No charting library: nothing to fetch,
nothing to bundle, works offline. Colours come from CSS custom properties so
both themes are handled by the stylesheet rather than duplicated in JS.

### What carried over from the original

- The score formula, both variants, including the negative neglect term.
- The 2.3 / 2.556 thresholds.
- Exponential-odds weighted sampling.
- "Answer until correct in both directions" as the written session loop.
- De-accented, case-insensitive matching with a manual override — and `y` as
  the override key, as it was at the terminal prompt.
- Append-only long-format statistics.

### What changed on purpose

- All six bugs listed in Part 1 are fixed rather than ported.
- `words.id` is globally unique; the per-file `index` collision is gone.
- `written_enabled` / `audio_enabled` are real columns, so the filter the
  original crashed on now exists.
- Snapshots are recorded at the **end** of a session as well as the start.
- `attempts` stores one row per answer, which is what makes the per-word score
  history replayable and the daily count possible.
- Selection odds are clamped to a floor of 1 — the original could reach 0.
- `deaccent` is Unicode-normalised rather than a hand-written character table.
- **Listening asks for the English meaning**, not the target word spelled back.
  It tests comprehension rather than transcription. Only `from_english` expects
  the target language.
- An empty answer is recorded as a miss rather than ignored: "I don't know" is
  a real answer and forcing a guess only pollutes the history.

### Answer matching

`answersMatch` in `src/algorithm.ts` accepts any shared reading of the two
sides. Three rules, all driven by how the vocabulary is actually written:

1. **Accents are optional** — `etre` for `être`, via Unicode NFD stripping.
2. **Parenthesised notes are optional** — `because` for `because (pq)`. The
   notes disambiguate entries sharing a translation (`car` = "because (c)",
   `parce que` = "because (pq)", `savoir` = "to know (facts)") and belong on the
   card, but nobody types them.
3. **A slash means "either reading"** — `finally` for `at last/finally`, and
   `to make` for `to do/make`.

Rule 3 has two shapes: whole alternatives (`at last/finally`) and a shared
prefix (`to do/make` = "to do" or "to make"). There is no reliable way to tell
them apart, so **both readings are generated**. That makes matching lenient —
bare `make` is also accepted for `to do/make`. This is deliberate: wrongly
rejecting a correct answer is worse than accepting a phrasing the learner
plausibly meant. If it ever needs tightening, that is the decision to revisit.

Speech strips both the notes and everything after the first slash, or it reads
"because open bracket p q" and "to do slash make".

An empty answer never matches, whatever the rules — that is the skip path.

### Duplicate words

A word cannot be added twice within a language, in any category, and cannot
be created by renaming another word through Edit. `spellingKey` in
`src/routes/vocab.ts` decides what "the same" means:

- **Ignored:** case, extra spacing, and curly versus straight apostrophes.
- **Kept:** accents, because *té* (tea) and *te* (you) are different words.

The refusal names the existing entry. A second meaning goes into that entry
with a slash (`end/thin`), which answer matching already accepts. The
database's own unique index only caught an exact match within one category.
The owner's data had no duplicates when this went in (2026-09-10).

### Theme, and the phone's menu

- **The theme is saved on the account** (`users.theme`: auto, light or dark),
  not in the browser, so one choice holds on every device. Before this, the
  site followed each device's own setting, so the laptop was dark and the phone
  light. `layout()` stamps `data-theme` on `<html>` and sets `color-scheme`
  while building the page, so there is no flash of the wrong palette. The
  stylesheet already had the `[data-theme]` overrides.
- **On a phone, the Settings tab is the menu.** The sidebar is hidden there,
  and with it the language picker, which made switching language impossible.
  Settings covers signing out or switching account, switching and creating
  languages, and the theme. A language dropdown in the phone's top bar was
  tried, then removed at the owner's request as a duplicate of Settings.
  The desktop sidebar has the theme switch as well.
- **`POST /preferences/theme` returns you to the page you came from,** but only
  a path on this site: a Referer with a foreign host sends you home.

### Conversation

`src/routes/chat.ts` and `public/chat.js`, modelled on the original app's
`ai_interface.py`, whose three roles and prompt wording carry over:

- **Interpreter.** It corrects what the learner wrote, at temperature 0. The
  corrected sentence, not the draft, is what joins the history, as in the
  original.
- **Partner.** It opens (always, not only for roleplay), drives, and replies,
  and every message ends on something to answer. General conversation is told
  outright not to open with small talk about the learner's day: the owner found
  that dull. The scenes live in `src/chat-scenarios.ts`: general, Surprise me
  (the original's random roleplay), fixed scenes, and the learner's own. A
  hidden kickoff message comes first, because Anthropic requires a
  conversation to start with the user.
- **Teacher.** A thread per message (`/api/chat/teacher`): it explains, then
  takes follow-ups. That is the original's "anything further explaining?" loop.

The level is picked from A1 to C1; the original was fixed at A1. Replies and
corrections are read aloud automatically, with Play, Slow and a mute, as the
original spoke everything with repeat and slow.

**Heard before read.** Each tutor message is spoken, and its text held back
until the learner answers, because the original spoke each reply before
printing it. That makes every turn listening practice. "Show text" gives in
early. "Ask the teacher" waits for the reveal too, since it would give the
words away. With the sound off, or no speech in the browser, the text shows
at once. Corrections show immediately: they are the learner's own sentence.

**Out of credit is its own error.** OpenAI reports it as a 429
(`insufficient_quota` / `credit_balance_exhausted`) that looks like rate
limiting; Anthropic as a 400 mentioning the credit balance. `classifyAIError` in
`src/ai.ts` sorts it from a bad key and a busy provider, and the page names the
provider and links to its billing page. It came up for real: the owner's
OpenAI account had no API credit at first.

**`AI_PROVIDER=mock`** is a free stand-in with a predictable answer per role,
so `npm run test:chat` can drive the page. "!nocredit" in a message fails the
way an empty account does. Start the server with it for that test (in cmd,
`set AI_PROVIDER=mock&& npm start`). It must never be set on the server.

### Sessions survive leaving the page

Written and listening sessions are saved to `localStorage` after every question
and answer, and resumed when the page loads again. That covers switching tabs,
a phone reloading a sleeping page, or a stray tap on the tab bar, which used to
throw the whole session away. Answered-but-not-continued moves on rather than
re-asking, so nothing is recorded twice. Saves are kept for 12 hours, and
"End session" clears them. Tests that start a second session on the same page
must clear `localStorage` first.

### Counting a day's practice

Two different questions, both answered on the Progress page's Today card:

- **Words tested** — counted once per session, so three sessions of 30, 30 and
  40 total 100 even where a word recurred. This is the figure to set a daily
  target against.
- **Different words** — distinct words touched.

This is why `attempts.sessionId` exists. `/api/practice/start` issues a UUID,
the client returns it with every answer, and the count is
`count(distinct sessionId || ':' || wordId)`. Rows from before session tracking
have a null id and coalesce to the date, so each such day reads as one session —
historical days therefore under-report. That was accepted rather than
backfilled.

The **Practice activity** chart counts *answers*, not words, stacked written
under listening — always both modes, whatever the page's Written/Listening
toggle says. It once followed the toggle, so with Written selected a day of
listening vanished from it while the Today card counted it, and the two looked
contradictory. It still honours the category checkboxes.

The progress graph defaults to **Words learnt**: a percentage also drops every
time a word is added, which reads as going backwards.

### Listening speech

`public/practice.js` owns it. Three pieces, each for a reason:

- **Voice choice** — exact language tag first (`fr-FR`), then the language
  family, in the order the browser lists them. Deliberately *not* reordered to
  prefer local voices: that would silently swap the voice the learner hears.
- **Warm-up** — one silent syllable at the first tap or key on the page, and at
  Start if nothing came before. The first utterance pays to start the engine
  and, for a network voice, to open the connection. It has to be inside a user
  gesture: browsers hold back speech a page starts on its own (iOS Safari most
  of all), and the first card is spoken *after* the start request returns,
  outside the gesture that pressed Start. `cancel()` is only called when
  something is speaking, because cancelling an idle engine can delay what
  follows.
- **Replay** — `r` then Enter, as at the original terminal prompt. A bare `r`
  cannot mean replay while typing: English answers contain r. A lone "r" is
  never an English meaning, so that submission is safe to intercept. Once the
  answer is locked (verdict showing), a bare `r` does replay.

**What was measured.** `scripts/measure-speech.ts` in a fresh Chrome: first word
~0.28s, later ones ~0.12–0.28s, before the warm-up — and no measurable change
after it, because Google's network jitter is larger than the cold cost there. A
multi-second first-word lag was reported but *not reproduced* on desktop
Chrome. The warm-up targets the gesture rule, which cannot be tested from here.
If the lag persists, establish the device and browser before changing more.

### Traps worth remembering

- **`.env` has to load before any import reads it.** Imports are hoisted, so
  `process.loadEnvFile()` in `server.ts`'s body ran only after `db/index.ts`
  had read `DATABASE_PATH`, and after `ai.ts` had chosen its provider (it does
  that at import). `src/env.ts` is imported first to fix it. Keep it first.
  Scripts that need `.env` load it themselves (`check-ai.ts`).
- **npm 11 wants install scripts approved.** `allowScripts` in `package.json`
  covers argon2 and better-sqlite3 (native modules) and esbuild (which `tsx`
  runs on). Without that, an npm that enforces approval skips their builds, and
  the server cannot start or run TypeScript. A new dependency with an install
  script needs `npm install-scripts approve <pkg>`. The server also has
  `build-essential` and `python3`, in case no prebuilt binary matches.
- **The running server does not reload.** It is started with `npm start` —
  plain `tsx`, no watch — so a server-side edit is invisible until a restart,
  while files in `public/` are served fresh. A screenshot pass after editing
  `src/` without restarting verifies the *old* code; it happened once.
- **An override is a second row.** "I was right — count it" records a new,
  correct, `overridden` attempt after the miss, and the miss row stays. So the
  counters take both — one overridden question is tested +2, correct +1 — and
  anything listing misses must drop the overridden ones. The word record lists
  recent *wrong* answers only (what was typed against what was wanted), and
  `word-detail.ts` filters overridden misses out.
- **Status colours are their own tokens.** `--status-solid` is the deeper green
  in both themes and `--status-learnt` the lighter: darker reads as more learnt.
  Mixing `--learnt` toward `--surface` looked right in light mode and inverted
  in dark, where the mix *darkens*. Learning is split the same way:
  `--learning` is the text shade, `--learning-fill` the vivid amber for bars and
  dots. One colour for both was a muddy mustard. Listening has its own
  `--listening` (raspberry), because the earlier blue sat too close to Written's
  indigo to tell apart on a chart. The banner bars draw solid and learnt as
  separate bands (`.bar i.solid`, `.bar i.learnt-only`). Plain `.bar i.learnt`
  is the quiz's own progress bar and stays one green.
- **Playwright hides Chrome's Google voices.** They live in a component
  extension that automation disables, so a test browser shows only the OS's
  local voices — none French on this laptop. `measure-speech.ts` re-enables it
  with `ignoreDefaultArgs`; `test-listening.ts` records speech instead of
  playing it, so it does not care.

- **`Number("")` is `0`, not `NaN`, and `Number.isInteger(0)` is `true`.** A
  select whose default option has an empty value submits `type=`, which read as
  a real category id of 0 and filtered everything away — vocabulary search
  returned nothing through the form for a while. `optionalId()` in
  `src/context.ts` is the fix; use it for every optional numeric query param.
- **Test the form, not the query string.** The bug above was invisible to a
  request that simply omitted `type`. `scripts/test-vocab-search.ts` submits the
  real form for that reason.
- **Module scripts are deferred.** `<script type="module">` that sets
  `window.X` then `import`s runs the import *first*, because imports are
  hoisted. `layout()` emits a classic `<script>` for data and a separate
  deferred module for code. Do not "simplify" it.
- **Grid and flex children default to `min-width: auto`.** They refuse to shrink
  below their content, so a wide table's own `overflow-x` never engages.
  `.stack > *`, `.container > *` and `.card` set `min-width: 0` for this.
- **Filters must travel — and editing must not reload.** Edit, Save, Cancel
  and Delete happen in place (`public/vocab.js` swaps the row, fetching
  `/vocab/words/:id/edit-row`; the save returns the new row as JSON when sent
  with `x-requested-with: fetch`). As full page loads, every Edit jumped back to
  the top and reset the add form's category, which made editing a run of words
  a chore. The no-JavaScript path still works: links and redirects carry the
  category, search, sort and mode, and land on `#word-<id>`, with the add
  form's focus switched off so it does not scroll back up. That focus comes
  from `vocab.js`, on desktop widths only: on a phone it scrolled the page past
  the top bar. The add
  form's category is remembered per language in `localStorage`.
- **Overlapping buckets look like a partition.** "Solid" is a subset of
  "learnt", so showing solid / learning / untouched left a word between the
  thresholds in no bucket and the tiles did not add up. `Summary.learntNotSolid`
  makes the four counts sum to the total.
- **"None selected" is not "show everything".** The progress filters need a
  hidden `filtered=1` marker to tell a deliberate empty selection from a first
  visit, or the overall line can never be shown alone.
- **`waitForSelector` on an always-present element returns instantly.** The
  quiz input is only *disabled* between questions, never removed, so waiting on
  it read state too early and made a passing feature look broken. Wait for the
  verdict to detach instead.
- **`fullPage` screenshots misplace `position: fixed`.** The mobile nav bar
  looks like it floats mid-page. Check it with `--viewport`.
- **Two concurrent `npm install`s in one project clobber each other** and can
  leave `package.json` with no dependencies while still exiting 0.
- **Git Bash rewrites a leading `/path` argument** into a Windows path. Prefix
  with `MSYS_NO_PATHCONV=1` when passing URL paths to a script.
- **`tsx` compiles with esbuild's `keepNames`,** which injects a `__name` helper
  that does not exist in the browser. A named inner function inside
  `page.evaluate` makes the whole call throw. Keep those bodies free of them.
- **PowerShell may be unavailable in a session.** Kill a stuck port with
  `netstat -ano | grep :3000` plus `taskkill /PID <pid> /F`.

### Accent entry

`src/accents.ts` only converts a letter+accent pair when the result is a letter
that language actually uses. That gate is the whole point: without it, French
`qu'est` becomes `qú est` and `d'abord` breaks, because `u'` is a common French
sequence but `ú` is not a French letter. Spanish does use `ú`, so there the same
keystroke converts. Keep `scripts/test-accents.ts` green; the apostrophe cases
are the ones that matter.

The table carries its own reverse entries (`é` + `'` maps back to `e'`), so the
browser needs no special case for "press twice to keep it literal".

### Verification

Everything below is expected to pass before calling a change done. `npm run
test:all` chains the main ones; the browser suites need the server running and
the demo account seeded.

| Command | Covers |
|---|---|
| `npm test` | Scoring, decay, sampling, answer matching |
| `npm run test:accents` | Accent composition, per language |
| `npm run test:accents:browser` | Accent typing in a real browser |
| `npm run test:ai` | Provider/model resolution, all permutations |
| `npm run test:auth` | Invitation-only sign-up, lockout and unlock, Secure cookie behind HTTPS, limiter |
| `npm run test:duplicates` | A word can't be added twice or renamed onto another, whatever case, spacing or category |
| `npm run test:theme` | Theme saved per account and stamped on pages, safe redirect, phone language picker and Settings tab |
| `npm run test:chat` | Conversation end to end: scene and level, AI opens, corrected turn, speech, teacher thread, own scene, out-of-credit message. **Server must run with `AI_PROVIDER=mock`** |
| `npm run test:search` | Vocabulary search and category filter, via the form |
| `npm run test:session` | Session size, skip-on-empty, `y` override |
| `npm run test:listening` | Silent speech warm-up, `r` replay, typed r untouched |
| `npm run test:vocab-edit` | Editing in place: no reload, no scroll jump, add category kept and remembered |
| `npm run test:entry` | Keyboard word entry |
| `npm run test:daily` | Session-based daily counting |
| `npm run audit:mobile` | Touch targets, iOS input zoom, overflow |
| `npm run shot` | Every page, both widths, both themes |

`npm run shot` flags console errors and horizontal overflow — keep both at zero.
`scripts/diagnose-overflow.ts` names the offending element.

### Data tooling

Read-only checks and one-off fixes live in `scripts/`:

- `check-accents-in-data.ts` — cross-references stored words against the
  archived vocabulary in `old_code_repo/` to find missing accents. Evidence
  rather than eyeballing.
- `fix-verb-category.ts` — moves infinitives filed elsewhere into the verb
  category. Dry-run by default.
- `remove-demo-accounts.ts` — clears seeded `demo@`/`empty@` accounts and
  nothing else. Use after `npm run seed`.
- `reset-users.ts` — clears every account. Dry-run by default, takes a
  timestamped database backup, checkpoints WAL first.
- `set-password.ts` — replaces a password hash.
- `clean-test-words.ts` — removes words left by the entry test.
- `measure-speech.ts` — times Start-to-first-sound in listening practice and
  lists the voices on offer. Muted; `--direct`, `--headed`, `--runs=N`.
- `unlock-account.ts` (`npm run unlock`) — lists locked accounts, or unlocks
  one.
- `backup-db.ts` (`npm run backup`) — a consistent online copy into
  `data/backups/`. Use this rather than copying the file, which misses
  whatever is still in the WAL. Labels keep kinds apart: `app-<date>.db`
  nightly (14 kept), and `pre-deploy-<timestamp>.db` from `deploy.sh` (10
  kept). They once shared one name per day, so a second deploy overwrote the
  only good copy taken before a broken first one.

**`npm run seed` writes to the live database.** It only adds, so real data is
safe, but always follow it with `npm run seed:clean`.

### The archived vocabulary

`old_code_repo/data/` holds **2,531 French** and **248 Spanish** words, counting
only rows carrying a term. French: nouns 896, conjugations 523,
verbs_infinitive 405, adjectives 252, adverbs 182, phrases 155, nadj 52,
prepositions 36, conjunctives 30. It is correctly accented throughout — every
word in the live database was checked against it and none were wrong.

Not imported, deliberately: a fresh start was asked for. An importer would be
small — map each CSV to a category, insert, leave progress empty. Note that
`conjugations` (523) are inflected forms rather than dictionary entries, and
`nadj` has no equivalent in the default category set.

### Not built yet

- Importing the archived vocabulary.
- Per-user configuration of the learner level and the learnt thresholds.
- A real domain. sslip.io stands in; see "The live server".
- Backfilling session ids onto historical attempts (the timestamps would
  support inferring sessions from gaps; judged not worth it).

---

## Working agreements

- `old_code_repo/` is read-only reference. Never edit it, never import from it.
  Reading its CSVs as data for an audit is fine.
- Run `npm run typecheck` and the relevant suites before calling a change done.
  Run `npm run shot` when touching anything visual and keep the warnings at zero.
- **Verify visually.** For UI work that means looking at real screenshots, not
  asserting a 200 response.
- Never commit API keys. Secrets go in `.env`, which is gitignored. The template
  is `env.example` — no leading dot, so the `.env*` ignore rule does not catch it.
  `.env` is off-limits to me for writing as well as reading: the permission
  deny rule covers both. Hand the user the contents or a copy command, and
  never work around the rule through the shell.
- The database at `data/app.db` holds real vocabulary and learning history.
  Back it up before destructive scripts; they take their own backups too.
- Say plainly when something was my error. Several bugs this session were mine,
  and a couple of "failures" were bad tests rather than broken features — report
  which it was.

### Environment notes

- Windows 11, Git Bash available; PowerShell is not always enabled.
- Locally the server runs as a detached `npm run start`, logging to
  `data\server.log`. On the hosted server it runs under systemd — see
  `DEPLOY.md`.
- `HOST` defaults to `0.0.0.0` so a phone on the same Wi-Fi can reach it. That
  is the bind address, **not** browsable — the startup log prints the real LAN
  URL, which changes with the network.

### The live server

- **https://91-99-202-188.sslip.io**, live since 2026-09-10. It runs on a
  Hetzner cx23 (x86, 2 vCPU, 4 GB) with Ubuntu 26.04, Node 24.21 and Caddy
  2.6.2.
- **Why Hetzner:** chosen over a Pi at home, because the home broadband is
  unreliable, and over EC2, which costs more to set up and run for no benefit
  at this size. It is about $8.70 a month.
- **Why sslip.io:** it stands in for a domain, because a certificate needs a
  name, not an IP. Moving to a real domain means one line in
  `/etc/caddy/Caddyfile` plus an `A` record.
- **SSH:** `root@91.99.202.188`, keys only. Password logins are off in
  `/etc/ssh/sshd_config.d/00-lingo-hardening.conf`. Hetzner's firewall allows
  22, 80 and 443 only.
- **The owner's data moved there on 2026-09-10** (150 words, 1,022 answers,
  checksums matched). **The server's database is the real one.** The laptop's
  copy of that account is stale, and the local install is for development.
- **GitHub deploy key:** `~/.ssh/lingo_deploy` on the laptop. The server's
  `authorized_keys` forces it to `lingo-deploy`, and it cannot open a shell.
- **The server's `.env`** holds `HOST=127.0.0.1` and Sonnet. The owner adds the
  API key there themselves.

### Outstanding

- **Folder rename.** The project still lives in `learning_languages` and should
  be `lingo`. Windows will not rename a directory that is a running process's
  working directory, and VS Code holds it open too, so this is a user action:
  close both, `mv learning_languages lingo`, reopen. Git travels with it.
- **Accidental outer repo** at `C:\Users\benar\Documents\GitHub` (remote
  `benarcher444/language_learning`, no commits). Harmless day to day, but
  `git add .` from there would stage every project in that folder.
- **The old OpenAI key** in `old_code_repo/config.yaml` and `.env` was pushed to
  GitHub and should be rotated.
