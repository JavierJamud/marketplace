import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Store, User, Activity, ChevronDown } from "lucide-react";
import { exactDateTime } from "../../lib/relativeTime.js";
import { SearchField } from "../../components/admin/ListControls.jsx";
import { useDebouncedSearch } from "../../lib/useListParams.js";
import { Button } from "../../components/ui/Button.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { UsageOverview } from "../../components/admin/VendorUsage.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

const PERIODS = [
  { value: "day", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
];

const ROLE_FILTERS = [
  { value: "", label: "Todos" },
  { value: "VENDOR", label: "Vendedores" },
  { value: "CUSTOMER", label: "Clientes" },
  { value: "VENDOR_STAFF", label: "Equipos" },
  { value: "ADMIN", label: "Administración" },
];

const ROLE_LABEL = { VENDOR: "Vendedor", VENDOR_STAFF: "Equipo de la tienda", ADMIN: "Admin", CUSTOMER: "Cliente" };
const METHOD_LABEL = { POST: "Crear o ejecutar", PATCH: "Modificar", PUT: "Modificar", DELETE: "Eliminar" };

// Detalle de una acción: lo que guarda lib/adminAudit.js (sección, motivo, IP, dispositivo) y, en otras acciones, lo que
// cada una registró. Solo se muestran los datos que existen.
function LogDetails({ log }) {
  const a = log.meta?.audit;
  const rows = [
    ["Fecha y hora", exactDateTime(log.createdAt)],
    ["Sección", a?.section],
    ["Acción", a ? `${METHOD_LABEL[a.method] ?? a.method} · ${a.path}` : null],
    ["Motivo", a?.reason ?? log.meta?.reason ?? null],
    ["Datos enviados", a?.fields?.length ? a.fields.join(", ") : null],
    ["IP", a?.ip ?? log.meta?.ip ?? log.meta?.context?.ip ?? null],
    ["Dispositivo", a?.device ?? null],
    ["Quién", log.actor?.email ?? null],
  ].filter(([, v]) => v);
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-xl bg-surface-container/50 p-3 text-[12px] sm:grid-cols-[120px_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-on-surface-variant">{k}</dt>
          <dd className="mb-1 break-words text-on-surface sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LogRow({ log }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-surface-container px-4 py-3 last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full min-w-0 items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-on-surface">
            <span className="font-bold">{log.actor?.fullName ?? log.actor?.email ?? "Cuenta eliminada"}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${log.actorRole === "VENDOR" ? "bg-secondary-container text-on-secondary-container" : log.actorRole === "ADMIN" ? "bg-tertiary-accent/10 text-tertiary" : "bg-surface-container text-on-surface-variant"}`}>
              {ROLE_LABEL[log.actorRole] ?? "Cliente"}
            </span>
            {log.vendor && <span className="text-[11.5px] text-outline">· {log.vendor.companyName}</span>}
          </span>
          <span className="mt-0.5 block break-words text-[12.5px] text-on-surface-variant">{log.description}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-outline" title={exactDateTime(log.createdAt)}>
          {timeAgo(log.createdAt)}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open && <LogDetails log={log} />}
    </div>
  );
}

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

  const [q, setQ] = useState("");
  const [searchText, setSearchText] = useDebouncedSearch(q, setQ);
  const { data: logsPages, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["admin-activity-log", role, q],
    queryFn: async ({ pageParam }) => (await api.get("/admin/activity-log", { params: { role: role || undefined, q: q.length >= 2 ? q : undefined, before: pageParam } })).data,
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.logs[last.logs.length - 1]?.createdAt : undefined),
  });
  const logs = logsPages?.pages.flatMap((p) => p.logs) ?? [];

  return (
    <div className="max-w-[980px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Activity} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Actividad</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Registro de las acciones de vendedores, clientes y administración, y qué tiendas y clientes más usan la plataforma. Toca una acción para ver la hora exacta, la sección, el motivo, la IP y el dispositivo.
      </p>

      <UsageOverview />

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

      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[14px] font-bold text-on-surface">Historial</div>
        <div className="flex flex-wrap gap-2">
          {ROLE_FILTERS.map((r) => (
            <button
              key={r.value}
              onClick={() => setRole(r.value)}
              className={`min-h-9 rounded-full px-3 py-1 text-[12px] font-semibold ${
                role === r.value ? "bg-tertiary-accent-light text-tertiary" : "border border-outline-variant text-on-surface-variant"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <SearchField value={searchText} onChange={setSearchText} placeholder="Buscar por acción, persona o tienda" className="mb-3" />

      {isLoading && <ListSkeleton />}
      {isError && (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-body-md text-error">No se pudo cargar el historial.</p>
          <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      )}
      {!isLoading && !isError && !logs.length && <p className="text-body-md text-on-surface-variant">{q.length >= 2 ? "Ninguna acción coincide con esa búsqueda." : "Todavía no hay actividad registrada."}</p>}

      {logs.length > 0 && (
        <div className="flex flex-col rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      )}
      {hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Cargando..." : "Ver más"}
          </Button>
        </div>
      )}
    </div>
  );
}
