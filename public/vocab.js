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

// Straight into typing on a desktop. Not on a phone, where focusing the field
// scrolled the page down past the top bar on every visit.
if (term?.dataset.autofocus !== undefined && window.matchMedia("(min-width: 861px)").matches) {
  term.focus();
}

// Accents apply to the target-language field only — the English column never
// needs them, and converting there would fight normal typing.
attachAccents(term);
buildAccentBar(document.getElementById("accent-bar-slot"), [term]);

// The inline edit row is rendered server-side, so wire it up if it is present.
for (const input of document.querySelectorAll("input[name=term]")) {
  if (input !== term) attachAccents(input);
}

/* ------------------------------------------------------------------
   The add form's category remembers your last choice
   ------------------------------------------------------------------ */

// Every search, sort or filter reloads the page, and the category used to reset
// each time — to nouns, the first option — part-way through a run of words.
// Remembered per language, in this browser only.
const categorySelect = document.getElementById("wordTypeId");
const languageId = form?.querySelector("input[name=language]")?.value;
const categoryKey = `lingo:add-category:${languageId}`;

if (categorySelect && languageId) {
  try {
    const saved = localStorage.getItem(categoryKey);
    if (saved && [...categorySelect.options].some((o) => o.value === saved)) {
      categorySelect.value = saved;
    }
  } catch {
    // Storage blocked (private window, site data off): the server's default stands.
  }
  categorySelect.addEventListener("change", () => {
    try {
      localStorage.setItem(categoryKey, categorySelect.value);
    } catch {
      // As above — nothing to remember with.
    }
  });
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

  row.id = `word-${word.id}`;
  row.dataset.wordId = String(word.id);

  const params = new URLSearchParams(window.location.search);
  const language = params.get("language");
  const edit = row.querySelector("a");
  edit.dataset.edit = String(word.id);
  edit.href = `/vocab?language=${language ?? ""}&edit=${word.id}#word-${word.id}`;

  tableBody.prepend(row);
}

/* ------------------------------------------------------------------
   Editing in place
   ------------------------------------------------------------------ */

// Edit, Save, Cancel and Delete swap the row where it stands. As full page
// loads they threw you back to the top every time and reset the add form, which
// made editing a run of words miserable. Without this file the links and forms
// still work, and land back on #word-<id>.

/** The display row each open editor replaced, put back on Cancel. */
const originals = new Map();

function rowFrom(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/** The list's filters, which the fragments echo into their links and fields. */
function listQuery() {
  const current = new URLSearchParams(window.location.search);
  const keep = new URLSearchParams();
  for (const key of ["language", "type", "q", "sort", "mode"]) {
    const value = current.get(key);
    if (value) keep.set(key, value);
  }
  return keep.toString();
}

async function openEditor(link) {
  const row = link.closest("tr");
  const id = link.dataset.edit;

  try {
    const response = await fetch(`/vocab/words/${id}/edit-row?${listQuery()}`, {
      headers: { "x-requested-with": "fetch" },
    });
    // A redirect means the session ended — let the real page deal with it.
    if (!response.ok || response.redirected) throw new Error("no fragment");
    const editor = rowFrom(await response.text());
    if (!editor || editor.tagName !== "TR") throw new Error("no fragment");

    originals.set(id, row);
    row.replaceWith(editor);

    const input = editor.querySelector("input[name=term]");
    if (input) {
      attachAccents(input);
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  } catch {
    window.location.href = link.href;
  }
}

function closeEditor(editor) {
  const id = editor.dataset.wordId;
  const original = originals.get(id);
  if (!original) {
    window.location.reload();
    return;
  }
  originals.delete(id);
  editor.replaceWith(original);
  original.querySelector("a[data-edit]")?.focus({ preventScroll: true });
}

function showRowError(form, message) {
  let slot = form.querySelector(".row-error");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "alert alert-error row-error";
    form.prepend(slot);
  }
  slot.textContent = message;
}

async function saveEditor(form) {
  const editor = form.closest("tr");
  const id = editor.dataset.wordId;
  editor.classList.add("is-busy");

  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: {
        "x-requested-with": "fetch",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(new FormData(form)),
    });
    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error("not json");

    if (!response.ok) {
      showRowError(form, payload.error ?? "That word could not be saved.");
      return;
    }

    originals.delete(id);
    if (payload.reload) {
      window.location.reload();
      return;
    }
    if (payload.deleted) {
      editor.remove();
      return;
    }

    const updated = rowFrom(payload.html);
    updated.classList.add("just-added");
    editor.replaceWith(updated);
    updated.querySelector("a[data-edit]")?.focus({ preventScroll: true });
  } catch {
    // Signed out, server away, anything unexpected: the ordinary post still works.
    form.submit();
  } finally {
    editor.classList.remove("is-busy");
  }
}

tableBody?.addEventListener("click", (event) => {
  // Modified clicks open the link in a new tab, as usual.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const edit = event.target.closest("a[data-edit]");
  if (edit) {
    event.preventDefault();
    openEditor(edit);
    return;
  }

  const cancel = event.target.closest("a[data-cancel]");
  if (cancel) {
    event.preventDefault();
    closeEditor(cancel.closest("tr"));
  }
});

tableBody?.addEventListener("submit", (event) => {
  // A declined delete confirmation is already cancelled by its inline handler.
  if (event.defaultPrevented) return;
  const form = event.target.closest("form[data-word-form]");
  if (!form) return;
  event.preventDefault();
  saveEditor(form);
});

tableBody?.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const editor = event.target.closest("tr.edit-row");
  if (!editor) return;
  event.preventDefault();
  closeEditor(editor);
});
