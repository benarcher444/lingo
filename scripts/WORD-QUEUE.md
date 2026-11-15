# The word queue — Spanish

**Read this before writing the next batch script.** It is the list of words
the vocabulary is missing, in the order they are worth adding.

Verified absent against the live database on 2026-11-11 at 901 words. **97
left**: groups 1 to 4 and most of 5 went in on 2026-11-15 as
`add-spanish-1000.ts`, which took the vocabulary to 1000 exactly. Re-verify
before the next batch — the owner adds words by hand too.

## Why this file exists

Every batch up to 2026-11-09 chose its words by **reading the existing
vocabulary and looking for thin topics** — clothes were short, the body was
half-done, food needed drink. That method finds missing *categories* and is
structurally blind to missing *function words*, because `tan` and `así` do not
belong to a topic and nothing looks thin when they are gone. The result, after
241 words added across three batches: `el bisabuelo`, `la pasta de dientes` and
`el despertador` were in, and `tan`, `así`, `usted`, `lo que` and `la idea`
were not — several of them top-150 words in the language.

So **batches are chosen by frequency, not by topic.** The owner's vocabulary is
already broad; what it lacks is the common grey words that hold sentences
together. A batch that reads like a tidy topic list ("here are the clothes") is
the warning sign. A good batch now looks like a list of small dull words.

The owner asked on 2026-11-11 why these had not been added, which is a fair
question with no good answer. Hence a queue on disk rather than an intention.

## How to use it

- Take from the top. Group 1 before group 2, and so on.
- **Delete what you take** in the same commit as the batch script, so the
  queue shrinks and never gets added twice.
- Check each word against the live database before writing it in — the owner
  adds words by hand too, so this file goes stale.
- **The verb cap applies** (one verb infinitive per ten words added, see
  CLAUDE.md). There are 36 verbs queued below, so they need **at least 360
  words of batches** to land and will arrive about ten at a time. Do not try to
  clear the verb group in one go; `lib/word-batch.ts` will refuse it.
- **A phrase takes its own words with it.** If a batch adds a phrase, every
  word in it is held already or joins the same batch. The engine reports the
  gaps; group 3 lists the ones deliberately left.
- Glosses here are a starting point, not decided. Check each against the live
  data — but **never narrow one to dodge the duplicate check.** If another word
  already holds that exact English, both cards get a bracketed note
  (`to love (a)` and `to love (q)`) and the older one is fixed through `RENOTE`
  in the same batch. A *reading* shared with a word whose face differs — "to
  try" against `tratar` = "to try/to treat" — needs nothing at all. See
  "Duplicate words" in CLAUDE.md.

---

## Taken on 2026-11-15 — groups 1 to 4, and most of 5

`add-spanish-1000.ts` took 99 words and the vocabulary reached 1000 exactly.
Groups 1, 2, 3 and 4 went in whole. Three words did **not** go in and are
still owed:

| word | why it was held back | where it stands now |
|---|---|---|
| `pues` | "well" is already `bien` | **Owed.** Goes in with a note, beside a renote for `bien`. Wording below. |
| `acabar` | "to finish" is already `terminar` | **Owed.** Same — a note each. `llamarse` took its slot in the batch. |
| `cual` | left out as low value — mostly formal (*el cual*). Not for colliding with `cuál`; a collision by ear is never a reason to withhold a word. | Still a judgement call, not a gloss problem. |
| `alguno` | the vocabulary already holds `algún`, which is the same word apocopated. | Probably not wanted at all. |

Two of those four were held back for a reason that **was not a reason**, and
the next batch owes them. See below.

## Glosses to repair — the narrowing was wrong

On 2026-11-15 the owner said plainly: *"don't put something as something else
just because that word is taken … You do know synonyms exist in all
languages?"* Several batches had been narrowing a word's meaning, or dropping
the word, to get past the duplicate-gloss check. The rule now is a bracketed
note on every card that shares a meaning — see "Duplicate words" in CLAUDE.md,
and `lib/word-batch.ts` enforces it.

**Which letter or word goes in the brackets is the owner's wording**, so
nothing here is applied until they say. Each row below is a proposal.

Most of them turn out not to need a note at all: the duplicate check compares
the **card face**, and `a través de` = "through" never collided with `por` =
"for/by/through" in the first place. Those were narrowed by an over-strict
pre-check of mine, not by the guard.

### No note needed — just give the word its meaning back

| word | reads now | should read | why it was narrowed |
|---|---|---|---|
| `a través de` | by way of | **through** | to keep off `por` = "for/by/through" — different face, no clash |
| `único` | unique | **only/unique** | to keep off `solo` = "only/alone" — different face |
| `ningún` | not any | **no/not any** | to keep off `no` = "no" — different face |
| `probar` | to taste | **to try/to taste** | to keep off `intentar` = "to try" — different face |
| `tocar` | to touch | **to touch/to play (an instrument)** | to keep off `jugar` = "to play". The lost half is the one Spanish actually needs |
| `luego` | later | **then/later** | to keep off `entonces` = "then/so" — different face |
| `desde` | since | **since/from** | to keep off `de` = "of/from" — different face |

### A note on both halves — the faces really do collide

| the pair | proposal |
|---|---|
| `lo que` = "that which" and `qué` = "what" | `lo que` → **"what (relative)"**, `qué` → **"what (asking)"**. Grammatical rather than initials, because that is the actual difference. `qué` asks; `lo que` joins clauses. |
| `la vez` = "the occasion" and `el tiempo` = "the time" | `la vez` → **"the time (occasion)"**, `el tiempo` → **"the time (duration)"**. `la hora` = "the hour/time" needs nothing — different face. |
| `acabar` (absent) and `terminar` = "to finish" | `acabar` → **"to finish (a)"**, `terminar` → **"to finish (t)"**. Near-perfect synonyms with no useful semantic split, so initials, exactly as `because (c)` and `because (pq)`. |
| `pues` (absent) and `bien` = "well" | `pues` → **"well (so then)"**, `bien` → **"well (nicely)"**. Different parts of speech, so a semantic note beats initials. |

### Needs a decision, not a note

| word | reads now | the question |
|---|---|---|
| `el cuarto` | the quarter | It went in for *y cuarto*, but *el cuarto* is also an everyday word for a room. Add that meaning — `el cuarto` = "the quarter/room (c)" with `la habitación` = "the room (h)" — or leave it as the quarter alone? |

`duro` = "hard (not soft)" is **right as it is**: nothing holds "hard", so the
note is doing honest semantic work rather than dodging a guard.

## What the phrase report found on 2026-11-15

Four of the compound prepositions in `add-spanish-1000.ts` had a part the
vocabulary did not hold. The report is advisory, so the batch went in and
these were judged one at a time:

| part | from | decision |
|---|---|---|
| `junto` | junto a | **Already there.** `juntos` is held; the check only went plural to singular, so it missed it. Fixed in `lib/word-batch.ts`. |
| `enfrente` | enfrente de | **Queued** — group 6, a real adverb in its own right ("opposite"). |
| `pesar` | a pesar de | **Queued** — group 9, the verb "to weigh". The cap was full at 9 for a 99-word batch. |
| `tráves` | a través de | **Not wanted.** It does not exist outside this idiom, like `embargo` in *sin embargo*. |

## Group 5 — evaluative adjectives (8 left of 30)

Twenty-two went in on 2026-11-15. What is left is the narrower physical and
emotional end.

seco · mojado · ancho · estrecho · blando · enfadado · sorprendido · capaz

## Group 6 — adverbs that join ideas (18/18 absent)

incluso · al menos · sobre todo · apenas · aún · realmente · completamente ·
exactamente · finalmente · especialmente · generalmente · adelante · atrás ·
alrededor · afuera · adentro · jamás · tal vez · enfrente

## Group 7 — nouns whose verb is already held (6 absent)

Cheap, because half the pair is already learnt.

el viaje (*viajar* in) · el amor (*amar* in) · el dolor (*doler* in) ·
la ayuda (*ayudar* in) · el cuento (*contar* in) · la vuelta (*volver* in)

## Group 8 — common concrete nouns (36/36 absent)

la luz · la voz · el sueño · la suerte · el miedo · la noticia · la historia ·
el ruido · el aire · la tierra · el fuego · la nube · el camino ·
la plaza · el mensaje · el correo · el móvil · el precio ·
la cuenta · la empresa · el jefe · la reunión · el novio · la novia ·
el marido · la esposa · la pareja · el compañero · la medicina · el médico ·
la enfermedad · la fuerza · el cuidado · el silencio

## Group 9 — verbs (27 left of 36) — ten per hundred words, at most

Spread across batches under the verb cap. The first five are the highest
value, because `importar`, `faltar` and `encantar` are the same backwards
pattern as *gustar* and *doler*, which are already held — three words for a
grammar point already paid for.

Nine went in on 2026-11-15 (importar, faltar, encantar, costar, llamarse,
mostrar, conseguir, caer, soler), which was the cap for a 99-word batch.

**Needs a gloss decided first:** acabar — "to finish" is already `terminar`.

**From the phrase report:** pesar ("to weigh", behind *a pesar de*).

**Then:** sentirse · valer · quedarse · gastar · durar · tardar · cuidar ·
evitar · lograr · permitir · aceptar · ofrecer · crear · matar · andar ·
irse · ocupar · molestar · alegrarse · enfadarse · apoyar · considerar ·
presentar · mantener · suponer · preocuparse

## Group 10 — the next tranche by frequency (24)

Added to the queue on 2026-11-15 because groups 5 to 9 hold only 79 words and
the next batch is meant to be 100. **Not yet verified against the live
database** — do that before writing them in.

These lean conversational rather than journalistic. The frequency lists put
`el gobierno`, `la ley` and `la guerra` higher than their usefulness in
speech, because the corpora are full of news; they are included but last.

**Time and quantity:** el rato (a short while) · el futuro · el pasado ·
la época (the era) · el siglo (the century) · la mitad (the half) ·
el par (the pair)

**Everyday abstract:** el peligro (the danger) · el interés · el esfuerzo
(the effort) · el valor (the value) · la calidad (the quality) ·
el servicio · el producto · el modo (the method)

**People and groups:** el equipo (the team) · el partido (the match) ·
la sociedad · el poder (the power — `poder` the verb is already held, which
is fine: another category may hold the same spelling)

**Later, if wanted:** el gobierno · la ley · el derecho (the entitlement) ·
la guerra · la paz

Gloss warnings already spotted: `la mitad` must be "the half", because
`medio` took "half" on 2026-11-15; `el modo` wants a gloss that keeps it off
`la manera` ("the way/manner"), so "the method"; `el estado` would collide
with the `he estado` conjugation only on spelling, not gloss, so it is safe
but was left out as low value.

---

## A phrase's words go in with it

From 2026-11-11, when a batch adds a phrase, the words it is made of must
already be in the vocabulary or go in alongside it. `lib/word-batch.ts`
reports any phrase whose words are missing, and the exceptions are written up
in group 3 above. The report is advisory because conjugated forms cannot be
added unasked — read the gaps, do not just clear them.
