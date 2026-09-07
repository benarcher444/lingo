/**
 * Accent entry for text inputs.
 *
 * Type the plain letter, then the accent key:  e '  ->  é
 * Press the accent key twice to keep it literal: e ' '  ->  e'
 *
 * Also renders a clickable bar of the language's accents, with Alt+1…9 for the
 * first nine, so a mouse is never required.
 *
 * The composition table comes from the server and only contains letters the
 * language actually uses, so French "qu'est" is left alone.
 */

const config = window.__accents;

/** Accent keys that can follow a letter. Also the ligature second letters. */
const ACCENT_KEYS = new Set(["'", "`", "^", '"', ":", "~", ",", "/", "e", "s"]);

export function attachAccents(input) {
  if (!input || !config || Object.keys(config.compose).length === 0) return;

  input.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1) return;
    if (!ACCENT_KEYS.has(event.key)) return;

    const { selectionStart, selectionEnd, value } = input;
    // Only when the caret is a plain cursor sitting after at least one letter.
    if (selectionStart === null || selectionStart !== selectionEnd || selectionStart < 1) return;

    const previous = value[selectionStart - 1];
    if (!previous) return;

    // The table also holds the reverse: pressing the accent key on an already
    // accented letter maps back to the literal pair, so e ' ' gives e'.
    const replacement = config.compose[previous + event.key];
    if (!replacement) return;

    event.preventDefault();

    const head = value.slice(0, selectionStart - 1);
    const tail = value.slice(selectionEnd);
    input.value = head + replacement + tail;

    const caret = head.length + replacement.length;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Builds the accent bar and wires it to whichever input was last focused, so
 * clicking a character does not steal focus from where you were typing.
 */
export function buildAccentBar(container, inputs) {
  if (!container || !config || config.bar.length === 0) return;

  let lastFocused = inputs[0] ?? null;
  for (const input of inputs) {
    input.addEventListener("focus", () => {
      lastFocused = input;
    });
  }

  const bar = document.createElement("div");
  bar.className = "accent-bar";

  const label = document.createElement("span");
  label.className = "accent-bar-label";
  label.textContent = "Accents";
  bar.append(label);

  config.bar.forEach((character, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "accent-key";
    button.textContent = character;

    if (index < 9) {
      button.title = `${character}  (Alt+${index + 1})`;
      const hint = document.createElement("sub");
      hint.textContent = String(index + 1);
      button.append(hint);
    } else {
      button.title = character;
    }

    // mousedown, not click: preventDefault here stops the button taking focus,
    // so the caret stays in the text field.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      insert(character);
    });

    bar.append(button);
  });

  const hint = document.createElement("span");
  hint.className = "accent-bar-hint";
  hint.textContent = "or type e then ' for é";
  bar.append(hint);

  container.append(bar);

  // Alt+1…9 inserts the first nine without leaving the keyboard.
  for (const input of inputs) {
    input.addEventListener("keydown", (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      const index = Number(event.key) - 1;
      const character = config.bar[index];
      if (!Number.isInteger(index) || index < 0 || index > 8 || !character) return;

      event.preventDefault();
      lastFocused = input;
      insert(character);
    });
  }

  function insert(character) {
    const input = lastFocused;
    if (!input) return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;

    input.value = input.value.slice(0, start) + character + input.value.slice(end);

    const caret = start + character.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
