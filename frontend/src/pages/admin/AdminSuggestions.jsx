import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Store, User, Check, MessageSquare } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "vendor", label: "Vendedores" },
  { id: "customer", label: "Clientes" },
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

export default function AdminSuggestions() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-suggestions", filter],
    queryFn: async () => (await api.get("/admin/suggestions", { params: { type: filter !== "all" ? filter : undefined } })).data.suggestions,
  });

  const markReviewed = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/suggestions/${id}`, { status: "REVIEWED" })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-suggestions"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={MessageSquare} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Sugerencias</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Buzón de mejoras enviadas por vendedores y clientes.</p>

      <div className="mb-[22px] flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              filter === f.id ? "border-tertiary bg-tertiary text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && data?.length === 0 && <p className="text-body-md text-on-surface-variant">No hay sugerencias para este filtro.</p>}

      <div className="flex flex-col gap-3.5">
        {data?.map((s) => {
          const Icon = s.authorType === "VENDOR" ? Store : User;
          return (
            <div
              key={s.id}
              className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5"
              style={{ opacity: s.status === "REVIEWED" ? 0.65 : 1 }}
            >
              <div className="mb-2.5 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                      s.authorType === "VENDOR" ? "bg-tertiary-accent/12 text-tertiary-accent" : "bg-primary-container/12 text-primary-container"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[13.5px] font-bold text-on-surface">{s.authorName}</div>
                    <div className="text-[11.5px] text-outline">
                      {s.authorType === "VENDOR" ? "Vendedor" : "Cliente"} · {timeAgo(s.createdAt)}
                    </div>
                  </div>
                </div>
                {s.status === "REVIEWED" ? (
                  <span className="flex items-center gap-1 rounded-full bg-verified/10 px-2.5 py-1 text-[11px] font-bold text-verified-dark">
                    <Check className="h-3 w-3" strokeWidth={3} /> Revisada
                  </span>
                ) : (
                  <span className="rounded-full bg-secondary/10 px-2.5 py-1 text-[11px] font-bold text-secondary">Nueva</span>
                )}
              </div>
              <p className="text-[13.5px] leading-relaxed text-on-surface-variant">{s.message}</p>
              {s.status !== "REVIEWED" && (
                <button
                  onClick={() => markReviewed.mutate(s.id)}
                  disabled={markReviewed.isPending}
                  className="mt-3.5 rounded-md bg-surface-container px-3.5 py-2 text-[12px] font-bold text-on-surface-variant disabled:opacity-50"
                >
                  Marcar como revisada
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
