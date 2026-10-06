/**
 * Translation practice. The server composes a sentence from your own words and
 * marks what you write; this file only sequences the rounds and renders.
 *
 * The model answer is not sent until the round is marked, so it cannot be read
 * out of the page while you are still writing.
 */

const config = window.__translate;

const setup = document.getElementById("tr-setup");
const round = document.getElementById("tr-round");
const englishEl = document.getElementById("tr-english");
const wordsEl = document.getElementById("tr-words");
const hintButton = document.getElementById("tr-hint");
const form = document.getElementById("tr-form");
const answer = document.getElementById("tr-answer");
const checkButton = document.getElementById("tr-check");
const skipButton = document.getElementById("tr-skip");
const result = document.getElementById("tr-result");

let roundId = null;
let busy = false;

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const settings = () => ({
  languageId: config.languageId,
  count: Number(document.getElementById("tr-count").value),
  level: document.getElementById("tr-level").value,
  weighting: document.getElementById("tr-weighting").value,
});

/** Every failure the server can report, in words worth reading. */
function explain(status, body) {
  if (status === 402) return "The AI account is out of credit. Add credit and try again.";
  if (status === 403) return "Translation practice isn't switched on for your account.";
  if (status === 429) return "The AI is busy. Give it a moment and try again.";
  if (status === 410) return "That round expired. Start a new sentence.";
  if (body && body.error === "no_words") return "There are no words to build a sentence from yet.";
  return "That didn't work. Try again in a moment.";
}

function showError(message) {
  result.innerHTML = `<div class="alert alert-error" style="margin-top:14px">${escapeHtml(message)}</div>`;
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function newRound() {
  if (busy) return;
  busy = true;
  result.innerHTML = "";
  answer.value = "";
  wordsEl.hidden = true;
  hintButton.hidden = false;
  englishEl.textContent = "…";
  round.hidden = false;
  answer.disabled = true;
  checkButton.disabled = true;

  const { ok, status, body } = await post("/api/sentences/round", settings());
  busy = false;

  if (!ok) {
    englishEl.textContent = "";
    showError(explain(status, body));
    return;
  }

  roundId = body.roundId;
  englishEl.textContent = body.english;
  wordsEl.innerHTML = body.words
    .map((w) => `<span class="pill pill-plain">${escapeHtml(w.term)}</span>`)
    .join(" ");
  answer.disabled = false;
  checkButton.disabled = false;
  answer.focus();
}

function verdictCard(data) {
  const label = { right: "Right", close: "Nearly", wrong: "Not quite" }[data.verdict] ?? "Marked";
  const tone = data.verdict === "right" ? "right" : data.verdict === "close" ? "close" : "wrong";

  const notes = (data.notes ?? [])
    .filter((n) => n.wrote || n.better)
    .map(
      (n) => `
      <div class="tr-note">
        <span class="tr-note-wrote">${escapeHtml(n.wrote)}</span>
        <span class="tr-note-arrow" aria-hidden="true">→</span>
        <span class="tr-note-better">${escapeHtml(n.better)}</span>
        ${n.why ? `<div class="tr-note-why">${escapeHtml(n.why)}</div>` : ""}
      </div>`,
    )
    .join("");

  return `
    <div class="tr-verdict tr-verdict-${tone}">
      <div class="headline">${label}</div>
      ${data.comment ? `<div class="tr-comment">${escapeHtml(data.comment)}</div>` : ""}
    </div>
    ${notes ? `<div class="tr-notes">${notes}</div>` : ""}
    <div class="tr-model">
      <div class="tr-label">One way to say it</div>
      <div class="tr-model-text">${escapeHtml(data.model)}</div>
    </div>`;
}

setup?.addEventListener("submit", (event) => {
  event.preventDefault();
  newRound();
});

hintButton?.addEventListener("click", () => {
  wordsEl.hidden = false;
  hintButton.hidden = true;
});

skipButton?.addEventListener("click", () => newRound());

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !roundId || !answer.value.trim()) return;

  busy = true;
  checkButton.disabled = true;
  result.innerHTML = `<div class="hint" style="margin-top:14px">Marking…</div>`;

  const { ok, status, body } = await post("/api/sentences/check", { roundId, answer: answer.value });
  busy = false;
  checkButton.disabled = false;

  if (!ok) {
    showError(explain(status, body));
    return;
  }

  // The words are worth seeing once it is marked, whether or not you asked.
  wordsEl.hidden = false;
  hintButton.hidden = true;
  result.innerHTML = verdictCard(body);
  skipButton.focus();
});

// Enter sends; Shift+Enter is a new line, as the box can hold two sentences.
answer?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
