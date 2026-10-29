import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../../lib/toast.jsx";
import { CheckCircle2, Inbox, Pencil } from "lucide-react";
import { CARD } from "../../../components/dashboard/DashboardCard.jsx";
import { api } from "../../../lib/api.js";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { BTN, BTN_PRIMARY, BTN_GHOST, BTN_DANGER, INPUT, LABEL, fmtDate, linesToList, errMsg, Modal } from "./ui.jsx";
import { ListSkeleton } from "../../../components/ui/Skeleton.jsx";

const STATUS = {
  PENDING: { label: "En revisión", cls: "bg-secondary-container/15 text-secondary" },
  APPROVED: { label: "Aprobada", cls: "bg-verified/10 text-verified-dark" },
  REJECTED: { label: "Rechazada", cls: "bg-error/10 text-error" },
};
const FILTERS = [["PENDING", "En revisión"], ["APPROVED", "Aprobadas"], ["REJECTED", "Rechazadas"], ["", "Todas"]];

const hostnameOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
const sitesOf = (app) => (app.websites?.length ? app.websites : app.website ? [app.website] : []);

function Field({ label, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11.5px] font-bold uppercase tracking-wide text-outline">{label}</dt>
      <dd className="mt-0.5 break-words text-[13.5px] text-on-surface">{children}</dd>
    </div>
  );
}

// Formulario para corregir los datos de una solicitud en revisión. La contraseña no se toca: es de la persona.
function EditForm({ app, onDone }) {
  const sites = sitesOf(app);
  const [f, setF] = useState({
    firstName: app.firstName,
    lastName: app.lastName,
    email: app.email,
    phone: app.phone,
    companyName: app.companyName,
    site1: sites[0] ?? "",
    site2: sites[1] ?? "",
    description: app.description,
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/admin/partner-applications/${app.id}`, {
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phone: f.phone,
        companyName: f.companyName,
        websites: [f.site1.trim(), f.site2.trim()].filter(Boolean),
        description: f.description,
      })).data,
    onSuccess: () => {
      toast.success("Solicitud actualizada.");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo guardar.")),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={LABEL}>Nombre</label><input className={INPUT} value={f.firstName} onChange={set("firstName")} required minLength={2} /></div>
        <div><label className={LABEL}>Apellido</label><input className={INPUT} value={f.lastName} onChange={set("lastName")} required minLength={2} /></div>
        <div><label className={LABEL}>Correo</label><input type="email" className={INPUT} value={f.email} onChange={set("email")} required /></div>
        <div><label className={LABEL}>Teléfono (con +código)</label><input type="tel" className={INPUT} value={f.phone} onChange={set("phone")} required placeholder="+5355512345" /></div>
      </div>
      <div><label className={LABEL}>Negocio o sitio</label><input className={INPUT} value={f.companyName} onChange={set("companyName")} required minLength={2} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={LABEL}>Sitio web principal</label><input type="url" className={INPUT} value={f.site1} onChange={set("site1")} required placeholder="https://" /></div>
        <div><label className={LABEL}>Segundo sitio (opcional)</label><input type="url" className={INPUT} value={f.site2} onChange={set("site2")} placeholder="http://localhost:3000" /></div>
      </div>
      <div><label className={LABEL}>Para qué usará la API</label><textarea className={`${INPUT} py-2`} rows={4} value={f.description} onChange={set("description")} required minLength={20} /></div>
      <button className={`${BTN_PRIMARY} w-full`} disabled={save.isPending}>{save.isPending ? "Guardando..." : "Guardar cambios"}</button>
    </form>
  );
}

// Al aprobar se crea sola la credencial del socio: el admin solo confirma los servicios (por defecto, todos) y los
// sitios autorizados (por defecto, los dos que indicó la persona en su solicitud).
function ApproveForm({ app, onDone }) {
  const { data: scopeData } = useQuery({ queryKey: ["admin-partner-scopes"], queryFn: async () => (await api.get("/admin/partners/scopes")).data, staleTime: Infinity });
  const [scopes, setScopes] = useState(null);
  const [domains, setDomains] = useState(sitesOf(app).map(hostnameOf).filter(Boolean).join("\n"));
  const [ips, setIps] = useState("");
  const allScopes = scopeData?.scopes ?? [];
  const chosen = scopes ?? allScopes.map((s) => s.id);
  const toggle = (id) => setScopes(chosen.includes(id) ? chosen.filter((s) => s !== id) : [...chosen, id]);
  const approve = useMutation({
    mutationFn: async () => (await api.post(`/admin/partner-applications/${app.id}/approve`, { scopes: chosen, allowedDomains: linesToList(domains), allowedIps: linesToList(ips) })).data,
    onSuccess: (d) => {
      toast.success(d.emailed ? "Solicitud aprobada. El socio recibió su credencial por correo." : "Solicitud aprobada, pero no se pudo enviar el correo: entrégale la credencial desde su ficha.");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo aprobar.")),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); approve.mutate(); }} className="space-y-4">
      <p className="text-[13px] text-on-surface-variant">Se crea la cuenta de socio con la contraseña que eligió y su credencial de la API, y se le envía todo por correo.</p>
      <div>
        <label className={LABEL}>Servicios a los que tendrá acceso</label>
        <div className="space-y-1">
          {allScopes.map((s) => (
            <label key={s.id} className="flex min-h-11 items-start gap-3 rounded-lg px-1 py-1.5 text-[13px] text-on-surface">
              <input type="checkbox" className="mt-0.5 h-5 w-5 flex-shrink-0" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
              <span><b>{s.label}</b><span className="block text-[11.5px] text-outline">{s.description}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div><label className={LABEL}>Sitios autorizados (uno por línea)</label><textarea className={`${INPUT} py-2`} rows={2} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="mitienda.com" /></div>
      <div><label className={LABEL}>Direcciones IP autorizadas (opcional, una por línea)</label><textarea className={`${INPUT} py-2`} rows={2} value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10" /></div>
      <button className={`${BTN_PRIMARY} w-full`} disabled={approve.isPending || chosen.length === 0}>{approve.isPending ? "Aprobando..." : "Aprobar y enviar credencial"}</button>
    </form>
  );
}

function RejectForm({ app, onDone }) {
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: async () => (await api.post(`/admin/partner-applications/${app.id}/reject`, { reason })).data,
    onSuccess: () => {
      toast.success("Solicitud rechazada. Se le avisó por correo.");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo rechazar.")),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); reject.mutate(); }} className="space-y-3">
      <div><label className={LABEL}>Motivo (se lo enviamos por correo)</label><textarea className={`${INPUT} py-2`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></div>
      <button className={`${BTN_PRIMARY} w-full`} disabled={reject.isPending || reason.trim().length < 3}>{reject.isPending ? "Rechazando..." : "Rechazar solicitud"}</button>
    </form>
  );
}

function ApplicationCard({ app }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null); // "edit" | "approve" | "reject"
  const status = STATUS[app.status];
  const sites = sitesOf(app);
  const done = () => {
    setMode(null);
    qc.invalidateQueries({ queryKey: ["admin-partner-applications"] });
    qc.invalidateQueries({ queryKey: ["admin-partners"] });
  };
  return (
    <article className={`${CARD} p-4 sm:p-5`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-[15px] font-bold text-on-surface">{app.companyName}</h3>
          <p className="text-[12.5px] text-outline">Recibida {fmtDate(app.createdAt)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
      </header>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Nombre">{app.firstName} {app.lastName}</Field>
        <Field label="Correo">{app.email}{app.status === "PENDING" && <span className="mt-0.5 block text-[11.5px] text-outline">Sin verificar: la credencial se enviará a este correo, confirma que es de la persona.</span>}</Field>
        <Field label="Teléfono">{app.phone}</Field>
        <Field label={sites.length > 1 ? "Sitios desde los que usará la API" : "Sitio desde el que usará la API"}>
          {sites.length ? <ul className="space-y-0.5">{sites.map((u) => <li key={u}>{u}</li>)}</ul> : "No indicó"}
        </Field>
        <Field label="Para qué usará la API" wide>{app.description}</Field>
        {app.rejectReason && <Field label="Motivo del rechazo" wide>{app.rejectReason}</Field>}
      </dl>

      {app.status === "PENDING" && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button className={BTN_PRIMARY} onClick={() => setMode("approve")}><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Aprobar y crear credencial</button>
          <button className={BTN_GHOST} onClick={() => setMode("edit")}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar datos</button>
          <button className={BTN_DANGER} onClick={() => setMode("reject")}>Rechazar</button>
        </div>
      )}

      {mode === "edit" && <Modal wide title={`Editar la solicitud de ${app.companyName}`} onClose={() => setMode(null)}><EditForm app={app} onDone={done} /></Modal>}
      {mode === "approve" && <Modal wide title={`Aprobar a ${app.companyName}`} onClose={() => setMode(null)}><ApproveForm app={app} onDone={done} /></Modal>}
      {mode === "reject" && <Modal title={`Rechazar a ${app.companyName}`} onClose={() => setMode(null)}><RejectForm app={app} onDone={done} /></Modal>}
    </article>
  );
}

export default function PartnerApplications() {
  const [status, setStatus] = useState("PENDING");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-partner-applications", status],
    queryFn: async () => (await api.get("/admin/partner-applications", { params: { status: status || undefined, pageSize: 50 } })).data,
    refetchInterval: 20000,
  });
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar solicitudes">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} aria-pressed={status === v} className={`min-h-11 rounded-full border px-3.5 text-[12.5px] font-semibold ${status === v ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}>{l}</button>
        ))}
      </div>
      {isLoading && <ListSkeleton />}
      {isError && <p role="alert" className="rounded-xl bg-error/10 p-3 text-[13px] font-semibold text-error">No se pudieron cargar las solicitudes. Intenta de nuevo en un momento.</p>}
      {!isLoading && !isError && !data?.applications.length && <EmptyState icon={Inbox} title="No hay solicitudes" description="Cuando alguien pida usar la API desde la página de solicitud, aparecerá aquí." />}
      <div className="space-y-4">{data?.applications.map((a) => <ApplicationCard key={a.id} app={a} />)}</div>
    </div>
  );
}
