// Registro de diagnóstico para los tickets de errores visuales (ver components/vendor/ReportProblemButton.jsx). Guarda en
// memoria, nunca en el disco ni en el servidor hasta que la persona envía un reporte:
//  - una copia de la consola del navegador (log, info, warn, error y los errores sin capturar), y
//  - lo último que hizo en la página: a qué pantallas fue, qué tocó y qué pidió al servidor.
// Nunca guarda lo que se escribe en un campo (solo qué campo se tocó) y tapa cualquier cosa con forma de token o de clave.

const MAX_CONSOLE = 150;
const MAX_TRAIL = 60;
const consoleLog = [];
const trail = [];
let installed = false;

const SECRET_PATTERNS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[token oculto]"],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [oculto]"],
  [/(password|contraseña|token|secret|apikey|api_key)(["'\s:=]+)[^\s"',}]+/gi, "$1$2[oculto]"],
];

function scrub(value) {
  let s = value;
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

function stringify(arg) {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg, (_k, v) => (typeof v === "bigint" ? String(v) : v))?.slice(0, 400) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function push(list, max, entry) {
  list.push(entry);
  if (list.length > max) list.splice(0, list.length - max);
}

function addConsole(level, args) {
  push(consoleLog, MAX_CONSOLE, { level, text: scrub(args.map(stringify).join(" ")).slice(0, 600), at: new Date().toISOString() });
}

export function addTrail(kind, text) {
  push(trail, MAX_TRAIL, { kind, text: scrub(String(text)).slice(0, 300), at: new Date().toISOString() });
}

// Qué tocó la persona, en palabras: el texto o la etiqueta del botón o enlace. De un campo, solo su nombre.
function describeTarget(el) {
  const field = el.closest?.("input, textarea, select");
  if (field) {
    const label = field.getAttribute("aria-label") || field.labels?.[0]?.innerText || field.getAttribute("placeholder") || field.name || field.type;
    return `Campo: ${String(label).trim().slice(0, 60)}`;
  }
  const target = el.closest?.("button, a, [role=button], [role=tab], [role=menuitem], summary, label");
  if (!target) return null;
  const text = (target.getAttribute("aria-label") || target.innerText || target.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return `${target.tagName === "A" ? "Enlace" : "Botón"}: ${text.slice(0, 80)}`;
}

export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level]?.bind(console);
    if (!original) continue;
    console[level] = (...args) => {
      try {
        addConsole(level, args);
      } catch {
        /* el registro nunca debe romper la consola */
      }
      original(...args);
    };
  }
  window.addEventListener("error", (e) => addConsole("error", [`Error sin capturar: ${e.message}`, e.filename ? `(${e.filename}:${e.lineno})` : ""]));
  window.addEventListener("unhandledrejection", (e) => addConsole("error", ["Promesa rechazada sin capturar:", e.reason]));

  // Navegación (la app es de una sola página: se envuelven pushState/replaceState).
  addTrail("nav", window.location.pathname + window.location.search);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      addTrail("nav", window.location.pathname + window.location.search);
      return result;
    };
  }
  window.addEventListener("popstate", () => addTrail("nav", window.location.pathname + window.location.search));

  document.addEventListener(
    "click",
    (e) => {
      const text = describeTarget(e.target);
      if (text) addTrail("click", text);
    },
    { capture: true, passive: true }
  );
}

// Llamada al servidor (la anota api.js al terminar cada petición).
export function recordApiCall({ method, url, status, ms }) {
  let path = String(url ?? "");
  try {
    path = new URL(path, window.location.origin).pathname;
  } catch {
    /* se deja tal cual */
  }
  addTrail("api", `${String(method ?? "get").toUpperCase()} ${path} → ${status ?? "sin respuesta"}${ms != null ? ` (${ms} ms)` : ""}`);
}

export function getDiagnostics() {
  return { consoleLog: [...consoleLog], activityTrail: [...trail] };
}
