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
