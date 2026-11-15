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
- Glosses here are a starting point, not decided. Check each one against the
  duplicate-gloss guard, and narrow it where another word already answers that
  English.

---

## Taken on 2026-11-15 — groups 1 to 4, and most of 5

`add-spanish-1000.ts` took 99 words and the vocabulary reached 1000 exactly.
Groups 1, 2, 3 and 4 went in whole. Three words did **not** go in and are
still owed:

| word | why it was held back |
|---|---|
| `pues` | "well" is already `bien`, and there is no note to tell them apart. Needs a gloss decided before it can go in. |
| `cual` | left out as low value — mostly formal (*el cual*). Not for colliding with `cuál`; a collision by ear is never a reason to withhold a word. |
| `alguno` | the vocabulary already holds `algún`, which is the same word apocopated. Probably not wanted at all. |

`acabar` is also still owed, from group 9: it means "to finish", which
`terminar` already answers, so it needs a gloss decided first. `llamarse`
took its slot.

## Group 5 — evaluative adjectives (8 left of 30)

Twenty-two went in on 2026-11-15. What is left is the narrower physical and
emotional end.

seco · mojado · ancho · estrecho · blando · enfadado · sorprendido · capaz

## Group 6 — adverbs that join ideas (18/18 absent)

incluso · al menos · sobre todo · apenas · aún · realmente · completamente ·
exactamente · finalmente · especialmente · generalmente · adelante · atrás ·
alrededor · afuera · adentro · jamás · tal vez

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

**Then:** sentirse · valer · quedarse · gastar · durar · tardar · cuidar ·
evitar · lograr · permitir · aceptar · ofrecer · crear · matar · andar ·
irse · ocupar · molestar · alegrarse · enfadarse · apoyar · considerar ·
presentar · mantener · suponer · preocuparse

---

## A phrase's words go in with it

From 2026-11-11, when a batch adds a phrase, the words it is made of must
already be in the vocabulary or go in alongside it. `lib/word-batch.ts`
reports any phrase whose words are missing, and the exceptions are written up
in group 3 above. The report is advisory because conjugated forms cannot be
added unasked — read the gaps, do not just clear them.
