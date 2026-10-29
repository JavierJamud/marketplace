import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Pagination } from "../../components/admin/ListControls.jsx";
import { TableRowsSkeleton } from "../../components/ui/Skeleton.jsx";

const fmtTime = (d) => new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
// Son las respuestas que de verdad da la API de socios (partnerAuth, partnerApi.routes y los controladores). El backend filtra
// por código exacto, por eso van uno a uno: con solo "200" quedaban fuera los pedidos creados (201) y los errores 400, 409 y 500.
// Si el backend aprende a filtrar por rangos (2xx, 4xx, 5xx), esta lista puede reducirse a esos grupos.
const FILTERS = [
  { id: "", label: "Todas las respuestas" },
  { id: "200", label: "200 correcta" },
  { id: "201", label: "201 pedido creado" },
  { id: "400", label: "400 datos no válidos o falta Idempotency-Key" },
  { id: "401", label: "401 sin credencial válida" },
  { id: "403", label: "403 sin permiso o sitio no autorizado" },
  { id: "404", label: "404 no existe" },
  { id: "409", label: "409 clave repetida, sin stock o tienda sin recibir pedidos" },
  { id: "413", label: "413 cuerpo demasiado grande" },
  { id: "429", label: "429 límite de solicitudes" },
  { id: "500", label: "500 error del servidor" },
];

// Bloque 299: últimas solicitudes de las llaves del socio, para que vea qué pidió su sitio y qué respondió la API.
export default function PartnerMovements() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("");
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["partner-portal-movements", user?.id, page, pageSize, status],
    queryFn: async () => (await api.get("/partner-portal/movements", { params: { page, pageSize, status: status || undefined } })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 10000,
  });

  return (
    <div className="max-w-[1100px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Activity} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Movimientos</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Las solicitudes más recientes de tu sitio a la API. Se actualiza solo.</p>

      {/* Una lista desplegable y no botones: con once respuestas posibles, los botones ocupaban media pantalla a 390 px. */}
      <label className="mb-3 flex flex-col gap-1 text-[12px] font-bold text-on-surface-variant sm:flex-row sm:items-center sm:gap-2">
        Filtrar por respuesta
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="min-h-11 w-full min-w-0 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] font-normal text-on-surface sm:w-auto sm:max-w-[420px]"
        >
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      {/* Sin datos y con error, la tabla quedaba vacía sin explicación. Con datos ya cargados se siguen viendo aunque un refresco falle. */}
      {!data && isError && (
        <div role="alert" className={`${CARD} mb-3 p-5`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-on-surface">No se pudieron cargar tus movimientos</p>
              <p className="mt-1 text-[13px] text-on-surface-variant">{error?.response?.data?.error ?? "Revisa tu conexión e inténtalo de nuevo."}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="mt-4 flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetching ? "Cargando..." : "Reintentar"}
          </button>
        </div>
      )}

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
                  <td colSpan={6} className="px-3 py-8 text-center text-outline">{status ? "No hay solicitudes con esa respuesta." : "Todavía no hay solicitudes de tu sitio."}</td>
                </tr>
              )}
              {data?.movements.map((m) => (
                <tr key={m.id} className="border-b border-surface-container last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 text-on-surface-variant">{fmtTime(m.createdAt)}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.key?.name}</td>
                  <td className="px-3 py-2 font-mono text-on-surface">{m.method} {m.endpoint}</td>
                  <td className={`px-3 py-2 font-bold tabular-nums ${m.status >= 400 ? "text-error" : "text-verified-dark"}`}>{m.status}</td>
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
