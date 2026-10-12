import { useState } from "react";
import toast from "../lib/toast.jsx";

// Cantidad de una línea del carrito, editable a mano. Se confirma al salir del campo o con Enter; el carrito nunca pasa del stock
// real del producto (it.stock; null = disponible siempre, sin tope). Si se escribe más, se deja el máximo y se avisa.
export function CartQtyInput({ item, updateQuantity, className = "" }) {
  const [draft, setDraft] = useState(null);
  const cap = item.stock === null || item.stock === undefined ? Infinity : Number(item.stock);

  function commit() {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (!n) return;
    if (Number.isFinite(cap) && n > cap) toast.error(`Solo hay ${cap} ${cap === 1 ? "unidad disponible" : "unidades disponibles"}.`);
    updateQuantity(item.productId, Math.max(1, Math.min(n, cap)), item.size);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={`Cantidad de ${item.name}`}
      value={draft ?? String(item.quantity)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`bg-transparent text-center font-semibold outline-none focus:rounded focus:bg-surface-container-lowest ${className}`}
    />
  );
}
