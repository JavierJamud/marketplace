import { generateId } from "../lib/uuid.js";
import { useState } from "react";
import { Bell, Check } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const GUEST_ID_KEY = "zeudin_guest_id";

// Identidad anónima para el dedup de 24h del backend cuando no hay sesión —
// mismo patrón que getOrCreateSessionId en StoreChatWidget.jsx (uuid en
// localStorage), en vez de pedir un email a mano que rompería el "un solo
// click, sin carrito ni checkout" pedido para este botón.
function getOrCreateGuestId() {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

// Bloque 23: reemplaza "Agregar al carrito" cuando un producto tiene
// stock = 0 — no arma pedido, solo registra interés para que el vendedor
// sepa qué reponer primero (ver VendorProducts.jsx). El backend ya
// deduplica el mismo clic dentro de 24h; acá solo se evita reenviar
// mientras la request está en vuelo o ya confirmó, para no spamear el
// mismo click repetido en el momento.
export function RequestProductButton({ productId, size = "md", className = "" }) {
  const { user } = useAuth();
  const [state, setState] = useState("idle"); // idle | sending | done

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle") return;
    setState("sending");
    try {
      await api.post(`/products/${productId}/request`, user ? {} : { guestId: getOrCreateGuestId() });
      toast.success("Listo, le avisamos a la tienda que te interesa este producto.");
      setState("done");
    } catch {
      toast.error("No se pudo enviar tu solicitud. Prueba de nuevo.");
      setState("idle");
    }
  }

  if (size === "sm") {
    return (
      <button
        onClick={handleClick}
        disabled={state !== "idle"}
        title="Solicitar este producto"
        className={`flex h-[34px] flex-shrink-0 items-center gap-1 rounded bg-surface-container-high px-2.5 text-[11px] font-bold text-on-surface-variant hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
        {state === "done" ? "Enviado" : "Solicitar"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={state !== "idle"}
      className={`mb-2 flex h-12 w-full items-center justify-center gap-2 rounded bg-surface-container-high text-label-md font-bold text-on-surface-variant hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
    >
      {state === "done" ? <Check className="h-[18px] w-[18px]" /> : <Bell className="h-[18px] w-[18px]" />}
      {state === "done" ? "¡Listo! Le avisamos a la tienda" : "Solicitar este producto"}
    </button>
  );
}
