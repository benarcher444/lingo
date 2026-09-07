/**
 * Drives the practice loop in the browser. The server judges every answer and
 * owns all progress writes; this file only sequences the questions and renders.
 */

const config = window.__practice;

const setupEl = document.getElementById("setup");
const overviewEl = document.getElementById("overview");
const quizEl = document.getElementById("quiz");
const summaryEl = document.getElementById("summary");
const form = document.getElementById("setup-form");

/** Session state. */
let cards = [];
let current = null;
let totalQuestions = 0;
let answered = 0;
let rightFirstTime = 0;
let wrong = 0;
let learntNow = 0;
let awaitingContinue = false;
/** Active while a miss is on screen, so `y` can override it. Removed after. */
let overrideKeyHandler = null;

/**
 * Naming the languages both ways round says which direction you are going
 * faster than "to"/"from" does. Each also gets its own colour (see the
 * data-direction rules in styles.css), so the card reads before you do.
 */
const DIRECTION_LABEL = {
  to_english: `${config.languageName ?? "Target"} → English`,
  from_english: `English → ${config.languageName ?? "Target"}`,
  listen: `${config.languageName ?? "Target"} heard → English`,
};

/* ------------------------------------------------------------------
   Session size
   ------------------------------------------------------------------ */

const countInput = document.getElementById("count");
const countHint = document.getElementById("count-hint");
const typeSelect = document.getElementById("wordType");

/** Words available for whichever category is currently chosen. */
function availableCount() {
  const chosen = typeSelect?.value;
  if (!chosen) return config.total;
  return config.countsByType?.[chosen] ?? config.total;
}

function refreshCountHint() {
  if (!countInput || !countHint) return;

  const available = availableCount();
  countInput.max = String(available);

  const asked = Number(countInput.value);

  if (!countInput.value.trim() || asked === 0) {
    countHint.textContent = `All ${available} words`;
  } else if (asked >= available) {
    countHint.textContent = `All ${available} available`;
  } else {
    countHint.textContent = `${available} available`;
  }
}

countInput?.addEventListener("input", refreshCountHint);
typeSelect?.addEventListener("change", () => {
  // Keep the number sensible when switching to a smaller category.
  const available = availableCount();
  if (Number(countInput?.value) > available) countInput.value = String(available);
  refreshCountHint();
});
refreshCountHint();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const wordTypeId = data.get("wordTypeId");

  const response = await fetch("/api/practice/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      languageId: config.languageId,
      mode: config.mode,
      wordTypeId: wordTypeId ? Number(wordTypeId) : null,
      // Blank or a non-number means "everything"; the server treats 0 that way.
      count: Math.max(0, Math.floor(Number(data.get("count")) || 0)),
    }),
  });

  if (!response.ok) {
    quizEl.hidden = false;
    quizEl.innerHTML = `<div class="alert alert-error">Could not start the session. Reload and try again.</div>`;
    return;
  }

  const payload = await response.json();
  cards = payload.cards ?? [];

  if (cards.length === 0) {
    quizEl.hidden = false;
    quizEl.innerHTML = `<div class="alert alert-info">No words matched that selection.</div>`;
    return;
  }

  totalQuestions = cards.reduce((sum, card) => sum + card.pending.length, 0);
  answered = 0;
  rightFirstTime = 0;
  wrong = 0;
  learntNow = 0;

  // Clear the page down to just the quiz card so the question has full focus.
  setupEl.hidden = true;
  if (overviewEl) overviewEl.hidden = true;
  summaryEl.hidden = true;
  quizEl.hidden = false;

  nextQuestion();
});

function remainingQuestions() {
  return cards.reduce((sum, card) => sum + card.pending.length, 0);
}

function nextQuestion() {
  const live = cards.filter((card) => card.pending.length > 0);

  if (live.length === 0) {
    finish();
    return;
  }

  const card = live[Math.floor(Math.random() * live.length)];
  const direction = card.pending[Math.floor(Math.random() * card.pending.length)];

  current = { card, direction, revealed: false };
  render();
}

function promptFor(card, direction) {
  if (direction === "to_english") return card.term;
  if (direction === "from_english") return card.english;
  return null; // audio: nothing to show until it is spoken
}

function render() {
  const { card, direction } = current;
  const prompt = promptFor(card, direction);
  const done = totalQuestions - remainingQuestions();
  const pct = totalQuestions > 0 ? (100 * done) / totalQuestions : 0;

  quizEl.innerHTML = `
    <div class="quiz-shell">
      <div class="quiz-progress">
        <span>${done} / ${totalQuestions}</span>
        <span class="bar"><i class="learnt" style="width:${pct.toFixed(1)}%"></i></span>
        <span>${remainingQuestions()} left</span>
      </div>

      <div class="quiz-card" data-direction="${direction}">
        <span class="quiz-direction">${DIRECTION_LABEL[direction]}</span>

        ${
          prompt === null
            ? `<button class="audio-btn" id="speak" type="button" aria-label="Play the word">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>
                 </svg>
               </button>
               <div class="quiz-meta">Tap to replay · what does it mean? · ${escapeHtml(card.wordType)}</div>`
            : `<div class="quiz-prompt">${escapeHtml(prompt)}</div>
               <div class="quiz-meta">${escapeHtml(card.wordType)}</div>`
        }

        <form class="quiz-form" id="answer-form">
          <input class="quiz-input" id="answer" autocomplete="off" autocapitalize="off"
                 autocorrect="off" spellcheck="false" placeholder="Your answer" />
          <!-- Verdict sits between the answer and the button so the result is
               read before the action that dismisses it. -->
          <div id="verdict"></div>
          <button class="btn btn-primary btn-lg" type="submit">Check</button>
        </form>
      </div>

      <div class="row" style="justify-content:center">
        <button class="btn btn-ghost btn-sm" id="end-session" type="button">End session</button>
      </div>
    </div>`;

  document.getElementById("answer-form").addEventListener("submit", onAnswer);
  document.getElementById("end-session").addEventListener("click", finish);

  const speak = document.getElementById("speak");
  if (speak) {
    speak.addEventListener("click", () => speakTerm(card.term));
    speakTerm(card.term);
  }

  document.getElementById("answer").focus();
}

async function onAnswer(event) {
  event.preventDefault();

  if (awaitingContinue) {
    proceed();
    return;
  }

  const input = document.getElementById("answer");
  // An empty answer is a legitimate "I don't know" — it is sent and recorded as
  // a miss rather than ignored. Forcing a guess would only pollute the history.
  const answer = input.value;

  const response = await fetch("/api/practice/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wordId: current.card.wordId,
      mode: config.mode,
      direction: current.direction,
      answer,
    }),
  });

  if (!response.ok) return;

  const result = await response.json();
  answered += 1;
  if (result.correct) {
    rightFirstTime += 1;
  } else {
    wrong += 1;
  }
  if (result.justLearnt) learntNow += 1;

  showVerdict(result, answer);
}

function showVerdict(result, given) {
  const verdict = document.getElementById("verdict");
  const input = document.getElementById("answer");
  input.disabled = true;

  if (result.correct) {
    // Correct clears this direction for the session.
    current.card.pending = current.card.pending.filter((d) => d !== current.direction);

    verdict.innerHTML = `
      <div class="verdict verdict-right">
        <div class="headline">Correct</div>
        <div class="answer">${escapeHtml(result.expected)}</div>
        ${result.justLearnt ? `<div class="delta up">Now counted as learnt</div>` : ""}
      </div>`;
  } else {
    const skipped = given.trim() === "";

    verdict.innerHTML = `
      <div class="verdict verdict-wrong">
        <div class="headline">${skipped ? "Skipped" : "Not quite"}</div>
        <div class="answer">${escapeHtml(result.expected)}</div>
        ${skipped ? "" : `<div class="given">${escapeHtml(given)}</div>`}
      </div>
      ${
        // "I was right" makes no sense when nothing was entered.
        skipped
          ? ""
          : `<div class="row" style="justify-content:center;margin-top:12px">
               <button class="btn btn-sm" id="override" type="button">
                 I was right — count it <kbd>Y</kbd>
               </button>
             </div>`
      }`;

    document.getElementById("override")?.addEventListener("click", () => override(given));

    // `y` overrides a miss, as it did in the original terminal app. Only bound
    // while a miss is on screen, and never for a deliberate skip.
    if (!skipped) {
      overrideKeyHandler = (event) => {
        if (event.key !== "y" && event.key !== "Y") return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!awaitingContinue) return;

        event.preventDefault();
        override(given);
      };
      document.addEventListener("keydown", overrideKeyHandler);
    }
  }

  awaitingContinue = true;

  const button = document.querySelector('#answer-form button[type="submit"]');
  button.textContent = "Continue";
  button.focus();
}

async function override(given) {
  // Unbind immediately: the request is in flight, and a second `y` would
  // record the override twice.
  releaseOverrideKey();
  awaitingContinue = false;

  await fetch("/api/practice/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wordId: current.card.wordId,
      mode: config.mode,
      direction: current.direction,
      answer: given,
      override: true,
    }),
  });

  wrong -= 1;
  rightFirstTime += 1;
  current.card.pending = current.card.pending.filter((d) => d !== current.direction);
  proceed();
}

function releaseOverrideKey() {
  if (!overrideKeyHandler) return;
  document.removeEventListener("keydown", overrideKeyHandler);
  overrideKeyHandler = null;
}

function proceed() {
  releaseOverrideKey();
  awaitingContinue = false;
  nextQuestion();
}

async function finish() {
  releaseOverrideKey();
  awaitingContinue = false;

  const response = await fetch("/api/practice/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ languageId: config.languageId, mode: config.mode }),
  });

  const payload = response.ok ? await response.json() : { summary: null };
  const summary = payload.summary;
  const accuracy = answered > 0 ? Math.round((100 * rightFirstTime) / answered) : 0;

  quizEl.hidden = true;
  summaryEl.hidden = false;
  if (overviewEl) overviewEl.hidden = true;
  summaryEl.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Session complete</h2><div class="sub">Nice work — your progress is saved.</div></div></div>
      <div class="card-body stack">
        <div class="summary-grid">
          <div class="summary-cell"><div class="value">${answered}</div><div class="label">Answered</div></div>
          <div class="summary-cell"><div class="value" style="color:var(--learnt)">${accuracy}%</div><div class="label">Accuracy</div></div>
          <div class="summary-cell"><div class="value" style="color:var(--danger)">${wrong}</div><div class="label">Missed</div></div>
          <div class="summary-cell"><div class="value" style="color:var(--accent)">${learntNow}</div><div class="label">Newly learnt</div></div>
        </div>
        ${
          summary
            ? `<div class="hint">Overall: ${summary.learnt} of ${summary.total} words learnt (${summary.pctLearnt.toFixed(1)}%), average score ${summary.averageScore.toFixed(2)}.</div>`
            : ""
        }
        <div class="row">
          <button class="btn btn-primary" id="again" type="button">Practise again</button>
          <a class="btn" href="/progress?language=${config.languageId}">View progress</a>
        </div>
      </div>
    </div>`;

  document.getElementById("again").addEventListener("click", () => {
    summaryEl.hidden = true;
    setupEl.hidden = false;
    if (overviewEl) overviewEl.hidden = false;
  });
}

/**
 * Browser speech synthesis rather than a server-side TTS service: no network
 * round trip, no audio cache to manage, and it keeps working on a Pi with no
 * internet connection.
 */
function speakTerm(text) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = config.languageCode || "en-GB";
  utterance.rate = 0.9;

  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang?.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));

  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

// Voices load asynchronously in most browsers.
if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
