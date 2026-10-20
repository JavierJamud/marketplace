import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Pagination } from "../../components/admin/ListControls.jsx";
import { TableRowsSkeleton } from "../../components/ui/Skeleton.jsx";

const fmtTime = (d) => new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const FILTERS = [
  { id: "", label: "Todos" },
  { id: "200", label: "200 correctos" },
  { id: "401", label: "401 sin llave válida" },
  { id: "403", label: "403 sin permiso o sitio" },
  { id: "404", label: "404 no existe" },
  { id: "429", label: "429 límite" },
];

// Bloque 299: últimas solicitudes de las llaves del socio, para que vea qué pidió su sitio y qué respondió la API.
export default function PartnerMovements() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["partner-portal-movements", user?.id, page, pageSize, status],
    queryFn: async () => (await api.get("/partner-portal/movements", { params: { page, pageSize, status: status || undefined } })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 10000,
  });

  return (
    <div className="max-w-[1100px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Activity} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Movimientos</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Las solicitudes más recientes de tu sitio a la API. Se actualiza solo.</p>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar por respuesta">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setStatus(f.id);
              setPage(1);
            }}
            aria-pressed={status === f.id}
            className={`min-h-11 rounded-full border px-3.5 text-[12.5px] font-semibold ${status === f.id ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11px] font-bold uppercase tracking-wide text-outline">
                <th className="px-3 py-2.5">Hora</th>
                <th className="px-3 py-2.5">Llave</th>
                <th className="px-3 py-2.5">Recurso</th>
                <th className="px-3 py-2.5">Respuesta</th>
                <th className="px-3 py-2.5">ms</th>
                <th className="px-3 py-2.5">Origen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableRowsSkeleton rows={6} cols={6} />}
              {data && data.movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-outline">No hay solicitudes con ese filtro.</td>
                </tr>
              )}
              {data?.movements.map((m) => (
                <tr key={m.id} className="border-b border-surface-container last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 text-on-surface-variant">{fmtTime(m.createdAt)}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.key?.name}</td>
                  <td className="px-3 py-2 font-mono text-on-surface">{m.method} {m.endpoint}</td>
                  <td className={`px-3 py-2 font-bold tabular-nums ${m.status >= 400 ? "text-error" : "text-[#087A38]"}`}>{m.status}</td>
                  <td className="px-3 py-2 tabular-nums text-on-surface-variant">{m.ms}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.origin ?? m.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="solicitudes" />}
    </div>
  );
}
