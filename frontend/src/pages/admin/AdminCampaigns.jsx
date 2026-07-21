import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";

const SEGMENTS = [
  { id: "all_customers", label: "Todos los clientes" },
  { id: "all_vendors", label: "Todos los vendedores" },
  { id: "regular_vendors", label: "Vendedores Regular" },
  { id: "business_vendors", label: "Vendedores Business" },
];

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminCampaigns() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [segment, setSegment] = useState("all_customers");
  const [provinceId, setProvinceId] = useState("");
  const [content, setContent] = useState("");
  const [justSent, setJustSent] = useState(false);

  const { data: provinces } = useQuery({
    queryKey: ["locations-provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });
  const { data: customers } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => (await api.get("/admin/customers")).data.customers,
  });
  const { data: vendors } = useQuery({
    queryKey: ["admin-vendors", "all"],
    queryFn: async () => (await api.get("/admin/vendors")).data.vendors,
  });
  const { data: history } = useQuery({
    queryKey: ["admin-campaigns"],
    queryFn: async () => (await api.get("/admin/campaigns")).data.campaigns,
  });

  const provinceName = useMemo(() => Object.fromEntries((provinces ?? []).map((p) => [p.id, p.name])), [provinces]);

  const recipientEstimate = useMemo(() => {
    const pName = provinceId ? provinceName[provinceId] : null;
    if (segment === "all_customers") {
      return (customers ?? []).filter((c) => !c.isSuspended && (!pName || c.province === pName)).length;
    }
    const planFilter = segment === "regular_vendors" ? "REGULAR" : segment === "business_vendors" ? "BUSINESS" : null;
    return (vendors ?? []).filter(
      (v) => !v.isBlocked && (!planFilter || v.planType === planFilter) && (!pName || v.locations?.[0]?.province?.name === pName)
    ).length;
  }, [segment, provinceId, provinceName, customers, vendors]);

  const send = useMutation({
    mutationFn: async () => (await api.post("/admin/campaigns", { subject, content, segment, provinceId: provinceId || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
      setJustSent(true);
      setSubject("");
      setContent("");
      setTimeout(() => setJustSent(false), 6000);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la campaña."),
  });

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Campañas</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">Enviá correos masivos (Resend) a clientes o vendedores segmentados.</p>

      <div className="grid grid-cols-1 items-start gap-[22px] lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-4 text-[15px] font-bold text-on-surface">Nueva campaña</div>
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Asunto</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ej: Nuevas tiendas en tu provincia"
                className="h-11 w-full rounded-lg border border-outline-variant px-3.5 text-[14px] outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Segmento</label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
                >
                  {SEGMENTS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Provincia</label>
                <select
                  value={provinceId}
                  onChange={(e) => setProvinceId(e.target.value)}
                  className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 text-[14px] outline-none"
                >
                  <option value="">Toda Cuba</option>
                  {(provinces ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-on-surface-variant">Mensaje</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Escribí el contenido del correo..."
                className="min-h-[130px] w-full resize-y rounded-lg border border-outline-variant p-3.5 text-[14px] outline-none"
              />
            </div>
            <div className="flex items-center justify-between pt-1.5">
              <span className="text-[12.5px] text-outline">
                Destinatarios estimados: <strong className="text-on-surface">{recipientEstimate.toLocaleString("es-CU")}</strong>
              </span>
              <button
                onClick={() => send.mutate()}
                disabled={send.isPending || !subject || !content}
                className="rounded-lg bg-tertiary-accent-light px-6 py-3 text-[14px] font-bold text-tertiary disabled:opacity-50"
              >
                {send.isPending ? "Enviando..." : "Enviar campaña"}
              </button>
            </div>
            {justSent && (
              <div className="rounded-[10px] bg-verified/10 px-4 py-3 text-[13px] font-semibold text-verified-dark">
                ✓ Campaña enviada vía Resend.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-3.5 text-[14px] font-bold text-on-surface">Campañas recientes</div>
          <div className="flex flex-col gap-3">
            {!history?.length && <p className="text-label-sm text-outline">Todavía no se envió ninguna campaña.</p>}
            {history?.map((h) => {
              const segLabel = SEGMENTS.find((s) => s.id === h.segment)?.label ?? h.segment;
              const pct = h.sentCount > 0 && h.openCount > 0 ? Math.round((h.openCount / h.sentCount) * 100) : null;
              return (
                <div key={h.id} className="rounded-[10px] border border-surface-container-high p-3.5">
                  <div className="text-[13px] font-semibold text-on-surface">{h.subject ?? h.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-outline">
                    {segLabel}
                    {h.provinceId && provinceName[h.provinceId] ? ` · ${provinceName[h.provinceId]}` : ""} · {fmtDate(h.sentAt ?? h.createdAt)}
                  </div>
                  {h.status === "SENT" ? (
                    <div className="mt-1 text-[11.5px] font-semibold text-verified-dark">
                      {h.sentCount.toLocaleString("es-CU")} enviados{pct !== null ? ` · ${pct}% abiertos` : ""}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11.5px] font-semibold text-outline">{h.status === "DRAFT" ? "Borrador" : h.status}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
