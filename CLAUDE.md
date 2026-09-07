# Language Learning — Project Guide

## What this repo is

A rebuild of a personal language-learning tool. The original was a Python
terminal app (`old_code_repo/`, formerly `learning_spanish` — the name is a
misnomer, the real dataset is French). The new build is a **web app**, run
locally first, eventually on a Raspberry Pi behind a DNS name.

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

**Vocabulary — `data/french/nouns.csv`** (french: 9 files, ~2,570 rows;
spanish: 9 files, ~245 rows)

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

## Part 2 — The new build (as it stands)

A server-rendered TypeScript web app on Node + Fastify, SQLite via Drizzle,
plain CSS and vanilla JS. No bundler and no build step at runtime — deliberate,
because it has to run on a Raspberry Pi.

See `README.md` for how to run it. This section is the reasoning behind the
shape, which the README does not carry.

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

**Score is derived, never stored.** The original cached `score` in the CSV. But
score depends on today's date via the neglect term, so a stored value is stale
the next morning. `loadScoredWords` pulls a language's words in one query and
scores them in TypeScript — under a millisecond at a few thousand words, and it
eliminates a whole class of staleness bug.

**Fresh database, no migration of the old CSVs.** Explicitly requested. The old
French data stays in `old_code_repo/` if it is ever wanted.

**The AI provider is configuration, not a code decision.** `src/ai.ts` exposes
one `complete()` interface; OpenAI and Anthropic are both implementations behind
it, chosen by `AI_PROVIDER`. Default is OpenAI, which is what the original app
used. I originally hard-coded Anthropic without asking — that was the wrong
call, and the abstraction exists so the choice stays the user's. Adding a third
provider means adding a class, not touching the tutor pipeline.

**Browser speech synthesis, not gTTS.** The original called Google for every new
word and cached mp3s. `speechSynthesis` needs no network, no cache directory and
no dependency — which matters on a Pi that may be offline. Voice availability
varies by browser, which is the trade.

**Email + password with a session cookie, argon2id.** No third-party identity
provider: it works offline and adds no dependency. Every table hangs off
`user_id`, so OAuth later is additive.

**Charts are hand-written inline SVG.** No charting library: nothing to fetch,
nothing to bundle, works offline. Colours come from CSS custom properties so
both themes are handled by the stylesheet rather than duplicated in JS.

### What carried over from the original

- The score formula, both variants, including the negative neglect term.
- The 2.3 / 2.556 thresholds.
- Exponential-odds weighted sampling.
- "Answer until correct in both directions" as the written session loop.
- De-accented, case-insensitive matching with a manual override.
- Append-only long-format statistics.

### What changed on purpose

- All six bugs listed in Part 1 are fixed rather than ported.
- `words.id` is globally unique; the per-file `index` collision is gone.
- `written_enabled` / `audio_enabled` are real columns, so the filter the
  original crashed on now exists.
- Snapshots are recorded at the **end** of a session as well as the start, so
  history reflects work done.
- `attempts` stores one row per answer, so the formula can be retuned against
  real history rather than only aggregates.
- Selection odds are clamped to a floor of 1 — the original could reach 0, which
  made a well-known word unreachable rather than merely rare.
- `deaccent` is Unicode-normalised rather than a hand-written character table,
  so it works for languages beyond French and Spanish.

### Traps worth remembering

- **Module scripts are deferred.** A `<script type="module">` that does
  `window.X = ...` then `import "./thing.js"` runs the import *first*, because
  imports are hoisted — the config is `undefined` when the module reads it.
  `layout()` therefore emits a classic `<script>` for data and a separate
  deferred module for code. This cost a debugging cycle; do not "simplify" it.
- **Grid and flex children default to `min-width: auto`.** They refuse to shrink
  below their content, so a wide table's own `overflow-x` never engages and the
  whole page scrolls sideways instead. `.stack > *`, `.container > *` and
  `.card` all set `min-width: 0` for this reason.
- **`npm run shot` flags horizontal overflow and console errors.** Keep it at
  zero. `scripts/diagnose-overflow.ts` names the offending element.
- **`fullPage` screenshots misplace `position: fixed`.** The mobile nav bar looks
  like it floats mid-page; it does not. Check it with `--viewport`.
- **Two concurrent `npm install`s in one project clobber each other** and can
  leave `package.json` with no dependencies while still exiting 0.
- **Git Bash rewrites a leading `/path` argument** into a Windows path. Prefix
  with `MSYS_NO_PATHCONV=1` when passing URL paths to a script.

**Accent entry is language-gated, and that gate is the whole point.**
`src/accents.ts` only converts a letter+accent pair if the result appears in
that language's alphabet. Without it, French `qu'est` would become `qú est` and
`d'abord` would break — `u'` is a common French sequence but `ú` is not a French
letter. Spanish does use `ú`, so there the same keystroke converts. Any change
here must keep `scripts/test-accents.ts` green; the apostrophe cases are the
ones that matter.

Composition also carries its own reverse entries (`é` + `'` maps back to `e'`),
so the browser needs no special case for "press twice to keep it literal".

### Resetting

Two scripts, and the difference matters: `scripts/remove-demo-accounts.ts`
clears only the seeded `demo@`/`empty@` accounts and leaves real data alone —
use it after `npm run seed`. `scripts/reset-users.ts` clears every account and everything cascading from it.
It is dry-run by default and takes a timestamped database backup before
deleting, because there is no other way back. WAL is checkpointed first, or the
backup misses recent writes.

### Not built yet

- Importing the old French vocabulary (deliberately skipped; data is preserved).
- Per-user configuration of the learner level and the learnt thresholds — both
  are still constants.
- Any deployment automation for the Pi, or the DNS setup.

---

## Working agreements

- `old_code_repo/` is read-only reference. Never edit it, never import from it.
- Run `npm run typecheck` and `npm test` before calling a change done; run
  `npm run shot` when touching anything visual, and keep overflow warnings at zero.
- Never commit API keys. Secrets go in `.env`, which is gitignored. The template
  is `env.example` — note the missing leading dot, so it is not caught by the
  `.env*` ignore rule.
- **Unresolved:** there is an accidental git repository rooted at
  `C:\Users\benar\Documents\GitHub` (remote `benarcher444/language_learning`, no
  commits) that would swallow every project in that folder, and it makes this
  project's `.gitignore` inert. Deal with it before the first commit.
- The original repo still exists at
  `C:\Users\benar\Documents\GitHub\learning_spanish` with its history and GitHub
  remote, so nothing has been lost.
