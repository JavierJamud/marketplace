// Filtro de lo que se escribe o se pega en todo el sitio, en un solo lugar (se instala una vez en main.jsx):
//  - Campos numéricos (type="number", inputMode="numeric" o "decimal"): solo dígitos. Con decimales (type="number" o
//    inputMode="decimal") se admite un separador decimal. El signo "-" solo en campos marcados con data-allow-negative.
//    Hace falta porque Firefox deja escribir letras en type="number" y Chrome deja "e", "+" y "-".
//  - Nombres de personas (data-guard="name"): letras (con tildes y ñ), espacios, apóstrofo, guion y punto.
// Los campos de teléfono (type="tel") ya filtran por su cuenta y no se tocan. Lo que no corresponde simplemente no entra;
// al pegar, se pega solo la parte válida.

const NAME_CHAR = /[\p{L}\p{M} '’.-]/u;

function kindOf(el) {
  if (!(el instanceof HTMLInputElement) || el.type === "tel" || el.readOnly || el.disabled) return null;
  if (el.dataset.guard === "name") return "name";
  const mode = el.inputMode;
  if (el.type === "number") return mode === "numeric" ? "integer" : "decimal";
  if (mode === "numeric") return "integer";
  if (mode === "decimal") return "decimal";
  return null;
}

// Deja pasar `text` solo con los caracteres válidos para ese campo, teniendo en cuenta lo que ya tiene.
function sanitize(el, kind, text, current) {
  if (kind === "name") return [...text].filter((c) => NAME_CHAR.test(c)).join("");
  const allowNeg = el.dataset.allowNegative != null;
  const decimalSep = el.type === "number" ? /[.]/ : /[.,]/;
  let hasSep = /[.,]/.test(current);
  let out = "";
  for (const c of text) {
    if (/\d/.test(c)) out += c;
    else if (kind === "decimal" && decimalSep.test(c) && !hasSep) {
      out += c;
      hasSep = true;
    } else if (c === "-" && allowNeg && !current.includes("-") && !out.includes("-")) out += c;
  }
  return out;
}

function onBeforeInput(e) {
  if (!e.data || !(e.inputType === "insertText" || e.inputType === "insertCompositionText")) return;
  const el = e.target;
  const kind = kindOf(el);
  if (!kind) return;
  // type="number" no expone la selección; con valor vacío o reemplazado se valida contra lo que queda.
  const current = el.type === "number" ? String(el.value ?? "") : el.value.slice(0, el.selectionStart ?? 0) + el.value.slice(el.selectionEnd ?? 0);
  if (sanitize(el, kind, e.data, current) !== e.data) e.preventDefault();
}

// Asigna el valor como lo haría el teclado, para que React (que escucha el evento input) se entere del cambio.
function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function onPaste(e) {
  const el = e.target;
  const kind = kindOf(el);
  if (!kind) return;
  const text = e.clipboardData?.getData("text") ?? "";
  if (kind !== "name" && el.type === "number") {
    e.preventDefault();
    setNativeValue(el, sanitize(el, kind, text.trim(), ""));
    return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const rest = el.value.slice(0, start) + el.value.slice(end);
  const clean = sanitize(el, kind, kind === "name" ? text : text.trim(), rest);
  if (clean === text) return;
  e.preventDefault();
  setNativeValue(el, el.value.slice(0, start) + clean + el.value.slice(end));
  el.setSelectionRange?.(start + clean.length, start + clean.length);
}

let installed = false;
export function installInputGuards() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("beforeinput", onBeforeInput, true);
  document.addEventListener("paste", onPaste, true);
  // La rueda del ratón sobre un campo numérico enfocado cambiaba el valor sin querer.
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "number" && document.activeElement === e.target) e.target.blur();
    },
    { passive: true, capture: true }
  );
}
