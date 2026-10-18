import { api } from "./api.js";

// Caja sin conexión (Fase 2 de la PWA). Las operaciones del local que no pueden esperar a que vuelva internet (ventas manuales,
// cuentas de mesa, cierre de caja) pasan por aquí:
//  - con conexión se envían al momento, como siempre;
//  - si no hay conexión (o se cae a mitad), se guardan en este dispositivo y se envían solas, en el mismo orden, al volver;
//  - cada operación lleva una clave única (Idempotency-Key): si el servidor ya la había recibido, no la registra dos veces.
// Lo que el servidor rechaza al sincronizar (por ejemplo, ya no queda stock) queda en "No se pudieron enviar" con el motivo, para
// que la persona lo revise; nunca se pierde en silencio.
const STORE_KEY = "baznova-offline-queue";
export const SYNC_EVENT = "baznova:offline-sync";

let currentUserId = null;
let syncing = false;
const listeners = new Set();

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { pending: Array.isArray(data.pending) ? data.pending : [], failed: Array.isArray(data.failed) ? data.failed : [] };
  } catch {
    return { pending: [], failed: [] };
  }
}

function write(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* almacenamiento lleno o bloqueado: la operación sigue en memoria hasta recargar */
  }
  emit();
}

function mine(list) {
  return list.filter((op) => op.userId === currentUserId);
}

export function queueStatus() {
  const { pending, failed } = read();
  return { pending: mine(pending), failed: mine(failed), syncing, online: navigator.onLine !== false };
}

function emit() {
  const status = queueStatus();
  listeners.forEach((fn) => fn(status));
}

export function onQueueChange(fn) {
  listeners.add(fn);
  fn(queueStatus());
  return () => listeners.delete(fn);
}

// La cola es de cada persona: si en el mismo dispositivo entra otra cuenta, lo pendiente de la anterior espera a que vuelva.
export function setQueueUser(userId) {
  currentUserId = userId ?? null;
  emit();
  if (currentUserId) void flushQueue();
}

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`);
// Sin respuesta, o el servidor caído un momento (reinicio, despliegue): se reintenta luego. Con la clave única es seguro.
const isNetworkError = (err) => !err?.response || [502, 503, 504].includes(err.response.status);

// Envía la operación; sin conexión la guarda. Devuelve { queued: false, data } o { queued: true }. Los rechazos del servidor
// (datos inválidos, sin permiso...) se lanzan como siempre, para que la pantalla los muestre.
export async function offlineRequest({ method, url, data, label }) {
  const op = { key: newKey(), method, url, data: data ?? null, label, userId: currentUserId, at: Date.now() };
  if (navigator.onLine === false || read().pending.some((p) => p.userId === currentUserId)) {
    // Si ya hay operaciones esperando, esta va detrás de ellas para respetar el orden (no se adelanta).
    enqueue(op);
    void flushQueue();
    return { queued: true };
  }
  try {
    const res = await api.request({ method, url, data, headers: { "Idempotency-Key": op.key } });
    return { queued: false, data: res.data };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueue(op);
    return { queued: true };
  }
}

function enqueue(op) {
  const state = read();
  state.pending.push(op);
  write(state);
}

export async function flushQueue() {
  if (syncing || navigator.onLine === false || !currentUserId) return;
  syncing = true;
  emit();
  let sent = 0;
  try {
    for (;;) {
      const state = read();
      const op = state.pending.find((p) => p.userId === currentUserId);
      if (!op) break;
      try {
        await api.request({ method: op.method, url: op.url, data: op.data ?? undefined, headers: { "Idempotency-Key": op.key } });
        const next = read();
        next.pending = next.pending.filter((p) => p.key !== op.key);
        write(next);
        sent++;
      } catch (err) {
        if (isNetworkError(err)) break; // sigue sin conexión: se reintenta más tarde
        const status = err.response.status;
        if (status === 409 && err.response.data?.retry) break; // el servidor aún la procesa
        if (status === 401) break; // sesión vencida: espera a que la persona vuelva a entrar
        const next = read();
        next.pending = next.pending.filter((p) => p.key !== op.key);
        next.failed.push({ ...op, error: err.response.data?.error ?? `Error ${status}`, failedAt: Date.now() });
        write(next);
      }
    }
  } finally {
    syncing = false;
    emit();
    if (sent) window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { sent } }));
  }
}

export function discardFailed(key) {
  const state = read();
  state.failed = state.failed.filter((f) => f.key !== key);
  write(state);
}

// Reintentar una que falló: vuelve al final de la cola con una clave nueva (la vieja ya quedó registrada como rechazada).
export function retryFailed(key) {
  const state = read();
  const op = state.failed.find((f) => f.key === key);
  if (!op) return;
  state.failed = state.failed.filter((f) => f.key !== key);
  const { error: _e, failedAt: _f, ...rest } = op;
  state.pending.push({ ...rest, key: newKey() });
  write(state);
  void flushQueue();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    emit();
    void flushQueue();
  });
  window.addEventListener("offline", emit);
  // Otra pestaña del mismo panel cambió la cola.
  window.addEventListener("storage", (e) => e.key === STORE_KEY && emit());
  setInterval(() => void flushQueue(), 30_000);
}

// Mensaje común cuando una operación quedó guardada para enviarse después.
export const QUEUED_TITLE = "Guardado sin conexión";
export const QUEUED_TEXT = "Se enviará solo cuando vuelva internet. Lo ves arriba, en pendientes.";
