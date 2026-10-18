import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

// Canal en vivo con el servidor (ver backend/src/lib/realtime.js). Mientras haya sesión, la página queda escuchando:
//  - "refresh": algo cambió en la plataforma; las pantallas abiertas vuelven a pedir sus datos al instante.
//  - "notify": un aviso para la persona (pedido nuevo, cambio de estado...). Se muestra dentro de la página (ver LiveNotices).
// Se usa fetch (y no EventSource) porque hace falta enviar el token de sesión en la cabecera.
export const NOTICE_EVENT = "baznova:notice";
const REFRESH_DEBOUNCE_MS = 350;
// Consultas que no se tocan al refrescar: no cambian con la actividad y algunas son caras.
const SKIP_KEYS = new Set(["site-settings", "maintenance", "active-countries-all", "provinces", "provinces-for-country", "municipalities-for-province"]);

export function useRealtime(enabled) {
  const queryClient = useQueryClient();
  const timer = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let controller = null;
    let attempt = 0;
    let retryTimer = null;

    const refresh = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        queryClient.invalidateQueries({ predicate: (q) => !SKIP_KEYS.has(String(q.queryKey[0])), refetchType: "active" });
      }, REFRESH_DEBOUNCE_MS);
    };

    const handle = (event, data) => {
      if (event === "refresh") refresh();
      else if (event === "notify") window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: data }));
    };

    const connect = async () => {
      if (stopped) return;
      const token = localStorage.getItem("accessToken");
      if (!token) return;
      controller = new AbortController();
      try {
        const res = await fetch(`${api.defaults.baseURL}/push/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (res.status === 204) return; // PWA apagada por el admin: no se insiste.
        if (res.status === 401) {
          // Token vencido: una llamada cualquiera con axios lo renueva solo; después se vuelve a conectar.
          await api.get("/push/preferences").catch(() => {});
          throw new Error("reauth");
        }
        if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
        attempt = 0;
        // Al reconectar puede que se haya perdido algún cambio: se refrescan las pantallas abiertas.
        refresh();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            let event = "message";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              handle(event, JSON.parse(data));
            } catch {
              /* mensaje incompleto */
            }
          }
        }
        throw new Error("closed");
      } catch {
        if (stopped || controller?.signal.aborted) return;
        // Reintento con espera creciente (máximo 30 s); sin conexión se espera a que vuelva.
        attempt++;
        const wait = Math.min(30_000, 1500 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(connect, navigator.onLine === false ? 5000 : wait);
      }
    };

    const onOnline = () => {
      clearTimeout(retryTimer);
      attempt = 0;
      controller?.abort();
      connect();
    };
    window.addEventListener("online", onOnline);
    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
      controller?.abort();
    };
  }, [enabled, queryClient]);
}
