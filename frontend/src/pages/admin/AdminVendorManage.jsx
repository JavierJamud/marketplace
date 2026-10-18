import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, ExternalLink, History, KeyRound, ListChecks, MonitorSmartphone, Users } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { timeAgo, exactDate } from "../../lib/relativeTime.js";
import { CARD } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { NotifyVendorCheckbox } from "../../components/admin/NotifyVendorCheckbox.jsx";
import { notifyVendorConfig } from "../../lib/notifyVendor.js";
import { AdminVendorStaffModal } from "../../components/admin/AdminVendorStaffModal.jsx";
import { RepresentativeFileModal } from "../../components/admin/RepresentativeFileModal.jsx";
import { EditVendorModal, StatsModal } from "./AdminVendors.jsx";

// Gestionar una tienda (/admin/tiendas/:id): estado, lo que le falta configurar, accesos y dispositivos, equipo, asistente,
// actividad y errores, con todas las acciones que antes estaban en el menú de tres puntos de la lista.
const VERIFICATION_LABEL = {
  NOT_STARTED: "Sin verificar",
  PENDING_DOCS: "Faltan documentos",
  IN_REVIEW: "En revisión",
  PENDING_PAYMENT: "Pago pendiente",
  VERIFIED: "Verificada",
  PAYMENT_FAILED: "Pago fallido",
  REJECTED: "Rechazada",
  SUSPENDED: "Verificación suspendida",
};
const ROLE_LABEL = { VENDOR: "Dueño", VENDOR_STAFF: "Equipo", ADMIN: "Admin", CUSTOMER: "Cliente" };

function Section({ icon: Icon, title, children, action }) {
  return (
    <section className={`${CARD} p-4 sm:p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14.5px] font-bold text-on-surface">
          <Icon className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Chip({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-surface-container text-on-surface-variant",
    good: "bg-verified/10 text-verified-dark",
    warn: "bg-secondary-container/25 text-secondary",
    bad: "bg-error/10 text-error",
    teal: "bg-tertiary-accent/10 text-tertiary-accent",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${tones[tone]}`}>{children}</span>;
}

export default function AdminVendorManage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // edit | stats | rep | staff | block | delete | permanent | plan
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-vendor-manage", id], queryFn: async () => (await api.get(`/admin/vendors/${id}/manage`)).data });

  const done = (msg) => {
    if (msg) toast.success(msg);
    setModal(null);
    setReason("");
    setNotify(false);
    queryClient.invalidateQueries({ queryKey: ["admin-vendor-manage", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-suspended-vendors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
  };
  const fail = (fallback) => (err) => {
    if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? fallback);
  };

  const update = useMutation({
    mutationFn: async ({ payload, notify: n = false }) => (await api.patch(`/admin/vendors/${id}`, payload, notifyVendorConfig(n))).data,
    onSuccess: () => done("Tienda actualizada"),
    onError: fail("No se pudo actualizar la tienda."),
  });
  const reactivate = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendors/${id}/reactivate`, { reason: reason.trim() }, notifyVendorConfig(notify))).data,
    onSuccess: () => done("Tienda reactivada"),
    onError: fail("No se pudo reactivar."),
  });
  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/admin/vendors/${id}`)).data,
    onSuccess: () => done("La tienda pasó a eliminación pendiente"),
    onError: fail("No se pudo eliminar la tienda."),
  });
  const restore = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendors/${id}/restore-deletion`)).data,
    onSuccess: () => done("Tienda restaurada"),
    onError: fail("No se pudo restaurar la tienda."),
  });
  const removeForever = useMutation({
    mutationFn: async () => api.delete(`/admin/vendors/${id}/permanent`),
    onSuccess: () => {
      toast.success("Tienda eliminada definitivamente");
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      navigate("/admin/tiendas");
    },
    onError: (err) => {
      setModal(null);
      fail("No se pudo eliminar la tienda.")(err);
    },
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  if (isError || !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-md text-error">No se pudo cargar la tienda.</p>
        <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
      </div>
    );
  }

  const { vendor: v, owner, staff, counts, missing, access, activity, errors, assistant } = data;
  const pendingDeletion = !!v.adminDeletionRequestedAt;
  const suspendedByInactivity = v.status === "SUSPENDED";
  const btn = "min-h-10";

  return (
    <div className="max-w-[1180px]">
      <Link to="/admin/tiendas" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tiendas
      </Link>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full font-display text-lg font-bold text-white" style={{ background: v.color ?? "#232F3E" }} aria-hidden="true">
            {v.companyName[0]?.toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 truncate font-display text-[24px] font-extrabold tracking-tight text-on-surface">
              {v.companyName} {v.verificationStatus === "VERIFIED" && !v.trial.active && <VerifiedBadge size="sm" />}
            </h1>
            <p className="text-[12.5px] text-outline">
              {[v.category, v.locations.join(", ")].filter(Boolean).join(" · ") || "Sin rubro ni provincia"} · registrada {timeAgo(v.createdAt).toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={v.planType === "BUSINESS" ? "warn" : "neutral"}>{v.planName}</Chip>
          {v.trial.active ? (
            <Chip tone={v.trial.daysLeft <= 7 ? "bad" : "teal"}>Free 30 días · {v.trial.daysLeft === 1 ? "queda 1 día" : `quedan ${v.trial.daysLeft} días`}</Chip>
          ) : (
            <Chip tone={v.verificationStatus === "VERIFIED" ? "good" : "neutral"}>{VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}</Chip>
          )}
          {v.isBlocked && <Chip tone="bad">Bloqueada</Chip>}
          {suspendedByInactivity && <Chip tone="bad">Suspendida por inactividad</Chip>}
          {pendingDeletion && <Chip tone="bad">Eliminación pendiente</Chip>}
        </div>
      </div>

      {v.isBlocked && v.blockReason && <p className="mb-4 rounded-xl bg-error/5 px-3 py-2 text-[13px] text-error">Motivo del bloqueo: {v.blockReason}</p>}

      <div className="mb-5 flex flex-wrap gap-2">
        <a href={`/tienda/${v.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded border border-outline px-3 text-label-sm font-semibold text-on-surface hover:bg-surface-container">
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Ver tienda
        </a>
        {pendingDeletion ? (
          <>
            <Button size="sm" className={btn} onClick={() => restore.mutate()} disabled={restore.isPending}>Restaurar tienda</Button>
            <Button size="sm" variant="danger" className={btn} onClick={() => setModal("permanent")}>Eliminar definitivamente</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" className={btn} onClick={() => setModal("edit")}>Editar</Button>
            <Button size="sm" variant="outline" className={btn} onClick={() => setModal("rep")}>Responsable</Button>
            <Button size="sm" variant="outline" className={btn} onClick={() => setModal("staff")}>Usuarios del sistema</Button>
            <Button size="sm" variant="outline" className={btn} onClick={() => setModal("stats")}>Estadísticas</Button>
            <Button size="sm" variant="outline" className={btn} onClick={() => setModal("plan")}>{v.planType === "BUSINESS" ? "Pasar a Regular" : "Pasar a Business"}</Button>
            {v.isBlocked ? (
              <Button size="sm" className={btn} onClick={() => update.mutate({ payload: { isBlocked: false } })} disabled={update.isPending}>Desbloquear</Button>
            ) : (
              <Button size="sm" variant="outline" className={btn} onClick={() => setModal("block")}>Bloquear</Button>
            )}
            {suspendedByInactivity && <Button size="sm" className={btn} onClick={() => setModal("reactivate")}>Reactivar</Button>}
            <Button size="sm" variant="ghost" className={`${btn} text-error`} onClick={() => setModal("delete")}>Eliminar</Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section icon={ListChecks} title="Configuración">
          {missing.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-verified-dark">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Tiene todo configurado.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12.5px] text-on-surface-variant">Le falta:</p>
              <ul className="flex flex-wrap gap-1.5">
                {missing.map((m) => (
                  <li key={m} className="rounded-full bg-secondary-container/20 px-2.5 py-1 text-[12px] font-semibold text-on-surface">{m}</li>
                ))}
              </ul>
            </>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[
              ["Productos activos", `${counts.activeProducts} de ${counts.products}`],
              ["Pedidos (30 días)", counts.orders30],
              ["Ventas en caja (30 días)", counts.posSales30],
              ["Horarios", counts.schedules ? "Sí" : "No"],
              ["Códigos y ofertas", counts.discountCodes + counts.storeOffers],
              v.isRestaurant ? ["Mesas", counts.tables] : ["Moneda", v.currency],
            ].map(([k, val]) => (
              <div key={k} className="rounded-xl bg-surface-container/60 px-3 py-2">
                <dt className="text-[11.5px] text-outline">{k}</dt>
                <dd className="text-[14px] font-extrabold text-on-surface">{val}</dd>
              </div>
            ))}
          </dl>
          {v.trial.active && <p className="mt-3 text-[12px] text-on-surface-variant">La prueba gratis termina el {exactDate(v.trial.endsAt)}. Después pasa sola a Regular con los límites de ese plan.</p>}
        </Section>

        <Section icon={MonitorSmartphone} title="Accesos y dispositivos">
          <p className="text-[13px] text-on-surface">
            Último acceso del dueño: <strong title={exactDate(access.lastLoginAt)}>{access.lastLoginAt ? timeAgo(access.lastLoginAt) : "nunca"}</strong>
            {" · "}
            {access.trustedDevices} {access.trustedDevices === 1 ? "dispositivo de confianza" : "dispositivos de confianza"}
          </p>
          <p className="mb-2 text-[12px] text-outline">Correo de acceso: {owner.email}</p>
          {access.sessions.length === 0 ? (
            <p className="text-[13px] text-on-surface-variant">Sin sesiones registradas.</p>
          ) : (
            <ul className="divide-y divide-surface-container-high">
              {access.sessions.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-on-surface">{s.browser} en {s.os} · {s.device}</p>
                    <p className="truncate text-[12px] text-on-surface-variant">{s.who} · entró {timeAgo(s.createdAt).toLowerCase()}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[12px] text-on-surface-variant" title={exactDate(s.lastUsedAt)}>usada {timeAgo(s.lastUsedAt).toLowerCase()}</p>
                    {s.active ? <span className="text-[11px] font-bold text-verified-dark">Abierta</span> : <span className="text-[11px] text-outline">Cerrada</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Users} title="Equipo">
          <p className="mb-2 text-[13px] text-on-surface">
            {owner.fullName ?? "Sin nombre"} (dueño){v.whatsapp ? ` · WhatsApp ${v.whatsapp}` : ""}
          </p>
          {staff.length === 0 ? (
            <p className="text-[13px] text-on-surface-variant">No tiene usuarios del sistema.</p>
          ) : (
            <ul className="divide-y divide-surface-container-high">
              {staff.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-on-surface">{m.name ?? m.email}</p>
                    <p className="truncate text-[12px] text-on-surface-variant">{m.sections.length} {m.sections.length === 1 ? "sección" : "secciones"} · {m.lastLoginAt ? `entró ${timeAgo(m.lastLoginAt).toLowerCase()}` : "nunca entró"}</p>
                  </div>
                  {!m.isActive && <Chip tone="bad">Desactivado</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={Bot} title="Asistente e inteligencia artificial" action={<Link to="/admin/asistente" className="text-[12.5px] font-bold text-tertiary-accent">Entrenar el asistente</Link>}>
          <ul className="space-y-1.5 text-[13px] text-on-surface">
            <li>Chat con IA en su tienda: <strong>{assistant.chatbotAllowedByPlan ? "incluido en su plan" : "no incluido en su plan"}</strong></li>
            <li>Documento para el chat: <strong>{assistant.hasAiDocument ? assistant.aiDocumentName ?? "cargado" : "no subió ninguno"}</strong></li>
            <li>Preguntas de clientes al chat (30 días): <strong>{assistant.chatQuestions30}</strong></li>
            <li>Preguntas al asistente de negocio (30 días): <strong>{assistant.assistantQuestions30}</strong></li>
            <li>Programa de fidelidad: <strong>{assistant.loyaltyEnabled ? "encendido" : "apagado"}</strong></li>
          </ul>
        </Section>

        <Section icon={History} title="Actividad reciente">
          {activity.length === 0 ? (
            <p className="text-[13px] text-on-surface-variant">Sin actividad registrada.</p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-surface-container-high overflow-y-auto">
              {activity.map((a) => (
                <li key={a.id} className="py-2">
                  <p className="text-[13px] text-on-surface">{a.description}</p>
                  <p className="text-[11.5px] text-outline" title={exactDate(a.createdAt)}>
                    {a.who ?? ROLE_LABEL[a.role] ?? ""} · {timeAgo(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={AlertTriangle} title="Errores" action={<Link to="/admin/errores" className="text-[12.5px] font-bold text-tertiary-accent">Ir a Errores</Link>}>
          {errors.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-verified-dark">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Nadie de esta tienda tuvo errores registrados.
            </p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-surface-container-high overflow-y-auto">
              {errors.map((e) => (
                <li key={e.id} className="py-2">
                  <p className="text-[13px] text-on-surface">{e.message}</p>
                  <p className="text-[11.5px] text-outline">
                    {e.path ? `${e.path} · ` : ""}
                    {timeAgo(e.createdAt)} · {e.resolved ? "resuelto" : "sin resolver"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-outline">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Los cambios de plan, bloqueos y eliminaciones piden el código que llega a tu correo.
      </p>

      {modal === "edit" && <EditVendorModal vendor={v} saving={update.isPending} onCancel={() => setModal(null)} onSave={(form) => update.mutateAsync({ payload: form })} />}
      {modal === "stats" && <StatsModal vendorName={{ id: v.id, companyName: v.companyName }} onClose={() => setModal(null)} />}
      {modal === "rep" && <RepresentativeFileModal vendor={{ id: v.id, companyName: v.companyName }} onClose={() => setModal(null)} />}
      {modal === "staff" && <AdminVendorStaffModal vendor={{ id: v.id, companyName: v.companyName }} onClose={() => setModal(null)} />}

      <ConfirmModal
        open={modal === "plan"}
        title={v.planType === "BUSINESS" ? `¿Pasar "${v.companyName}" a Regular?` : `¿Pasar "${v.companyName}" a Business?`}
        message={v.planType === "BUSINESS" ? "Pierde las funciones Premium y se aplican los límites del plan Regular. Los productos que pasen del cupo quedan ocultos, no se borran." : "Tiene todas las funciones Premium sin pasar por el pago. Para cobrarle usa Suscripciones."}
        confirmLabel={update.isPending ? "Guardando..." : "Sí, cambiar"}
        confirmDisabled={update.isPending}
        onConfirm={() => update.mutate({ payload: { planType: v.planType === "BUSINESS" ? "REGULAR" : "BUSINESS" }, notify })}
        onCancel={() => setModal(null)}
      >
        <NotifyVendorCheckbox checked={notify} onChange={setNotify} />
      </ConfirmModal>

      <ConfirmModal
        open={modal === "block"}
        title={`¿Bloquear "${v.companyName}"?`}
        message="La tienda se oculta de todo el sitio. El dueño puede entrar a su panel, ve el motivo y no puede usar ninguna sección hasta que la desbloquees."
        confirmLabel={update.isPending ? "Bloqueando..." : "Sí, bloquear"}
        danger
        confirmDisabled={reason.trim().length < 5 || update.isPending}
        onConfirm={() => update.mutate({ payload: { isBlocked: true, blockReason: reason.trim() }, notify })}
        onCancel={() => setModal(null)}
      >
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del bloqueo (obligatorio, lo verá el vendedor)..." rows={3} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent" />
        <NotifyVendorCheckbox checked={notify} onChange={setNotify} />
      </ConfirmModal>

      <ConfirmModal
        open={modal === "reactivate"}
        title={`¿Reactivar "${v.companyName}"?`}
        message="Vuelve a verse en todo el sitio y su dueño puede volver a entrar al panel. Se le avisa por correo con el motivo que escribas."
        confirmLabel={reactivate.isPending ? "Reactivando..." : "Sí, reactivar"}
        confirmDisabled={reason.trim().length < 5 || reactivate.isPending}
        onConfirm={() => reactivate.mutate()}
        onCancel={() => setModal(null)}
      >
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo de la reactivación (obligatorio)..." rows={3} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent" />
        <NotifyVendorCheckbox checked={notify} onChange={setNotify} />
      </ConfirmModal>

      <ConfirmModal
        open={modal === "delete"}
        title={`¿Eliminar "${v.companyName}"?`}
        message="La tienda se oculta de todo el sitio y su dueño no podrá entrar. No se borra todavía: queda en eliminación pendiente durante el plazo configurado en Seguridad, y puedes restaurarla mientras tanto."
        confirmLabel={remove.isPending ? "Eliminando..." : "Continuar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setModal(null)}
      />
      {modal === "permanent" && (
        <ConfirmDeleteModal
          title={`¿Eliminar definitivamente "${v.companyName}"?`}
          description="Se elimina ya, sin esperar el plazo. Sus pedidos y reseñas históricos se conservan, pero la tienda y su cuenta no se pueden recuperar."
          confirmLabel="Eliminar definitivamente"
          pending={removeForever.isPending}
          onCancel={() => setModal(null)}
          onConfirm={() => removeForever.mutate()}
        />
      )}
    </div>
  );
}
