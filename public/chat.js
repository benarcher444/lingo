/**
 * Conversation page. The tutor pipeline lives on the server (src/routes/chat.ts):
 * the interpreter corrects what you write, the partner opens and drives the
 * conversation, and the teacher explains and takes follow-up questions. This
 * file handles the setup, the transcript, speech, and the teacher threads.
 */

const config = window.__chat;

const setup = document.getElementById("chat-setup");
const sceneSelect = document.getElementById("chat-scene");
const levelSelect = document.getElementById("chat-level");
const customField = document.getElementById("chat-custom-field");
const customInput = document.getElementById("chat-custom");
const sub = document.getElementById("chat-sub");
const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const restartButton = document.getElementById("chat-restart");
const muteButton = document.getElementById("chat-mute");

const SETUP_HINT = sub?.textContent ?? "";

/** The conversation so far, sent each turn so the tutor keeps the thread. */
let history = [];
/** Scene and level, fixed once a conversation starts. */
let session = null;
let busy = false;

/* ------------------------------------------------------------------
   Speech — the original app spoke every reply, with repeat and slow
   ------------------------------------------------------------------ */

const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
const MUTE_KEY = "lingo:chat-muted";

let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  // Storage blocked: sound stays on.
}

function renderMute() {
  if (!muteButton) return;
  muteButton.setAttribute("aria-pressed", String(muted));
  const label = muteButton.querySelector("span");
  if (label) label.textContent = muted ? "Sound off" : "Sound on";
}

if (!synth && muteButton) muteButton.hidden = true;
renderMute();

muteButton?.addEventListener("click", () => {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Nothing to remember with; it holds for this visit.
  }
  if (muted) synth?.cancel();
  renderMute();
});

let chosenVoice = null;

function pickVoice() {
  if (!synth) return null;
  if (chosenVoice) return chosenVoice;
  const lang = (config.languageCode || "en-GB").toLowerCase();
  const tag = (voice) => (voice.lang || "").toLowerCase().replace("_", "-");
  const voices = synth.getVoices();
  chosenVoice =
    voices.find((v) => tag(v) === lang) ?? voices.find((v) => tag(v).startsWith(lang.slice(0, 2))) ?? null;
  return chosenVoice;
}

synth?.getVoices();
synth?.addEventListener?.("voiceschanged", () => {
  chosenVoice = null;
});

/**
 * Auto-play queues, so a correction and then the reply are heard in order.
 * `now` interrupts, for the Play and Slow buttons, which speak even when muted.
 */
function say(text, { now = false, slow = false } = {}) {
  if (!synth) return;
  if (!now && muted) return;
  if (now && (synth.speaking || synth.pending)) synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = config.languageCode || "en-GB";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = slow ? 0.6 : 0.95;
  synth.speak(utterance);
}

/**
 * One silent syllable inside the Start tap. The opener arrives after a network
 * round trip, outside the gesture, and browsers (iOS most of all) hold back
 * speech a page starts on its own. Same trick as listening practice.
 */
let warmedUp = false;
function warmUpSpeech() {
  if (warmedUp || !synth || muted) return;
  warmedUp = true;
  const utterance = new SpeechSynthesisUtterance("a");
  utterance.lang = config.languageCode || "en-GB";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.volume = 0;
  synth.speak(utterance);
}

/* ------------------------------------------------------------------
   Setup: scene, level, and your own scene
   ------------------------------------------------------------------ */

const LEVEL_KEY = "lingo:chat-level";
try {
  const saved = localStorage.getItem(LEVEL_KEY);
  if (saved && levelSelect && [...levelSelect.options].some((o) => o.value === saved)) {
    levelSelect.value = saved;
  }
} catch {
  // Storage blocked: A1, the server's default, stands.
}
levelSelect?.addEventListener("change", () => {
  try {
    localStorage.setItem(LEVEL_KEY, levelSelect.value);
  } catch {
    // As above.
  }
});

function refreshCustom() {
  if (customField) customField.hidden = sceneSelect?.value !== "custom";
}
sceneSelect?.addEventListener("change", () => {
  refreshCustom();
  if (!customField.hidden) customInput.focus();
});
refreshCustom();

/** What every request carries about this conversation. */
function base() {
  return {
    languageId: config.languageId,
    scene: session.scene,
    custom: session.custom,
    level: session.level,
  };
}

setup?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !config.enabled) return;

  const scene = sceneSelect.value;
  const custom = customInput.value.trim();
  if (scene === "custom" && !custom) {
    customInput.focus();
    return;
  }

  warmUpSpeech();
  session = { scene, custom: scene === "custom" ? custom : undefined, level: levelSelect.value };
  history = [];
  log.replaceChildren();
  setup.hidden = true;
  log.hidden = false;
  sub.textContent = `${sceneSelect.selectedOptions[0].textContent.replace("…", "")} · level ${session.level}`;

  busy = true;
  const thinking = bubble(log, { who: "Tutor", text: "…" });
  const result = await post("/api/chat/start", base());
  thinking.remove();
  busy = false;

  if (!result.ok) {
    showError(log, result);
    setup.hidden = false;
    return;
  }

  addTutor(result.data.reply);
  form.hidden = false;
  input.focus();
});

restartButton?.addEventListener("click", () => {
  synth?.cancel();
  history = [];
  session = null;
  log.replaceChildren();
  log.hidden = true;
  form.hidden = true;
  setup.hidden = false;
  sub.textContent = SETUP_HINT;
});

/* ------------------------------------------------------------------
   The conversation
   ------------------------------------------------------------------ */

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy || !session) return;

  const mine = bubble(log, { who: "You", text, fromUser: true });
  history.push({ role: "user", content: text });
  input.value = "";
  input.disabled = true;
  busy = true;

  const thinking = bubble(log, { who: "Tutor", text: "…" });
  const result = await post("/api/chat", { ...base(), messages: history });
  thinking.remove();
  busy = false;
  input.disabled = false;

  if (!result.ok) {
    // Take the turn back, so trying again does not send it twice.
    history.pop();
    mine.remove();
    input.value = text;
    showError(log, result);
    input.focus();
    return;
  }

  const { corrected, reply } = result.data;

  // As in the original: what joins the history is the corrected sentence.
  if (corrected) history[history.length - 1] = { role: "user", content: corrected };

  // Only worth showing, and saying, when the interpreter changed something.
  if (corrected && corrected.trim() !== text) {
    bubble(log, {
      who: "Corrected",
      text: corrected,
      tone: "corrected",
      speakable: true,
      teacher: `The learner wrote: "${text}". The corrected version is: "${corrected}".`,
    });
    say(corrected);
  }

  addTutor(reply);
  input.focus();
});

function addTutor(text) {
  bubble(log, { who: "Tutor", text, speakable: true, teacher: `The tutor said: "${text}"` });
  history.push({ role: "assistant", content: text });
  say(text);
}

/* ------------------------------------------------------------------
   The teacher — explains, then answers follow-ups, as long as you like
   ------------------------------------------------------------------ */

function openTeacher(anchor, context) {
  const thread = document.createElement("div");
  thread.className = "teacher-thread";
  anchor.after(thread);

  const messages = [];

  const ask = document.createElement("form");
  ask.className = "teacher-ask";
  const field = document.createElement("input");
  field.className = "input";
  field.placeholder = "Ask the teacher a follow-up…";
  field.autocomplete = "off";
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn btn-sm";
  send.textContent = "Ask";
  ask.append(field, send);

  async function turn(question) {
    if (question) {
      messages.push({ role: "user", content: question });
      bubble(thread, { who: "You", text: question, fromUser: true, before: ask });
    }
    const waiting = bubble(thread, { who: "Teacher", text: "…", tone: "teach", before: ask });
    field.disabled = true;

    const result = await post("/api/chat/teacher", {
      languageId: config.languageId,
      level: session?.level ?? "A1",
      context,
      messages,
    });

    waiting.remove();
    field.disabled = false;

    if (!result.ok) {
      if (question) {
        messages.pop();
        field.value = question;
      }
      showError(thread, result, ask);
      if (!ask.isConnected) thread.append(ask);
      return;
    }

    messages.push({ role: "assistant", content: result.data.explanation });
    bubble(thread, { who: "Teacher", text: result.data.explanation, tone: "teach", before: ask });
    if (!ask.isConnected) thread.append(ask);
    field.focus();
  }

  ask.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = field.value.trim();
    if (!question || field.disabled) return;
    field.value = "";
    turn(question);
  });

  turn(null);
}

/* ------------------------------------------------------------------
   Messages, errors, requests
   ------------------------------------------------------------------ */

/**
 * Adds a message to `container`. `speakable` adds Play and Slow; `teacher` adds
 * "Ask the teacher", seeded with that context — the original app offered the
 * teacher after every correction and every reply.
 */
function bubble(container, { who, text, fromUser = false, tone = "", speakable = false, teacher = null, before = null }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg${fromUser ? " from-user" : ""}`;

  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;

  const body = document.createElement("div");
  body.className = `bubble${tone ? ` bubble-${tone}` : ""}`;
  body.textContent = text;

  wrapper.append(label, body);

  if ((speakable && synth) || teacher) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    if (speakable && synth) {
      actions.append(
        actionButton("Play", () => say(text, { now: true })),
        actionButton("Slow", () => say(text, { now: true, slow: true })),
      );
    }
    if (teacher) {
      const button = actionButton("Ask the teacher", () => {
        button.remove();
        openTeacher(wrapper, teacher);
      });
      actions.append(button);
    }
    wrapper.append(actions);
  }

  if (before && before.isConnected) container.insertBefore(wrapper, before);
  else container.append(wrapper);
  log.scrollTop = log.scrollHeight;
  return wrapper;
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-sm btn-ghost";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

const BILLING = {
  openai: { name: "OpenAI", url: "https://platform.openai.com/settings/organization/billing/" },
  anthropic: { name: "Anthropic", url: "https://console.anthropic.com/settings/billing" },
};

const MESSAGES = {
  no_api_key: "No AI provider is set up yet, so the tutor can't reply.",
  bad_key: "The AI provider turned down the API key. It needs checking in the server's settings.",
  rate_limited: "The AI provider is busy right now. Wait a few seconds and try again.",
  describe_scene: "Describe your scene first.",
  ai_not_allowed: "Conversation isn't switched on for your account. Ask the site owner to turn it on.",
};

/**
 * Says what went wrong in terms you can act on. Running out of credit is the
 * one that needs the owner, so it names the provider and links to its billing.
 */
function showError(container, { status, data }, before = null) {
  const kind = data?.error;

  if (kind === "no_credit") {
    const message = bubble(container, {
      who: "Tutor",
      text: "The AI account has run out of credit, so the tutor can't reply.",
      tone: "error",
      before,
    });
    const note = document.createElement("div");
    note.className = "bubble-note";
    const billing = BILLING[data.provider];
    if (billing) {
      const link = document.createElement("a");
      link.href = billing.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `${billing.name}'s billing page`;
      note.append("Add credit on ", link, ", then try again.");
    } else {
      note.textContent = "Add credit with the AI provider, then try again.";
    }
    message.querySelector(".bubble").append(note);
    return;
  }

  bubble(container, {
    who: "Tutor",
    text:
      MESSAGES[kind] ??
      (status === 0
        ? "Couldn't reach the server. Check your connection and try again."
        : "Something went wrong reaching the tutor. Try again in a moment."),
    tone: "error",
    before,
  });
}

async function post(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}
