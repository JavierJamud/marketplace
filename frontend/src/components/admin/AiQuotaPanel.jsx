import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { api } from "../../lib/api.js";

// Bloque 280 (pedido explícito): consumo del plan gratis de cada API de IA, en el
// orden en que se usan (Groq → NVIDIA → Gemini). Cuando una se acerca a su límite
// el sistema pasa a la siguiente; si todas están en el límite, el chatbot se oculta
// hasta que alguna se renueve. Las cifras "de la API" las informa el propio
// proveedor; las "estimadas" las cuenta la plataforma.

const PERIOD = { minute: "por minuto", day: "por día" };
const KIND = { requests: "Pedidos", tokens: "Tokens" };

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function countdown(iso, now) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "renovándose";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("es"));

function UsageBar({ w, now }) {
  const pct = w.limit ? Math.min(100, Math.round(((w.limit - w.remaining) / w.limit) * 100)) : 0;
  const color = w.nearLimit ? "bg-error" : pct >= 70 ? "bg-[#E08A00]" : "bg-[#0CAE53]";
  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold text-on-surface">
          {KIND[w.kind]} {PERIOD[w.period]}
        </span>
        <span className="text-on-surface-variant">
          Usado {fmt(w.limit - w.remaining)} de {fmt(w.limit)} · quedan <strong>{fmt(w.remaining)}</strong>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-outline">
        <span>{w.source === "api" ? "Dato de la API" : "Estimado por la plataforma"}</span>
        {w.resetAt && <span>Se renueva en {countdown(w.resetAt, now)}</span>}
      </div>
    </div>
  );
}

export default function AiQuotaPanel() {
  const now = useNow();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ai-quota"],
    queryFn: async () => (await api.get("/admin/ai-quota")).data,
    refetchInterval: 10_000,
  });

  return (
    <section className="mb-[22px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5" aria-labelledby="ai-quota-title">
      <div className="mb-1 flex items-center gap-2">
        <Gauge size={18} className="text-tertiary-accent" aria-hidden="true" />
        <h2 id="ai-quota-title" className="font-display text-[17px] font-bold text-on-surface">
          Consumo del plan gratis de IA
        </h2>
      </div>
      <p className="mb-3 text-[12.5px] text-on-surface-variant">
        Se usa primero Groq, después NVIDIA y por último Gemini, y solo modelos de su plan gratis. Cuando a una le queda
        el 10 % de su cupo, se pasa a la siguiente sin gastar más; vuelve sola cuando el cupo se renueva. Si una API
        responde que la cuenta es de pago, se apaga sola y te llega un correo.
      </p>

      {isLoading && <p className="text-[12.5px] text-outline">Cargando consumo…</p>}
      {isError && <p className="text-[12.5px] text-error">No se pudo leer el consumo de las API.</p>}

      {data?.allExhausted && (
        <div className="mb-3 rounded-[10px] bg-error/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-error" role="status">
          Todas las IA están en su límite gratis. El chatbot está oculto en la tienda y en los paneles
          {data.nextResetAt ? ` hasta dentro de ${countdown(data.nextResetAt, now)}` : " hasta que alguna se renueve"}.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(data?.providers ?? []).map((p) => (
          <div key={p.provider} className="rounded-xl border border-outline-variant p-3.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-bold text-on-surface">
                {p.order}. {p.label}
              </span>
              {!p.enabled ? (
                <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">Desactivada</span>
              ) : p.available ? (
                <span className="rounded-full bg-[#0CAE53]/10 px-2 py-0.5 text-[11px] font-bold text-[#087A38]">Con cupo</span>
              ) : (
                <span className="rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-bold text-error">
                  En el límite{p.resumesAt ? ` · vuelve en ${countdown(p.resumesAt, now)}` : ""}
                </span>
              )}
            </div>
            {p.info && (
              <div className="mb-2 text-[12px] text-on-surface-variant">
                <p>
                  <strong>Plan gratis:</strong> {p.info.plan}
                </p>
                <p className="mt-0.5 text-outline">
                  {p.info.source}{" "}
                  <a href={p.info.dashboardUrl} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent hover:underline">
                    Ver límites en su panel
                  </a>
                </p>
              </div>
            )}
            {p.enabled &&
              p.models.map((m) => (
                <div key={m.model} className="mb-3 border-t border-surface-container pt-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="break-all font-mono text-[12px] text-on-surface">{m.model}</span>
                    <span className="text-[11px] text-outline">
                      {m.purpose} · hoy {fmt(m.todayRequests)} pedidos, {fmt(m.todayTokens)} tokens
                    </span>
                  </div>
                  {!m.available && (
                    <p className="mb-1.5 text-[12px] font-semibold text-error">
                      {m.reason}
                      {m.resumesAt ? ` — vuelve en ${countdown(m.resumesAt, now)}` : ""}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {m.windows.length === 0 ? (
                      <p className="text-[12px] text-outline">Sin límites conocidos todavía: se leerán de la API con el primer uso.</p>
                    ) : (
                      m.windows.map((w) => <UsageBar key={`${w.kind}-${w.period}`} w={w} now={now} />)
                    )}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}
