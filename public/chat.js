/**
 * Conversation page. The tutor pipeline (correct the learner's sentence, reply
 * in the target language, explain on request) lives on the server; this file
 * only handles the transcript and the compose box.
 */

const config = window.__chat;

const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");

/** Sent to the server each turn so the tutor keeps the thread. */
const history = [];

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text || !config.enabled) return;

  append({ who: "You", text, fromUser: true });
  history.push({ role: "user", content: text });

  input.value = "";
  input.disabled = true;

  const thinking = append({ who: "Tutor", text: "…" });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ languageId: config.languageId, messages: history }),
    });

    if (!response.ok) throw new Error(String(response.status));

    const payload = await response.json();
    thinking.remove();

    // Only worth showing when the interpreter actually changed something.
    if (payload.corrected && payload.corrected.trim() !== text.trim()) {
      append({ who: "Corrected", text: payload.corrected, tone: "corrected", explain: true });
    }

    append({ who: "Tutor", text: payload.reply, explain: true });
    history.push({ role: "assistant", content: payload.reply });
  } catch {
    thinking.remove();
    append({
      who: "Tutor",
      text: "Something went wrong reaching the tutor. Try again in a moment.",
      tone: "error",
    });
  } finally {
    input.disabled = false;
    input.focus();
  }
});

/**
 * Adds a message. `explain` attaches a button that asks the teacher role for an
 * English breakdown of that sentence — the third role from the original app.
 */
function append({ who, text, fromUser = false, tone = "", explain = false }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg${fromUser ? " from-user" : ""}`;

  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;

  const bubble = document.createElement("div");
  bubble.className = `bubble${tone ? ` bubble-${tone}` : ""}`;
  bubble.textContent = text;

  wrapper.append(label, bubble);

  if (explain) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-ghost explain-btn";
    button.textContent = "Explain this";
    button.addEventListener("click", () => explainSentence(text, button));
    wrapper.append(button);
  }

  log.append(wrapper);
  log.scrollTop = log.scrollHeight;

  return wrapper;
}

async function explainSentence(sentence, button) {
  button.disabled = true;
  button.textContent = "Explaining…";

  try {
    const response = await fetch("/api/chat/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ languageId: config.languageId, sentence }),
    });

    if (!response.ok) throw new Error(String(response.status));

    const payload = await response.json();
    button.remove();
    append({ who: "Breakdown", text: payload.explanation, tone: "teach" });
  } catch {
    button.disabled = false;
    button.textContent = "Explain this";
  }
}
