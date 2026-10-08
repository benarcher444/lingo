/**
 * What a conversation can be about. The AI always opens and drives; the scene
 * decides what it opens with and who it plays.
 *
 *   general   the default: an open chat the AI starts and keeps moving
 *   surprise  the original app's roleplay: an everyday situation of its choosing
 *   custom    whatever the learner describes
 *
 * The rest are fixed scenes. The page's dropdown and the partner prompt both
 * read from here, so adding a scene is one entry.
 */
export const SCENES = {
  general: { label: "General conversation", scene: null },
  surprise: {
    label: "Surprise me",
    scene:
      "an everyday situation of your choosing. Pick one at random, set it up, and start talking to me as if we were in it",
  },
  restaurant: {
    label: "At a restaurant",
    scene: "a restaurant. You are the waiter; I have just sat down to order a meal",
  },
  cafe: {
    label: "At a café",
    scene: "a café. You are behind the counter; I want a drink and something to eat",
  },
  shop: {
    label: "In a shop or market",
    scene: "a shop or market stall. You are the shopkeeper; I am looking for something to buy",
  },
  hotel: {
    label: "Checking into a hotel",
    scene: "a hotel reception. You are the receptionist; I have just arrived to check in",
  },
  directions: {
    label: "Asking for directions",
    scene: "a street in town. You are a local; I stop you to ask the way somewhere",
  },
  station: {
    label: "At the train station",
    scene: "a train station ticket office. You sell tickets; I need to travel somewhere",
  },
  pharmacy: {
    label: "At the pharmacy",
    scene: "a pharmacy. You are the pharmacist; I am not feeling well",
  },
  friend: {
    label: "Meeting someone new",
    scene: "a party. You are a friendly stranger who starts chatting to me",
  },
  custom: { label: "My own scene…", scene: null },
} as const;

export type SceneKey = keyof typeof SCENES;
export const SCENE_KEYS = Object.keys(SCENES) as [SceneKey, ...SceneKey[]];

/** CEFR levels the tutor can pitch at. A1 is the default, as in the original app. */
export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * What each level actually allows, spelled out.
 *
 * "Match your vocabulary and grammar to level A1" is not an instruction a model
 * follows: an A1 conversation came back with a conditional perfect, which the
 * same model then called B2 when asked. So each level names the tenses it may
 * use, the ones it may not, and how long a sentence may run.
 *
 * Used by the conversation partner and by translation practice, so both pitch
 * the same way.
 */
export const LEVEL_RULES: Record<Level, string> = {
  A1: `Present tense only, plus the handful of set phrases a beginner meets
("there is/are", "I would like", "let's go"). No past tenses of any kind, no
future tense, no conditional, no subjunctive, no perfect or compound tenses, no
passive, no reported speech. Only the commonest few hundred words, the sort a
first course teaches: family, food, home, work, days, weather, likes. Sentences
of at most eight words, two per message.`,
  A2: `Present, the simple past, the present perfect, and the near future
("going to"). No conditional, no subjunctive, no compound past tenses beyond
the present perfect, no passive. Everyday vocabulary of roughly a thousand
words. Sentences of at most twelve words, two or three per message.`,
  B1: `Present, past, imperfect, present perfect, future, and the conditional
for polite requests and simple hypotheticals. The present subjunctive only in
the fixed expressions a B1 course teaches. No compound conditionals, no past
subjunctive, no literary tenses. Everyday and familiar-topic vocabulary.
Sentences of at most fifteen words.`,
  B2: `Any common tense, including the subjunctive and compound forms, used
where they naturally belong. Idioms are fine if they are current. Keep it
conversational rather than literary.`,
  C1: `Any structure, including less common tenses, idiom and nuance. Still
spoken register, not written prose.`,
};

/**
 * Pitching rules, as a block for a system prompt. The re-read is deliberate:
 * stating the rules alone does not stop a model reaching for a tense it likes.
 */
export function levelBrief(level: Level): string {
  return `The learner is level ${level}. That is a hard limit, not a preference:

${LEVEL_RULES[level]}

Before you send a message, re-read it. If any verb form, structure or word sits
above ${level}, rewrite it in something the learner would have been taught by
now. A plainer sentence they understand is always better than a richer one they
cannot read. Never explain the grammar unless asked — just stay inside it.`;
}
