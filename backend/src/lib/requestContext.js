import { AsyncLocalStorage } from "node:async_hooks";

// Datos de la petición en curso que hacen falta lejos del controlador, sin pasarlos de función en función. Hoy solo uno: si el
// admin marcó "Avisar a la tienda" en la acción que está haciendo (cabecera X-Notify-Vendor, ver middleware/notifyVendorChoice.js).
const storage = new AsyncLocalStorage();

export function runWithContext(ctx, fn) {
  return storage.run(ctx, fn);
}

export function requestContext() {
  return storage.getStore() ?? null;
}
