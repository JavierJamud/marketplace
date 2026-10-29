import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ClipboardList, Eye, Gauge, HeartHandshake, MessageCircle, Rocket, ScanBarcode, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD, CardHeader } from "../dashboard/DashboardCard.jsx";

// Secciones del panel principal que salen de los algoritmos de la plataforma (GET /vendors/me/dashboard/insights): qué hacer
// hoy, posición en el ranking, fichas a mejorar, productos vistos sin ventas, clientes que dejaron de volver, mejor momento de
// venta, caja del día y programa de fidelidad. Cada tarjeta lleva al lugar donde se actúa sobre ese dato.
export function useVendorInsights() {
  return useQuery({ queryKey: ["vendor-dashboard-insights"], queryFn: async () => (await api.get("/vendors/me/dashboard/insights")).data });
}

const fmtMoney = (n, currency) => `${Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency}`;
const imgUrl = (path) => (!path ? null : /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`);

function Thumb({ src, name }) {
  const url = imgUrl(src);
  return url ? (
    <img src={url} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" loading="lazy" />
  ) : (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container text-[13px] font-bold text-on-surface-variant">{name?.[0]}</span>
  );
}

// Lista corta de pendientes con su cantidad. Va arriba del panel: es lo primero que conviene mirar cada día.
export function TodayTodo({ insights }) {
  if (!insights) return null;
  const items = insights.todo ?? [];
  return (
    <section className={`${CARD} mb-5 p-5`} aria-label="Qué hacer hoy">
      <CardHeader icon={ClipboardList} tone={items.length ? "orange" : "green"} title="Qué hacer hoy" subtitle={items.length ? "Lo pendiente de tu tienda, de lo más urgente a lo menos" : "Nada pendiente por ahora"} />
      {items.length ? (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-container/60 focus-visible:outline-2 focus-visible:outline-primary">
                <span className="flex h-7 min-w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container px-2 text-[12.5px] font-extrabold text-on-secondary-container">{i.count}</span>
                <span className="text-[13px] text-on-surface">{i.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-verified-dark">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Pedidos atendidos, stock en orden y fichas completas.
        </p>
      )}
    </section>
  );
}

function StatTile({ icon: Icon, label, value, sub, tone = "text-on-surface", to }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-outline">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </div>
      <div className={`mt-1 font-display text-[20px] font-extrabold leading-tight ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-on-surface-variant">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={`${CARD} block p-4 hover:bg-surface-container/40`}>
      {body}
    </Link>
  ) : (
    <div className={`${CARD} p-4`}>{body}</div>
  );
}

export function InsightsTiles({ insights }) {
  if (!insights) return null;
  const { week, cashToday, loyalty, currency } = insights;
  const change = week.changePercent;
  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile
        icon={change != null && change < 0 ? TrendingDown : TrendingUp}
        label="Esta semana"
        value={fmtMoney(week.current, currency)}
        tone={change == null ? "text-on-surface" : change >= 0 ? "text-verified-dark" : "text-error"}
        sub={change == null ? (week.previous > 0 ? "" : "Sin ventas la semana anterior para comparar") : `${change >= 0 ? "+" : ""}${change} % frente a la semana anterior (${fmtMoney(week.previous, currency)})`}
      />
      <StatTile
        icon={ScanBarcode}
        label="Caja de hoy"
        value={fmtMoney(cashToday.total, currency)}
        sub={cashToday.sales ? `${cashToday.sales} ${cashToday.sales === 1 ? "venta" : "ventas"} · efectivo esperado ${fmtMoney(cashToday.cashBalance, currency)}` : "Sin ventas de mostrador hoy"}
        to="/vendedor/caja"
      />
      <StatTile
        icon={HeartHandshake}
        label="Programa de fidelidad"
        value={loyalty.enabled ? `${loyalty.withPoints} ${loyalty.withPoints === 1 ? "cliente" : "clientes"}` : "Apagado"}
        sub={loyalty.enabled ? `${loyalty.canRedeem} ya pueden canjear · ${Number(loyalty.outstanding).toLocaleString("es-CU")} puntos sin usar` : "Enciéndelo para que tus clientes vuelvan"}
        to="/vendedor/puntos"
      />
    </div>
  );
}

export function InsightsGrid({ insights }) {
  if (!insights) return null;
  const { ranking, improveListings, viewedNotBought, lapsedCustomers, bestTimes, currency } = insights;
  const maxDay = bestTimes.enough ? Math.max(...bestTimes.byDay.map((d) => d.orders), 1) : 1;

  return (
    <div className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section className={`${CARD} p-6`} aria-label="Tu visibilidad en la plataforma">
        <CardHeader icon={Rocket} tone="teal" title="Tu visibilidad en la plataforma" subtitle="Dónde quedan tus productos en el orden del inicio y del buscador" to="/vendedor/productos" linkLabel="Ver productos" />
        {ranking.competing != null ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-surface-container/60 px-2 py-2.5">
                <div className="font-display text-[20px] font-extrabold text-on-surface">{ranking.top10}</div>
                <div className="text-[11px] text-outline">en los 10 primeros</div>
              </div>
              <div className="rounded-xl bg-surface-container/60 px-2 py-2.5">
                <div className="font-display text-[20px] font-extrabold text-on-surface">{ranking.top30}</div>
                <div className="text-[11px] text-outline">en los 30 primeros</div>
              </div>
              <div className="rounded-xl bg-surface-container/60 px-2 py-2.5">
                <div className={`font-display text-[20px] font-extrabold ${ranking.penalized ? "text-error" : "text-on-surface"}`}>{ranking.penalized}</div>
                <div className="text-[11px] text-outline">frenados por la ficha</div>
              </div>
            </div>
            <ul className="mt-3 grid gap-1">
              {ranking.best.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                  <span className="min-w-0 truncate text-on-surface">{p.name}</span>
                  <span className="flex-shrink-0 font-bold text-tertiary-accent">
                    puesto {p.position} de {ranking.catalogSize}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-[17px] text-on-surface-variant">Suben más las fichas completas, con reseñas buenas y con clics o ventas recientes. Algunos planes dan un empujón chico, pero el mérito de cada producto manda.</p>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-error">Tus productos no aparecen en el catálogo público: {ranking.problems?.join("; ") || "revisa que tengas productos activos con stock"}.</p>
        )}
      </section>

      <section className={`${CARD} p-6`} aria-label="Fichas para mejorar">
        <CardHeader icon={Gauge} tone="orange" title="Fichas para mejorar" subtitle="Lo que le falta a cada producto para ganar visibilidad" to="/vendedor/productos" linkLabel="Editar productos" />
        {improveListings.length ? (
          <ul className="mt-3 grid gap-1">
            {improveListings.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-1.5">
                <Thumb src={p.image} name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <div className="truncate text-[11.5px] text-outline">Falta: {p.missing.join(", ")}</div>
                </div>
                <span className="flex-shrink-0 text-[12px] font-bold text-on-surface-variant">{p.score}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-on-surface-variant">Todas tus fichas están completas.</p>
        )}
      </section>

      <section className={`${CARD} p-6`} aria-label="Los ven pero no los compran">
        <CardHeader icon={Eye} tone="blue" title="Los ven pero no los compran" subtitle="10 visitas o más y ninguna venta: revisa precio, fotos y descripción" to="/vendedor/productos" linkLabel="Ver productos" />
        {viewedNotBought.length ? (
          <ul className="mt-3 grid gap-1">
            {viewedNotBought.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-1.5">
                <Thumb src={p.image} name={p.name} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-on-surface">{p.name}</span>
                <span className="flex-shrink-0 text-[12px] font-bold text-on-surface-variant">{p.views} visitas</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-on-surface-variant">Ningún producto con muchas visitas y sin ventas.</p>
        )}
      </section>

      <section className={`${CARD} p-6`} aria-label="Cuándo te compran más">
        <CardHeader icon={CalendarClock} tone="green" title="Cuándo te compran más" subtitle="Últimos 90 días: publica ofertas y ten stock listo antes de esos momentos" />
        {bestTimes.enough ? (
          <>
            <p className="mt-3 text-[13px] text-on-surface">
              Tu mejor día es el <strong>{bestTimes.bestDay}</strong> ({bestTimes.bestDayShare} % de los pedidos) y la mejor franja, de <strong>{bestTimes.bestHours}</strong> ({bestTimes.bestHoursShare} %).
            </p>
            <div className="mt-3 flex h-24 items-end gap-1.5" role="img" aria-label="Pedidos por día de la semana">
              {bestTimes.byDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t-md bg-tertiary-accent/80" style={{ height: `${Math.max(4, (d.orders / maxDay) * 72)}px` }} title={`${d.day}: ${d.orders} pedidos`} />
                  <span className="text-[10.5px] text-outline">{d.day.slice(0, 2)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-on-surface-variant">Hacen falta al menos 5 pedidos en 90 días para calcularlo (llevas {bestTimes.orders}).</p>
        )}
      </section>

      <section className={`${CARD} p-6 lg:col-span-2`} aria-label="Clientes que dejaron de volver">
        <CardHeader icon={MessageCircle} tone="teal" title="Clientes que dejaron de volver" subtitle="Compraron 2 veces o más y llevan más de 45 días sin pedir. Un mensaje a tiempo los recupera." to="/vendedor/clientes" linkLabel="Ver clientes" />
        {lapsedCustomers.length ? (
          <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {lapsedCustomers.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-center gap-3 py-1.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/15 text-[12px] font-bold text-tertiary-accent">{c.name[0]?.toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-on-surface">{c.name}</div>
                  <div className="truncate text-[11.5px] text-outline">
                    {c.orders} pedidos · {fmtMoney(c.spent, currency)} · hace {c.daysAway} días
                  </div>
                </div>
                {c.phone && (
                  <a
                    href={`https://wa.me/${String(c.phone).replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 flex-shrink-0 items-center rounded-lg px-3 text-[12.5px] font-bold text-tertiary-accent hover:bg-surface-container"
                  >
                    Escribir
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-on-surface-variant">Ningún cliente frecuente lleva más de 45 días sin volver.</p>
        )}
      </section>
    </div>
  );
}
