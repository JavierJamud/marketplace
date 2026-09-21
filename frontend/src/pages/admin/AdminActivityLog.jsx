import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Store, User, Activity } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";

const PERIODS = [
  { value: "day", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
];

const ROLE_FILTERS = [
  { value: "", label: "Todos" },
  { value: "VENDOR", label: "Vendedores" },
  { value: "CUSTOMER", label: "Clientes" },
];

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Recién";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Ayer" : `Hace ${days} días`;
}

// Mismo patrón de barra que "Tiendas por provincia" en AdminDashboard.jsx —
// `pct` viene precalculado desde el backend contra el máximo del propio grupo.
function UsageBar({ label, count, pct }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-32 flex-shrink-0 truncate text-[12px] text-on-surface-variant" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
        <div className="h-full rounded-full bg-tertiary-accent-light" style={{ width: pct }} />
      </div>
      <span className="w-6 flex-shrink-0 text-right text-[12px] text-outline">{count}</span>
    </div>
  );
}

// Bloque 70 (pedido explícito): "una sección dedicada a todas las acciones de
// vendedores y de clientes... para tener un récord de todo lo que hacen en
// sus paneles" + gráfica de qué tiendas/clientes más usan la plataforma por
// día/semana/mes. Alimentado por ActivityLog (backend/src/lib/activityLog.js),
// registrado best-effort desde cada acción relevante ya instrumentada.
export default function AdminActivityLog() {
  const [period, setPeriod] = useState("day");
  const [role, setRole] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["admin-activity-stats", period],
    queryFn: async () => (await api.get("/admin/activity-log/stats", { params: { period } })).data,
  });

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["admin-activity-log", role],
    queryFn: async () => (await api.get("/admin/activity-log", { params: { role: role || undefined } })).data,
  });

  return (
    <div className="max-w-[980px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Activity} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Actividad</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Registro de las acciones que hacen vendedores y clientes en sus paneles, y qué tiendas/clientes más usan la plataforma.
      </p>

      <div className="mb-5 flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${
              period === p.value ? "bg-tertiary text-white" : "border border-outline-variant text-on-surface-variant"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5">
          <div className="mb-3 flex items-center gap-1.5 text-[14px] font-bold text-on-surface">
            <Store className="h-4 w-4" /> Tiendas con más actividad
          </div>
          <div className="flex flex-col gap-2.5">
            {stats?.topVendors?.length ? (
              stats.topVendors.map((v) => <UsageBar key={v.vendorId} label={v.companyName} count={v.count} pct={v.pct} />)
            ) : (
              <p className="text-label-sm text-outline">Sin actividad de vendedores todavía en este período.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5">
          <div className="mb-3 flex items-center gap-1.5 text-[14px] font-bold text-on-surface">
            <User className="h-4 w-4" /> Clientes con más actividad
          </div>
          <div className="flex flex-col gap-2.5">
            {stats?.topCustomers?.length ? (
              stats.topCustomers.map((c) => <UsageBar key={c.customerId} label={c.name} count={c.count} pct={c.pct} />)
            ) : (
              <p className="text-label-sm text-outline">Sin actividad de clientes todavía en este período.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="text-[14px] font-bold text-on-surface">Historial</div>
        <div className="flex gap-2">
          {ROLE_FILTERS.map((r) => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                role === r.value ? "bg-tertiary-accent-light text-tertiary" : "border border-outline-variant text-on-surface-variant"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && !logsData?.logs?.length && <p className="text-body-md text-on-surface-variant">Todavía no hay actividad registrada.</p>}

      <div className="flex flex-col gap-2 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        {logsData?.logs?.map((log) => (
          <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-container px-4 py-3 last:border-b-0">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-on-surface">
                <span className="font-bold">{log.actor?.fullName ?? log.actor?.email ?? "Cuenta eliminada"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    log.actorRole === "VENDOR" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {log.actorRole === "VENDOR" ? "Vendedor" : "Cliente"}
                </span>
                {log.vendor && <span className="text-[11.5px] text-outline">· {log.vendor.companyName}</span>}
              </div>
              <p className="mt-0.5 text-[12.5px] text-on-surface-variant">{log.description}</p>
            </div>
            <span className="flex-shrink-0 text-[11px] text-outline">{timeAgo(log.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
