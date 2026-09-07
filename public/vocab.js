/**
 * Keyboard-driven word entry.
 *
 * The form still posts normally without this file — this only upgrades it so a
 * run of words can be typed without a page reload between each one:
 *
 *   type the word → Tab → type the translation → Enter → back in the first field
 *
 * Category and the mode checkboxes are set once and left alone.
 */

import { attachAccents, buildAccentBar } from "/static/accents.js";

const form = document.getElementById("add-word-form");
const term = document.getElementById("term");
const english = document.getElementById("english");
const feedback = document.getElementById("add-feedback");
const counter = document.getElementById("added-count");
const tableBody = document.querySelector("table.data tbody");

let added = 0;
let inFlight = false;

// Accents apply to the target-language field only — the English column never
// needs them, and converting there would fight normal typing.
attachAccents(term);
buildAccentBar(document.getElementById("accent-bar-slot"), [term]);

// The inline edit row is rendered server-side, so wire it up if it is present.
for (const input of document.querySelectorAll("input[name=term]")) {
  if (input !== term) attachAccents(input);
}

if (form && term && english) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inFlight) return;

    const termValue = term.value.trim();
    const englishValue = english.value.trim();

    // Focus whichever field is empty rather than firing a doomed request.
    if (!termValue) return focus(term);
    if (!englishValue) return focus(english);

    inFlight = true;
    form.classList.add("is-busy");

    const data = new FormData(form);

    try {
      const response = await fetch("/api/words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          term: termValue,
          english: englishValue,
          wordTypeId: Number(data.get("wordTypeId")),
          writtenEnabled: data.get("writtenEnabled") !== null,
          audioEnabled: data.get("audioEnabled") !== null,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        show(payload.error ?? "Could not add that word.", "error");
        // Leave the text in place so it can be corrected rather than retyped.
        focus(term);
        return;
      }

      added += 1;
      prependRow(payload.word);
      show(
        tableBody
          ? `Added “${payload.word.term}”`
          : `Added “${payload.word.term}” — refresh to see the full list`,
        "ok",
      );

      term.value = "";
      english.value = "";
      focus(term);
    } catch {
      show("Could not reach the server. Your text is still here — try again.", "error");
    } finally {
      inFlight = false;
      form.classList.remove("is-busy");
    }
  });

  // Enter from the first field moves on rather than submitting a half-filled
  // entry — so Enter always means "this pair is done".
  term.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !english.value.trim()) {
      event.preventDefault();
      focus(english);
    }
  });
}

function focus(el) {
  el.focus();
  el.select?.();
}

function show(message, kind) {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `add-feedback add-feedback-${kind}`;
  feedback.hidden = false;

  if (counter) {
    counter.textContent = `${added} added`;
    counter.hidden = added === 0;
  }
}

/**
 * Put the new word straight into the table below. The list is sorted newest
 * first, so the top is where it belongs.
 */
function prependRow(word) {
  // Until the first word exists the table is replaced by an empty state, so
  // there is nothing to prepend to. Reloading here would be worse than not
  // showing the row: it throws away focus mid-flow. The words are saved and
  // appear on the next page load.
  if (!tableBody) return;

  const row = document.createElement("tr");
  row.className = "just-added";

  const modes = [
    word.writtenEnabled ? '<span class="pill pill-plain">Written</span>' : "",
    word.audioEnabled ? '<span class="pill pill-plain">Listen</span>' : "",
  ]
    .filter(Boolean)
    .join(" ");

  row.innerHTML = `
    <td class="term"></td>
    <td class="english-cell"></td>
    <td class="col-type"><span class="pill pill-plain type-cell-name"></span></td>
    <td><span class="pill pill-new">New</span> <span class="hint num col-score">0.00</span></td>
    <td class="col-modes">${modes}</td>
    <td><a class="btn btn-sm btn-ghost" href="">Edit</a></td>`;

  // textContent, not innerHTML, so a word containing < or & cannot inject markup.
  row.querySelector(".term").textContent = word.term;
  row.querySelector(".english-cell").textContent = word.english;
  row.querySelector(".type-cell-name").textContent = word.wordTypeName;

  const params = new URLSearchParams(window.location.search);
  const language = params.get("language");
  row.querySelector("a").href = `/vocab?language=${language ?? ""}&edit=${word.id}`;

  tableBody.prepend(row);
}
