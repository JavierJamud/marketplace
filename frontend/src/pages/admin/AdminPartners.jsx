import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Plug, Plus, ExternalLink } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { BTN_PRIMARY, INPUT, LABEL, fmt, errMsg, Modal, StatusPill } from "./partners/ui.jsx";
import PartnerDetail from "./partners/PartnerDetail.jsx";
import PartnerApplications from "./partners/PartnerApplications.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

function PartnerForm({ onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", code: "", contactEmail: "", contactName: "", website: "", listInMarketplace: true });
  const save = useMutation({
    mutationFn: async () =>
      (await api.post("/admin/partners", { ...f, code: f.code || undefined, contactName: f.contactName || null, website: f.website || null })).data,
    onSuccess: (d) => {
      toast.success("Socio creado.");
      qc.invalidateQueries({ queryKey: ["admin-partners"] });
      onDone(d.partner.id);
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo crear el socio.")),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
      <div><label className={LABEL}>Nombre de la empresa</label><input className={INPUT} value={f.name} onChange={set("name")} required minLength={2} /></div>
      <div>
        <label className={LABEL}>Código del enlace (opcional)</label>
        <input className={`${INPUT} uppercase`} value={f.code} onChange={set("code")} placeholder="Se genera con el nombre" maxLength={24} />
        <p className="mt-1 text-[11.5px] text-outline">No se puede cambiar después: va dentro de sus enlaces.</p>
      </div>
      <div><label className={LABEL}>Correo de contacto</label><input type="email" className={INPUT} value={f.contactEmail} onChange={set("contactEmail")} required /></div>
      <div><label className={LABEL}>Persona de contacto</label><input className={INPUT} value={f.contactName} onChange={set("contactName")} /></div>
      <div><label className={LABEL}>Sitio web</label><input className={INPUT} value={f.website} onChange={set("website")} placeholder="https://" /></div>
      <label className="flex min-h-[44px] items-center gap-3 text-[13px] text-on-surface">
        <input type="checkbox" className="h-5 w-5" checked={f.listInMarketplace} onChange={(e) => setF({ ...f, listInMarketplace: e.target.checked })} />
        Sus tiendas también salen en el marketplace de Baznova
      </label>
      <button className={`${BTN_PRIMARY} w-full`} disabled={save.isPending}>{save.isPending ? "Creando..." : "Crear socio"}</button>
    </form>
  );
}

export default function AdminPartners() {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("socios");
  const [q, setQ] = useState("");
  const { data: appsInfo } = useQuery({
    queryKey: ["admin-partner-applications", "PENDING"],
    queryFn: async () => (await api.get("/admin/partner-applications", { params: { status: "PENDING", pageSize: 50 } })).data,
    refetchInterval: 20000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["admin-partners", q],
    queryFn: async () => (await api.get("/admin/partners", { params: { q: q || undefined, pageSize: 100 } })).data,
    refetchInterval: 20000,
  });

  if (selected) return <PartnerDetail id={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="max-w-[1000px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Plug} tone="blue" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Socios de la API</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Empresas que muestran productos de Baznova en su sitio y traen tiendas con su enlace.{" "}
        <a href="/api-socios" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-tertiary-accent hover:underline">Ver documentación <ExternalLink className="h-3.5 w-3.5" /></a>
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {[["socios", "Socios"], ["solicitudes", `Solicitudes${appsInfo?.pending ? ` (${appsInfo.pending})` : ""}`]].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`min-h-11 rounded-full border px-4 text-[13px] font-semibold ${tab === v ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}>{l}</button>
        ))}
      </div>
      {tab === "solicitudes" && <PartnerApplications />}
      {tab === "socios" && <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${INPUT} max-w-xs`} placeholder="Buscar socio" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={BTN_PRIMARY} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nuevo socio</button>
      </div>}

      {tab === "socios" && isLoading && <ListSkeleton />}
      {tab === "socios" && !isLoading && !data?.partners.length && <EmptyState icon={Plug} title="Todavía no hay socios" description="Crea el primero para darle sus llaves de la API." />}

      {tab === "socios" && data?.partners.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11.5px] font-bold uppercase tracking-wide text-outline">
                <th className="px-4 py-3">Socio</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">Tiendas</th><th className="px-4 py-3">Llaves</th><th className="px-4 py-3">Hoy</th><th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.partners.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p.id)} className="cursor-pointer border-b border-surface-container last:border-b-0 hover:bg-surface-container/50">
                  <td className="px-4 py-3 font-bold text-on-surface">{p.name}<span className="block text-[12px] font-normal text-outline">{p.contactEmail}</span></td>
                  <td className="px-4 py-3 font-mono text-on-surface-variant">{p.code}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{fmt(p.stores)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{p.activeKeys}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{fmt(p.requestsToday)}</td>
                  <td className="px-4 py-3"><StatusPill ok={p.status === "ACTIVE"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="Nuevo socio" onClose={() => setCreating(false)}>
          <PartnerForm onDone={(id) => { setCreating(false); setSelected(id); }} />
        </Modal>
      )}
    </div>
  );
}

