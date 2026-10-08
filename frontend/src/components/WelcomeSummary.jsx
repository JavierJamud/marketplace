import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../lib/api.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { useAuth } from "../context/AuthContext.jsx";

// Bloque 290 (pedido explícito — "un mensaje de bienvenida en el dashboard de vendedores, admin y
// clientes, con buenos días, buenas tardes o buenas noches, la hora y la fecha, y un resumen
// semanal de cómo va su plataforma"): dos piezas compartidas por los tres paneles.
//   - WelcomeHeading: el saludo según la hora, y la fecha y la hora actuales (se actualiza solo).
//   - WeeklySummaryCard: los últimos 7 días contra los 7 anteriores (GET /summary/weekly).
// La hora y la fecha usan la zona horaria de la plataforma (la de Cuba por defecto), no la del
// dispositivo, para que el saludo coincida con lo que se vive en el negocio.

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useTimezone() {
  const { timezone } = usePlatformSettings();
  return timezone || "America/Havana";
}

export function greetingFor(date, timeZone) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(date)) % 24;
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function formatDate(date, timeZone) {
  const text = new Intl.DateTimeFormat("es-CU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const formatTime = (date, timeZone) => new Intl.DateTimeFormat("es-CU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(date);

// `name`: a quién se saluda. `children`: línea de apoyo opcional (por defecto, la fecha y la hora).
export function WelcomeHeading({ name, subtitle, className = "" }) {
  const now = useNow();
  const timeZone = useTimezone();
  return (
    <div className={className}>
      <h1 className="mb-1 font-display text-[28px] font-extrabold tracking-tight text-on-surface">
        {greetingFor(now, timeZone)}, <span className="font-medium text-on-surface-variant">{name}</span>
      </h1>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-outline">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {formatDate(now, timeZone)}
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {formatTime(now, timeZone)}
        </span>
        {subtitle && <span>{subtitle}</span>}
      </p>
    </div>
  );
}

function formatValue(stat, currency) {
  if (stat.format === "money") return `${Number(stat.value).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
  return Number(stat.value).toLocaleString("es-CU");
}

// Cambio frente a la semana anterior. Sin base de comparación (0 la semana pasada) no se inventa
// un porcentaje: se dice "nuevo" si ahora hay actividad.
function Delta({ stat }) {
  if (stat.previous == null) return null;
  const diff = stat.value - stat.previous;
  if (diff === 0) return <span className="text-outline">Igual que la semana pasada</span>;
  if (stat.previous === 0) return <span className="font-semibold text-[#087A38]">Nuevo esta semana</span>;
  const pct = Math.round((diff / stat.previous) * 100);
  const up = diff > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-[#087A38]" : "text-error"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {up ? "+" : ""}
      {pct}% vs. semana pasada
    </span>
  );
}

// Una frase con lo más importante, armada solo con los números que devolvió el servidor.
function sentence(data) {
  const by = Object.fromEntries((data.stats ?? []).map((s) => [s.key, s]));
  const unit = (n, one, many) => `${n.toLocaleString("es-CU")} ${n === 1 ? one : many}`;
  if (data.role === "VENDOR") {
    if (by.orders.value === 0) return "Esta semana todavía no tienes pedidos. Revisa tus ofertas y que tus productos estén activos con stock.";
    const top = data.topProduct ? ` Tu producto más vendido fue ${data.topProduct.name}.` : "";
    return `Esta semana recibiste ${unit(by.orders.value, "pedido", "pedidos")} y vendiste ${formatValue(by.sales, data.currency)}.${top}`;
  }
  if (data.role === "ADMIN") {
    return `En los últimos 7 días hubo ${unit(by.orders.value, "pedido", "pedidos")}, ${unit(by.newVendors.value, "tienda nueva", "tiendas nuevas")} y ${unit(by.newCustomers.value, "cliente nuevo", "clientes nuevos")}.`;
  }
  const spent = (data.spent ?? []).map((s) => `${s.total.toLocaleString("es-CU")} ${s.currency}`).join(" y ");
  if (by.orders.value === 0) return by.active.value > 0 ? `Tienes ${unit(by.active.value, "pedido en curso", "pedidos en curso")}.` : "Esta semana no has hecho pedidos. Explora las tiendas y encuentra algo que te guste.";
  return `Esta semana hiciste ${unit(by.orders.value, "pedido", "pedidos")}${spent ? ` por ${spent}` : ""}.`;
}

export function WeeklySummaryCard({ className = "" }) {
  // La clave lleva el id de la persona: en un mismo navegador pueden entrar un admin, un vendedor y
  // un cliente, y el resumen de uno nunca debe mostrarse al siguiente (la caché de consultas se guarda).
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["weekly-summary", user?.id ?? "anon"],
    enabled: !!user,
    queryFn: async () => (await api.get("/summary/weekly")).data,
    staleTime: 10 * 60 * 1000,
  });
  if (isError) return null;
  return (
    <section className={`rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-sm ${className}`} aria-label="Resumen de la semana">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold text-on-surface">Resumen de la semana</h2>
        <span className="text-[12px] text-outline">Últimos 7 días, comparados con los 7 anteriores</span>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-xl bg-surface-container motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <>
          {/* El texto lo arma el servidor con los números y el algoritmo reales de la semana. */}
          <div className="mb-4 space-y-2 text-[13.5px] leading-[21px] text-on-surface-variant">
            {(data.narrative?.length ? data.narrative : [sentence(data)]).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data.stats.map((s) => (
              <div key={s.key} className="rounded-xl bg-surface-container px-3.5 py-3">
                <dt className="text-[11.5px] leading-4 text-on-surface-variant">{s.label}</dt>
                <dd className="mt-0.5 text-[20px] font-extrabold leading-7 tabular-nums text-on-surface">{formatValue(s, data.currency)}</dd>
                <div className="mt-0.5 text-[11.5px] leading-4">
                  <Delta stat={s} />
                </div>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
