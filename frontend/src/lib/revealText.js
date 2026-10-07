// Pedido explícito: al terminar de grabar, el audio NO se envía solo; el texto
// transcrito aparece en la caja de escritura, palabra por palabra (como si se
// estuviera escribiendo), y la persona lo revisa y lo envía cuando quiera.
// `append` recibe cada trozo nuevo; el total tarda como máximo ~900 ms aunque el
// texto sea largo. Con "reducir movimiento" el texto aparece de una vez.
export function revealText(full, append) {
  const text = String(full ?? "").trim();
  if (!text) return Promise.resolve();
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    append(text, true);
    return Promise.resolve();
  }
  const words = text.split(/\s+/);
  const step = Math.max(18, Math.min(60, Math.floor(900 / words.length)));
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      append(words[i], i === 0);
      i++;
      if (i >= words.length) resolve();
      else setTimeout(tick, step);
    };
    tick();
  });
}

// Une el trozo al texto que ya había en la caja (con un espacio de por medio).
export function appendWord(prev, word, first) {
  const base = first ? (prev ? `${String(prev).trimEnd()} ` : "") : `${prev} `;
  return `${base}${word}`;
}
