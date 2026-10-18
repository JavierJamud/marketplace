import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";
import { CARD, CardHeader } from "../dashboard/DashboardCard.jsx";

// Tiendas registradas en los últimos 14 días, en el panel principal del admin: cuánto llevan de su configuración (los
// mismos pasos que pide la prueba gratis) y si ya activaron la prueba. Cada fila abre su página Gestionar.
const timeAgo = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
};

export function NewVendorsCard() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-new-vendors"], queryFn: async () => (await api.get("/admin/vendors/new")).data, staleTime: 60 * 1000 });

  return (
    <div className={`${CARD} mb-5 p-6`}>
      <CardHeader icon={Sparkles} tone="orange" title="Tiendas nuevas" subtitle={data ? `${data.total} en los últimos ${data.days} días` : "Últimos 14 días"} to="/admin/tiendas" linkLabel="Ver todas" />
      {isLoading && <p className="mt-3 text-label-sm text-outline">Cargando...</p>}
      {isError && <p className="mt-3 text-label-sm text-error">No se pudo cargar.</p>}
      {data && data.vendors.length === 0 && <p className="mt-3 text-label-sm text-outline">Ninguna tienda se registró en estos días.</p>}
      {data && data.vendors.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {data.vendors.map((v) => {
            const pct = v.totalSteps ? Math.round((v.done / v.totalSteps) * 100) : 0;
            return (
              <li key={v.id}>
                <Link to={`/admin/tiendas/${v.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/60">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white" style={{ background: v.color || "#337475" }} aria-hidden="true">
                    {v.companyName.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-on-surface">{v.companyName}</span>
                    <span className="block text-[11.5px] text-outline">
                      {timeAgo(v.createdAt)} · {v.trialActive ? "en prueba gratis" : `${v.done} de ${v.totalSteps} pasos`}
                      {!v.lastLoginAt ? " · no volvió a entrar" : ""}
                    </span>
                  </span>
                  <span className="w-16 flex-shrink-0" aria-label={`${pct} % configurada`}>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-surface-container">
                      <span className={`block h-full rounded-full ${pct === 100 ? "bg-verified" : "bg-tertiary-accent-light"}`} style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
