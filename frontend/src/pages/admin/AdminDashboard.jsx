import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ImagePlus } from "lucide-react";
import { api } from "../../lib/api.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
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

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => (await api.get("/admin/dashboard")).data,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const { data: newSuggestions } = useQuery({
    queryKey: ["admin-suggestions", "new-count"],
    queryFn: async () => (await api.get("/admin/suggestions", { params: { status: "new" } })).data.suggestions,
  });

  const uploadHero = useMutation({
    mutationFn: async (file) => {
      const form = new FormData();
      form.append("image", file);
      return (await api.post("/admin/settings/hero-image", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success("Imagen del hero actualizada.");
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => {
      setPreview(null);
      toast.error(err.response?.data?.error ?? "No se pudo subir la imagen.");
    },
  });

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    uploadHero.mutate(file);
  }

  const heroImageUrl = preview ?? (settings?.heroImageUrl ? `${api.defaults.baseURL}${settings.heroImageUrl}` : null);

  const metrics = data
    ? [
        { label: "Tiendas activas", value: String(data.metrics.activeVendors) },
        { label: "Clientes registrados", value: String(data.metrics.totalCustomers) },
        { label: "Pedidos (mes)", value: String(data.metrics.ordersThisMonth) },
        { label: "Ingresos suscripción (estimado)", value: fmtCUP(data.metrics.subscriptionRevenueEstimate), delta: `${data.metrics.businessVendors} tiendas Business` },
      ]
    : [];

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Panel de administración</h1>
      <p className="mb-6 text-[13.5px] text-outline">Métricas globales de la plataforma {settings?.siteName || "ZeuDin"} · Cuba.</p>

      <div className="mb-6 grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-2 text-[12.5px] text-outline">{m.label}</div>
            <div className="font-display text-2xl font-extrabold text-on-surface">{m.value}</div>
            {m.delta && <div className="mt-1 text-[11.5px] font-semibold text-verified-dark">{m.delta}</div>}
          </div>
        ))}
      </div>

      {data && (
        <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-3 text-[14px] font-bold text-on-surface">Tiendas: activas vs inactivas</div>
            <p className="mb-3 text-[11.5px] text-outline">Activa = recibió al menos un pedido alguna vez.</p>
            <div className="flex items-center gap-4">
              <div>
                <div className="font-display text-2xl font-extrabold text-verified-dark">{data.vendorActivity.active}</div>
                <div className="text-[11.5px] text-outline">Activas</div>
              </div>
              <div>
                <div className="font-display text-2xl font-extrabold text-outline">{data.vendorActivity.inactive}</div>
                <div className="text-[11.5px] text-outline">Sin pedidos aún</div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-3 text-[14px] font-bold text-on-surface">Pedidos por período</div>
            <div className="flex flex-col gap-2">
              {[["Últimas 24h", data.ordersByPeriod.day], ["Últimos 7 días", data.ordersByPeriod.week], ["Últimos 30 días", data.ordersByPeriod.month]].map(
                ([label, value]) => (
                  <div key={label} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-on-surface-variant">{label}</span>
                    <span className="font-bold text-on-surface">{value}</span>
                  </div>
                )
              )}
            </div>
          </div>
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-3 text-[14px] font-bold text-on-surface">Tiendas nuevas por período</div>
            <div className="flex flex-col gap-2">
              {[
                ["Últimas 24h", data.newVendorsByPeriod.day],
                ["Últimos 7 días", data.newVendorsByPeriod.week],
                ["Últimos 30 días", data.newVendorsByPeriod.month],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-[12.5px]">
                  <span className="text-on-surface-variant">{label}</span>
                  <span className="font-bold text-on-surface">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 text-[15px] font-bold text-on-surface">Actividad reciente</div>
          <div className="flex flex-col">
            {data?.activity?.length ? (
              data.activity.map((a, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[14px]" style={{ background: a.bg }}>
                    {a.emoji}
                  </span>
                  <div className="flex-1">
                    <div className="text-[13px] text-on-surface">{a.text}</div>
                    <div className="text-[11.5px] text-outline">{timeAgo(a.time)}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-body-md text-on-surface-variant">Todavía no hay actividad.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Link to="/admin/verificaciones" className="rounded-lg bg-gradient-to-br from-secondary to-on-secondary-container p-[22px] text-white">
            <div className="font-display text-[28px] font-extrabold">{data?.pendingVerifications ?? "—"}</div>
            <div className="mt-0.5 text-[13px] text-white/85">Verificaciones KYC pendientes →</div>
          </Link>
          <Link to="/admin/sugerencias" className="rounded-lg bg-gradient-to-br from-tertiary to-tertiary-accent p-[22px] text-white">
            <div className="font-display text-[28px] font-extrabold">{newSuggestions?.length ?? "—"}</div>
            <div className="mt-0.5 text-[13px] text-white/85">Sugerencias nuevas →</div>
          </Link>
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-3 text-[14px] font-bold text-on-surface">Tiendas por provincia</div>
            <div className="flex flex-col gap-2.5">
              {data?.byProvince?.length ? (
                data.byProvince.map((p) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span className="w-24 flex-shrink-0 text-[12px] text-on-surface-variant">{p.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                      <div className="h-full rounded-full bg-tertiary-accent-light" style={{ width: p.pct }} />
                    </div>
                    <span className="w-6 flex-shrink-0 text-right text-[12px] text-outline">{p.n}</span>
                  </div>
                ))
              ) : (
                <p className="text-label-sm text-outline">Sin datos todavía.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
        <div className="mb-1 text-[15px] font-bold text-on-surface">Imagen principal del sitio</div>
        <p className="mb-4 text-[12.5px] text-outline">
          Se muestra en la primera sección (hero) de la Home para todos los visitantes. Si no subes ninguna, se usa un
          placeholder.
        </p>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="h-[110px] w-[180px] flex-shrink-0 overflow-hidden rounded-md border border-surface-container-high bg-surface-container">
            {heroImageUrl ? (
              <img src={heroImageUrl} alt="Hero actual" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-outline">Sin imagen</div>
            )}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadHero.isPending}
              className="flex items-center gap-2 rounded-md bg-secondary-container px-[18px] py-2.5 text-[13.5px] font-bold text-on-secondary-container disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              {uploadHero.isPending ? "Subiendo..." : settings?.heroImageUrl ? "Reemplazar imagen" : "Subir imagen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
