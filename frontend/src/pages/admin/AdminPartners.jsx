import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Plug, Plus, Copy, KeyRound, ArrowLeft, Ban, CheckCircle2, X, ExternalLink } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const BTN = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border border-outline-variant text-on-surface hover:bg-surface-variant`;
const INPUT = "min-h-[44px] w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-primary";
const LABEL = "mb-1 block text-[12px] font-bold text-on-surface-variant";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU");
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Nunca");
const linesToList = (text) => text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
const errMsg = (err, fallback) => err.response?.data?.error ?? fallback;

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`relative max-h-[90vh] w-full ${wide ? "max-w-xl" : "max-w-md"} overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-2xl`}>
        <button onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-variant">
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-4 pr-10 text-[16px] font-bold text-on-surface">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function StatusPill({ ok, yes = "Activo", no = "Suspendido" }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ok ? "bg-verified/10 text-verified-dark" : "bg-error/10 text-error"}`}>{ok ? yes : no}</span>;
}

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

function KeyForm({ partnerId, scopes, defaults, existing, onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: existing?.name ?? "",
    scopes: existing?.scopes ?? scopes.map((s) => s.id),
    rateLimitPerMinute: existing?.rateLimitPerMinute ?? defaults.rateLimitPerMinute,
    dailyLimit: existing?.dailyLimit ?? defaults.dailyLimit,
    domains: (existing?.allowedDomains ?? []).join("\n"),
    ips: (existing?.allowedIps ?? []).join("\n"),
    expiresAt: existing?.expiresAt ? existing.expiresAt.slice(0, 10) : "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name,
        scopes: f.scopes,
        rateLimitPerMinute: Number(f.rateLimitPerMinute),
        dailyLimit: Number(f.dailyLimit),
        allowedDomains: linesToList(f.domains),
        allowedIps: linesToList(f.ips),
        expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59`).toISOString() : null,
      };
      if (existing) return (await api.patch(`/admin/partners/${partnerId}/keys/${existing.id}`, body)).data;
      return (await api.post(`/admin/partners/${partnerId}/keys`, body)).data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["admin-partner", partnerId] });
      onDone(d.secret ?? null);
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo guardar la llave.")),
  });
  const toggleScope = (id) => setF({ ...f, scopes: f.scopes.includes(id) ? f.scopes.filter((s) => s !== id) : [...f.scopes, id] });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
      <div><label className={LABEL}>Nombre de la credencial</label><input className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} placeholder="Ej. Sitio web principal" /></div>
      <p className="rounded-xl bg-surface-container p-3 text-[12px] text-on-surface-variant">
        Cada socio tiene una sola credencial. Sirve desde su sitio web (por dominio) y desde su servidor (por IP): basta con que coincida uno de los dos.
      </p>
      <div>
        <label className={LABEL}>Dominios autorizados (uno por línea)</label>
        <textarea className={`${INPUT} py-2`} rows={3} value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder={"mitienda.com\n*.mitienda.com"} />
      </div>
      <div>
        <label className={LABEL}>Direcciones IP autorizadas (una por línea)</label>
        <textarea className={`${INPUT} py-2`} rows={2} value={f.ips} onChange={(e) => setF({ ...f, ips: e.target.value })} placeholder="203.0.113.10" />
      </div>
      <div>
        <label className={LABEL}>Permisos</label>
        <div className="space-y-1">
          {scopes.map((s) => (
            <label key={s.id} className="flex min-h-[44px] items-start gap-3 rounded-lg px-1 py-1.5 text-[13px] text-on-surface">
              <input type="checkbox" className="mt-0.5 h-5 w-5 flex-shrink-0" checked={f.scopes.includes(s.id)} onChange={() => toggleScope(s.id)} />
              <span><b>{s.label}</b><span className="block text-[11.5px] text-outline">{s.description}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={LABEL}>Por minuto</label><input type="number" min={1} className={INPUT} value={f.rateLimitPerMinute} onChange={(e) => setF({ ...f, rateLimitPerMinute: e.target.value })} /></div>
        <div><label className={LABEL}>Por día</label><input type="number" min={1} className={INPUT} value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: e.target.value })} /></div>
      </div>
      <div><label className={LABEL}>Vence el (opcional)</label><input type="date" className={INPUT} value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></div>
      <button className={`${BTN_PRIMARY} w-full`} disabled={save.isPending || f.scopes.length === 0}>{save.isPending ? "Guardando..." : existing ? "Guardar cambios" : "Crear credencial"}</button>
    </form>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-outline">{label}</p>
      <p className="mt-1 font-display text-[24px] font-extrabold text-on-surface">{value}</p>
      {hint && <p className="text-[11.5px] text-outline">{hint}</p>}
    </div>
  );
}

function QuotaBar({ used, limit }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
        <div className={`h-full ${pct > 90 ? "bg-error" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11.5px] text-outline">{fmt(used)} de {fmt(limit)}</p>
    </div>
  );
}

function Movements({ partnerId }) {
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["admin-partner-movements", partnerId, page],
    queryFn: async () => (await api.get(`/admin/partners/${partnerId}/movements`, { params: { page, pageSize: 15 } })).data,
    refetchInterval: 15000,
  });
  if (!data) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-[14px] font-bold text-on-surface">Movimientos recientes</h3>
      {data.movements.length === 0 ? (
        <p className="text-[13px] text-outline">Todavía no hay solicitudes.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11px] font-bold uppercase tracking-wide text-outline">
                <th className="px-3 py-2.5">Hora</th><th className="px-3 py-2.5">Llave</th><th className="px-3 py-2.5">Recurso</th><th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">ms</th><th className="px-3 py-2.5">Origen</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m) => (
                <tr key={m.id} className="border-b border-surface-container last:border-b-0">
                  <td className="px-3 py-2 text-on-surface-variant">{fmtDate(m.createdAt)}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.key?.name}</td>
                  <td className="px-3 py-2 font-mono text-on-surface">{m.method} {m.endpoint}</td>
                  <td className={`px-3 py-2 font-bold ${m.status >= 400 ? "text-error" : "text-verified-dark"}`}>{m.status}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.ms}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{m.origin ?? m.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <button className={BTN_GHOST} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <span className="text-[12px] text-outline">Página {data.page} de {data.pageCount}</span>
        <button className={BTN_GHOST} disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

// Bloque 299 (pedido explícito — panel del socio con la estructura de Baznova): el admin le da al socio acceso
// a /socio con el correo de contacto del socio. La clave temporal se muestra UNA sola vez; "Reiniciar" crea otra.
function PortalAccessCard({ partner }) {
  const qc = useQueryClient();
  const [access, setAccess] = useState(null);
  const grant = useMutation({
    mutationFn: async () => (await api.post(`/admin/partners/${partner.id}/portal-access`, {})).data.access,
    onSuccess: (a) => {
      setAccess(a);
      qc.invalidateQueries({ queryKey: ["admin-partner", partner.id] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo crear el acceso."),
  });
  const has = !!partner.portal;
  return (
    <div className={`${CARD} mb-5 p-4`}>
      <p className={LABEL}>Acceso del socio a su panel</p>
      {has && !access && (
        <p className="mb-2 text-[13px] text-on-surface-variant">
          Entra en <code>{window.location.origin}/socio/ingresar</code> con <b>{partner.portal.email}</b>
          {partner.portal.lastLoginAt ? ` · último ingreso ${new Date(partner.portal.lastLoginAt).toLocaleString("es-CU")}` : " · todavía no ha entrado"}.
        </p>
      )}
      {!has && !access && <p className="mb-2 text-[13px] text-on-surface-variant">Todavía no tiene acceso. Se crea con el correo de contacto ({partner.contactEmail}) y una clave temporal.</p>}
      {access && (
        <div className="mb-3 rounded-xl bg-surface-container px-3.5 py-3 text-[13px]">
          <p className="font-bold text-on-surface">Entrega estos datos al socio (la clave no se vuelve a mostrar):</p>
          <p className="mt-1">Dirección: <code>{access.loginUrl}</code></p>
          <p>Correo: <code>{access.email}</code></p>
          <p>Clave temporal: <code>{access.temporaryPassword}</code></p>
        </div>
      )}
      <button className={BTN_GHOST} disabled={grant.isPending} onClick={() => grant.mutate()}>
        {has ? "Reiniciar clave de acceso" : "Dar acceso al panel"}
      </button>
    </div>
  );
}

function PartnerDetail({ id, onBack }) {
  const qc = useQueryClient();
  const [keyModal, setKeyModal] = useState(null); // { existing? }
  const [secret, setSecret] = useState(null);
  const [revoke, setRevoke] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-partner", id],
    queryFn: async () => (await api.get(`/admin/partners/${id}`)).data,
    refetchInterval: 10000,
  });
  const { data: scopeData } = useQuery({
    queryKey: ["admin-partner-scopes"],
    queryFn: async () => (await api.get("/admin/partners/scopes")).data,
    staleTime: Infinity,
  });

  const patch = useMutation({
    mutationFn: async (body) => (await api.patch(`/admin/partners/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-partner", id] });
      qc.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo actualizar.")),
  });
  const doRevoke = useMutation({
    mutationFn: async (keyId) => (await api.post(`/admin/partners/${id}/keys/${keyId}/revoke`)).data,
    onSuccess: () => {
      toast.success("Llave revocada.");
      setRevoke(null);
      qc.invalidateQueries({ queryKey: ["admin-partner", id] });
    },
    onError: (e) => toast.error(errMsg(e, "No se pudo revocar.")),
  });

  if (isLoading || !data) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  const { partner, keys, usage } = data;
  const maxDay = Math.max(1, ...usage.byDay.map((d) => d.requests));

  return (
    <div className="max-w-[1000px]">
      <button onClick={onBack} className={`${BTN_GHOST} mb-4`}><ArrowLeft className="h-4 w-4" /> Socios</button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">{partner.name}</h1>
          <p className="text-[13px] text-outline">{partner.contactEmail}{partner.contactName ? ` · ${partner.contactName}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill ok={partner.status === "ACTIVE"} />
          <button className={BTN_GHOST} disabled={patch.isPending} onClick={() => patch.mutate({ status: partner.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>
            {partner.status === "ACTIVE" ? <><Ban className="h-4 w-4" /> Suspender</> : <><CheckCircle2 className="h-4 w-4" /> Reactivar</>}
          </button>
        </div>
      </div>

      <div className={`${CARD} mb-5 p-4`}>
        <p className={LABEL}>Enlace de socio para registrar tiendas</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-h-[44px] flex-1 break-all rounded-xl bg-surface-container px-3 py-3 text-[12.5px] text-on-surface">{partner.signupUrl}</code>
          <button className={BTN_GHOST} onClick={async () => { (await copyToClipboard(partner.signupUrl)) ? toast.success("Enlace copiado.") : toast.error("No se pudo copiar."); }}><Copy className="h-4 w-4" /> Copiar</button>
        </div>
        <label className="mt-3 flex min-h-[44px] items-center gap-3 text-[13px] text-on-surface">
          <input type="checkbox" className="h-5 w-5" checked={partner.listInMarketplace} disabled={patch.isPending} onChange={(e) => patch.mutate({ listInMarketplace: e.target.checked })} />
          Las tiendas nuevas del socio también salen en el marketplace de Baznova
        </label>
        <p className="text-[12px] text-outline">Tiendas registradas por este enlace: <b>{fmt(partner.stores)}</b>. Este ajuste aplica a las tiendas que se registren desde ahora.</p>
      </div>

      <PortalAccessCard partner={partner} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hoy" value={fmt(usage.requestsToday)} hint="solicitudes" />
        <Stat label="Últimos 30 días" value={fmt(usage.requests)} hint="solicitudes" />
        <Stat label="Errores" value={fmt(usage.errors)} hint={`${fmt(usage.rejected)} rechazadas por límite o sitio`} />
        <Stat label="Tiempo medio" value={`${fmt(usage.avgMs)} ms`} />
      </div>

      {usage.byDay.length > 0 && (
        <div className={`${CARD} mb-5 p-4`}>
          <p className="mb-3 text-[13px] font-bold text-on-surface">Solicitudes por día</p>
          <div className="flex h-28 items-end gap-1">
            {usage.byDay.map((d) => (
              <div key={d.day} title={`${d.day}: ${fmt(d.requests)}`} className="max-w-[48px] flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(3, (d.requests / maxDay) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-on-surface">Credencial de la API</h2>
        {!keys.some((k) => k.status === "ACTIVE") && <button className={BTN_PRIMARY} onClick={() => setKeyModal({})}><Plus className="h-4 w-4" /> Crear credencial</button>}
      </div>
      {keys.length === 0 ? (
        <EmptyState icon={KeyRound} title="Sin credencial" description="Crea la credencial del socio para que empiece a usar la API." />
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <div key={k.id} className={`${CARD} p-4 ${k.status === "REVOKED" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-bold text-on-surface">{k.name}</p>
                  <p className="font-mono text-[12px] text-outline">{k.prefix}…</p>
                </div>
                <StatusPill ok={k.status === "ACTIVE"} yes="Activa" no="Revocada" />
              </div>
              <div className="mt-2 text-[12.5px] text-on-surface-variant">
                {k.allowedDomains.length > 0 && <p>Dominios: {k.allowedDomains.join(", ")}</p>}
                {k.allowedIps.length > 0 && <p>IP: {k.allowedIps.join(", ")}</p>}
                <p>Permisos: {k.scopes.length} de {scopeData?.scopes.length ?? ""} · Último uso: {fmtDate(k.lastUsedAt)}{k.expiresAt ? ` · Vence ${new Date(k.expiresAt).toLocaleDateString("es-CU")}` : ""}</p>
              </div>
              {k.live && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><p className="mb-1 text-[11.5px] font-bold text-outline">Minuto actual</p><QuotaBar used={k.live.minuteUsed} limit={k.live.minuteLimit} /></div>
                  <div><p className="mb-1 text-[11.5px] font-bold text-outline">Hoy (UTC)</p><QuotaBar used={k.live.dayUsed} limit={k.live.dayLimit} /></div>
                </div>
              )}
              {k.status === "ACTIVE" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={BTN_GHOST} onClick={() => setKeyModal({ existing: k })}>Editar</button>
                  <button className={`${BTN} border border-error/40 text-error hover:bg-error/5`} onClick={() => setRevoke(k)}>Revocar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {usage.byEndpoint.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-[14px] font-bold text-on-surface">Recursos más usados</h3>
          <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
            <table className="w-full text-left text-[12.5px]">
              <tbody>
                {usage.byEndpoint.map((e) => (
                  <tr key={e.endpoint} className="border-b border-surface-container last:border-b-0">
                    <td className="px-3 py-2 font-mono text-on-surface">{e.endpoint}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{fmt(e.requests)}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{e.errors} errores</td>
                    <td className="px-3 py-2 text-on-surface-variant">{e.avgMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Movements partnerId={id} />

      {keyModal && scopeData && (
        <Modal wide title={keyModal.existing ? "Editar credencial" : "Nueva credencial"} onClose={() => setKeyModal(null)}>
          <KeyForm partnerId={id} scopes={scopeData.scopes} defaults={scopeData.defaults} existing={keyModal.existing} onDone={(s) => { setKeyModal(null); if (s) setSecret(s); else toast.success("Llave actualizada."); }} />
        </Modal>
      )}
      {secret && (
        <Modal title="Copia la llave ahora" onClose={() => setSecret(null)}>
          <p className="mb-3 text-[13px] text-on-surface-variant">Es la única vez que se muestra completa. Si se pierde, hay que crear otra.</p>
          <code className="block break-all rounded-xl bg-surface-container p-3 text-[12.5px] text-on-surface">{secret}</code>
          <button className={`${BTN_PRIMARY} mt-3 w-full`} onClick={async () => { (await copyToClipboard(secret)) ? toast.success("Llave copiada.") : toast.error("No se pudo copiar."); }}><Copy className="h-4 w-4" /> Copiar llave</button>
        </Modal>
      )}
      <ConfirmModal
        open={!!revoke}
        title="¿Revocar esta llave?"
        message="Deja de funcionar de inmediato y no se puede volver a activar."
        confirmLabel={doRevoke.isPending ? "Revocando..." : "Revocar"}
        danger
        confirmDisabled={doRevoke.isPending}
        onConfirm={() => doRevoke.mutate(revoke.id)}
        onCancel={() => setRevoke(null)}
      />
    </div>
  );
}

export default function AdminPartners() {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
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
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Socios de la API</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Empresas que muestran productos de Baznova en su sitio y traen tiendas con su enlace.{" "}
        <a href="/api-socios" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-tertiary-accent hover:underline">Ver documentación <ExternalLink className="h-3.5 w-3.5" /></a>
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${INPUT} max-w-xs`} placeholder="Buscar socio" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={BTN_PRIMARY} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nuevo socio</button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && !data?.partners.length && <EmptyState icon={Plug} title="Todavía no hay socios" description="Crea el primero para darle sus llaves de la API." />}

      {data?.partners.length > 0 && (
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
