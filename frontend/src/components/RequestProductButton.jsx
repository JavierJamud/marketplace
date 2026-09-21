import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

// Bloque 109 (pedido explícito — "para solicitar un producto el cliente
// debe estar logueado, así el vendedor recibe los datos del cliente que lo
// solicitó y puede contactarlo cuando lo tenga disponible"): antes
// aceptaba un guestId anónimo (localStorage) para que un visitante sin
// cuenta también pudiera pedirlo — el vendedor recibía la solicitud sin
// ningún dato real de contacto, inútil para "avisarle cuando esté
// disponible". Ahora exige sesión (el backend también lo exige, ver
// products.routes.js/products.controller.js — esto es además, no en vez
// de, esa validación real del lado del servidor): sin login, el clic
// manda al cliente a iniciar sesión con retorno automático a esta misma
// página, mismo patrón ya usado para dejar una reseña (Product.jsx/Store.jsx).
export function RequestProductButton({ productId, alreadyRequested = false, size = "md", className = "" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Bloque 109: si el backend ya avisó que este cliente tenía una
  // solicitud pendiente de este producto (ver alreadyRequested en
  // getProductBySlug), el botón arranca directo en "done" — nunca hace
  // falta un clic real para saberlo la primera vez que carga la página.
  const [state, setState] = useState(alreadyRequested ? "done" : "idle"); // idle | sending | done

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle") return;

    if (!user) {
      navigate(`/cuenta?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }

    setState("sending");
    try {
      const { data } = await api.post(`/products/${productId}/request`);
      toast.success(
        data.duplicate
          ? "Ya habías solicitado este producto — la tienda ya lo sabe."
          : "Listo, le avisamos a la tienda que te interesa este producto."
      );
      setState("done");
    } catch {
      toast.error("No se pudo enviar tu solicitud. Prueba de nuevo.");
      setState("idle");
    }
  }

  // Bloque 110 (pedido explícito): "ya solicitado" deja de verse igual que
  // el botón normal (mismo gris, solo cambiaba el ícono/texto) — ahora
  // lleva borde y tono amarillo/ámbar (#8a5100, el mismo tono ya
  // establecido en el proyecto para "bajo stock"/estados de aviso, ver
  // STATUS_STYLE.low en VendorProducts.jsx) para que se note de un vistazo
  // que ya está enviado, sin tener que leer el texto.
  const doneStyle = "border-2 border-[#8a5100] bg-[#8a5100]/10 text-[#8a5100]";
  const idleStyle = "bg-surface-container-high text-on-surface-variant hover:brightness-95";

  if (size === "sm") {
    return (
      <button
        onClick={handleClick}
        disabled={state !== "idle"}
        title="Solicitar este producto"
        className={`flex h-[34px] flex-shrink-0 items-center gap-1 rounded px-2.5 text-[11px] font-bold disabled:cursor-not-allowed ${
          state === "done" ? doneStyle : `${idleStyle} disabled:opacity-70`
        } ${className}`}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
        {state === "done" ? "Solicitado" : "Solicitar"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={state !== "idle"}
      className={`mb-2 flex h-12 w-full items-center justify-center gap-2 rounded text-label-md font-bold disabled:cursor-not-allowed ${
        state === "done" ? doneStyle : `${idleStyle} disabled:opacity-70`
      } ${className}`}
    >
      {state === "done" ? <Check className="h-[18px] w-[18px]" /> : <Bell className="h-[18px] w-[18px]" />}
      {state === "done" ? "Solicitado — te avisamos cuando esté disponible" : "Solicitar este producto"}
    </button>
  );
}
