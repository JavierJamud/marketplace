// Algunos navegadores no dejan usar el almacenamiento del sitio: los que abren enlaces dentro de WhatsApp, Telegram o Facebook, el modo
// privado de algunos navegadores, o quien bloqueó las cookies. En ellos basta con tocar `localStorage` o `sessionStorage` para que el
// navegador lance un error ("The operation is insecure"), y como el sitio los usa en casi todas las pantallas, la página se rompía entera.
// Aquí se comprueba al arrancar (este archivo se carga antes que cualquier otro): si el almacenamiento falla, se reemplaza por uno en
// memoria que funciona igual mientras la pestaña esté abierta (no se guarda entre visitas, pero nada se rompe).
class MemoryStorage {
  #data = new Map();

  get length() {
    return this.#data.size;
  }

  key(i) {
    return [...this.#data.keys()][i] ?? null;
  }

  getItem(key) {
    return this.#data.has(String(key)) ? this.#data.get(String(key)) : null;
  }

  setItem(key, value) {
    this.#data.set(String(key), String(value));
  }

  removeItem(key) {
    this.#data.delete(String(key));
  }

  clear() {
    this.#data.clear();
  }
}

function works(name) {
  try {
    const s = window[name];
    const k = "__zd_test__";
    s.setItem(k, "1");
    s.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

for (const name of ["localStorage", "sessionStorage"]) {
  if (works(name)) continue;
  try {
    Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true, writable: true });
  } catch {
    /* si ni siquiera se puede reemplazar, el resto del sitio ya protege los accesos más críticos */
  }
}
