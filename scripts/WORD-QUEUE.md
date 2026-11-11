# The word queue — Spanish

**Read this before writing the next batch script.** It is the list of words
the vocabulary is missing, in the order they are worth adding, verified absent
against the live database on 2026-11-11 at 901 words.

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
- Glosses here are a starting point, not decided. Check each one against the
  duplicate-gloss guard, and narrow it where another word already answers that
  English.

---

## Group 1 — function words (22/22 absent)

The worst hole and the cheapest to fix. `usted` and `ustedes` matter most:
the vocabulary has *tú* and *vosotros*, so there is currently no way to address
a stranger politely, and in Latin America *ustedes* is the **only** plural you.
`tan` and `así` are top-150. None of these are verbs, so this group can go in
as a batch of its own.

| word | gloss (provisional) |
|---|---|
| usted | you (formal) |
| ustedes | you (formal pl) |
| tan | so |
| tanto | so much |
| así | like this/so |
| lo que | what/that which |
| ningún | no/not any |
| ninguno | none |
| sino | but rather |
| pues | well/then |
| todos | everyone/all |
| cualquier | any |
| contigo | with you |
| alguno | some/any |
| estos | these (m) |
| estas | these (f) |
| esos | those (m) |
| esas | those (f) |
| aquellos | those over there (m) |
| cual | which (relative) |
| mío | mine |
| tuyo | yours |

Note: the vocabulary holds `esta` (this, f) and `cuál` (which?), so the
accented and unaccented members of those pairs need keeping straight — and
`cual`/`cuál` and `esta`/`estás` are listening collisions. That is **not** a
reason to withhold them (see CLAUDE.md); "Hear another word" is what a
collision is for.

## Group 2 — compound prepositions and connectives (18/18 absent)

The vocabulary has `antes` and `después` as bare adverbs but not the `de`
forms that attach them to a noun, and the same for `cerca`/`lejos`. One small
word each, and they turn clauses into sentences. No verbs here either.

| word | gloss (provisional) |
|---|---|
| hacia | towards |
| según | according to |
| contra | against |
| antes de | before (+ noun) |
| después de | after (+ noun) |
| cerca de | near to |
| lejos de | far from |
| enfrente de | opposite |
| junto a | next to |
| a través de | through |
| a pesar de | despite |
| en vez de | instead of |
| además de | as well as |
| así que | so |
| ya que | since |
| para que | so that |
| sin que | without |
| a menos que | unless |

## Group 3 — abstract and relational nouns (22/22 absent)

The 300 nouns are almost entirely concrete. These are what conversation past
the transactional runs on: "the reason I think that" is currently unsayable.

la idea · la razón · la manera · la forma · el tipo · el ejemplo · la parte ·
el final · el principio · el centro · el lado · el resto · el nivel ·
la situación · la solución · el resultado · el punto · la vista · el caso ·
el orden · la cantidad · el espacio

## Group 4 — evaluative adjectives (30/30 absent)

The adjectives already held are physical-property pairs (*alto/bajo*,
*gordo/delgado*) and well done. What is missing is the whole register for
**judging** things, which is most of what adjectives do in speech. `aburrido`
is a conspicuous gap given *divertido* is in.

seguro · raro · propio · único · necesario · imposible · cierto · común ·
normal · suficiente · útil · serio · duro · ligero · pesado · seco · mojado ·
ancho · estrecho · blando · loco · contento · preocupado · enfadado ·
sorprendido · aburrido · verdadero · falso · varios · capaz

## Group 5 — adverbs that join ideas (18/18 absent)

incluso · al menos · sobre todo · apenas · aún · realmente · completamente ·
exactamente · finalmente · especialmente · generalmente · adelante · atrás ·
alrededor · afuera · adentro · jamás · tal vez

## Group 6 — nouns whose verb is already held (6 absent)

Cheap, because half the pair is already learnt.

el viaje (*viajar* in) · el amor (*amar* in) · el dolor (*doler* in) ·
la ayuda (*ayudar* in) · el cuento (*contar* in) · la vuelta (*volver* in)

## Group 7 — common concrete nouns (36/36 absent)

la luz · la voz · el sueño · la suerte · el miedo · la noticia · la historia ·
el ruido · el aire · la tierra · el fuego · la nube · el calor · el camino ·
el centro · la plaza · el mensaje · el correo · el móvil · el precio ·
la cuenta · la empresa · el jefe · la reunión · el novio · la novia ·
el marido · la esposa · la pareja · el compañero · la medicina · el médico ·
la enfermedad · la fuerza · el cuidado · el silencio

## Group 8 — verbs (36 absent) — ten per hundred words, at most

Spread across batches under the verb cap. The first five are the highest
value, because `importar`, `faltar` and `encantar` are the same backwards
pattern as *gustar* and *doler*, which are already held — three words for a
grammar point already paid for.

**First:** importar · faltar · encantar · costar · acabar

**Then:** mostrar · conseguir · caer · soler · llamarse · sentirse · valer ·
quedarse · gastar · durar · tardar · cuidar · evitar · lograr · permitir ·
aceptar · ofrecer · crear · matar · andar · irse · ocupar · molestar ·
alegrarse · enfadarse · apoyar · considerar · presentar · mantener · suponer ·
preocuparse

---

## Also noticed, not a queue item

`salud` is glossed only as "cheers/bless you", so the noun **health** is not
available. Widening it to "cheers/health" would be an edit to the existing
word, not an addition — the owner's call, raised 2026-11-11.
