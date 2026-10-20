import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleDashed, CreditCard, ExternalLink, KeyRound, ListChecks, MonitorSmartphone, Users } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { timeAgo, exactDate, exactDateTime } from "../../lib/relativeTime.js";
import { formatPrice } from "../../lib/format.js";
import { resolvePaymentMethod } from "../../lib/paymentMethods.js";
import { sectionForPath } from "../../lib/vendorSections.js";
import { StatusChip } from "../../components/admin/AdminSupportTickets.jsx";
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
import { VendorUsageSection } from "../../components/admin/VendorUsage.jsx";
import { VendorAvatar } from "../../components/ui/VendorAvatar.jsx";
import { PanelSkeleton } from "../../components/ui/Skeleton.jsx";

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
  const [modal, setModal] = useState(null); // edit | stats | rep | staff | block | delete | permanent | plan | downgrade
  const [downgradeWhen, setDowngradeWhen] = useState("period_end");
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
  // Pasar a Regular ahora o al terminar lo que ya tiene, o anular un cambio programado (ver planDowngrade.service.js).
  const downgrade = useMutation({
    mutationFn: async ({ when, reason: r }) => (await api.post(`/admin/vendors/${id}/downgrade`, { when, reason: r })).data,
    onSuccess: (_, { when }) =>
      done(when === "now" ? "La tienda pasó al plan Regular" : when === "cancel" ? "Se anuló el cambio programado" : "Cambio a Regular programado"),
    onError: fail("No se pudo cambiar el plan."),
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

  if (isLoading) return <PanelSkeleton />;
  if (isError || !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-md text-error">No se pudo cargar la tienda.</p>
        <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
      </div>
    );
  }

  const { vendor: v, owner, staff, counts, access, errors, assistant, requirements = [], extras = [], plan, usage, tickets = [] } = data;
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
          <VendorAvatar vendor={v} className="h-12 w-12 rounded-full text-lg" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 truncate font-display text-[24px] font-extrabold tracking-tight text-on-surface">
              {v.companyName} {v.verificationStatus === "VERIFIED" && !v.trial.active && <VerifiedBadge size="sm" />}
            </h1>
            <p className="text-[12.5px] text-outline">{[v.category, v.locations.join(", ")].filter(Boolean).join(" · ") || "Sin rubro ni provincia"}</p>
            <p className="text-[12.5px] text-on-surface-variant">
              Registró la tienda el <strong className="font-semibold text-on-surface">{exactDateTime(v.createdAt)}</strong> ({timeAgo(v.createdAt).toLowerCase()})
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
          {v.planDowngradeAt && <Chip tone="bad">Pasa a Regular el {exactDate(v.planDowngradeAt)}</Chip>}
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
            {v.planDowngradeAt ? (
              <Button size="sm" variant="outline" className={btn} onClick={() => downgrade.mutate({ when: "cancel" })} disabled={downgrade.isPending}>
                Anular paso a Regular
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className={btn}
                onClick={() => {
                  setDowngradeWhen(v.premiumUntil && new Date(v.premiumUntil) > new Date() ? "period_end" : "now");
                  setModal(v.planType === "BUSINESS" ? "downgrade" : "plan");
                }}
              >
                {v.planType === "BUSINESS" ? "Pasar a Regular" : "Pasar a Business"}
              </Button>
            )}
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
        {plan && usage && <PlanUsageSection v={v} plan={plan} usage={usage} counts={counts} />}

        <RequirementsSection requirements={requirements} extras={extras} />

        <Section icon={MonitorSmartphone} title="Accesos y dispositivos">
          <p className="text-[13px] text-on-surface">
            Último acceso del dueño: <strong title={exactDate(access.lastLoginAt)}>{access.lastLoginAt ? timeAgo(access.lastLoginAt) : "nunca"}</strong>
            {" · "}
            {access.trustedDevices} {access.trustedDevices === 1 ? "dispositivo de confianza" : "dispositivos de confianza"}
          </p>
          <p className="mb-2 text-[12px] text-outline">Correo de acceso: {owner.email}</p>
          {access.sessions.length === 0 ? <p className="text-[13px] text-on-surface-variant">Sin sesiones registradas.</p> : <DeviceGroups sessions={access.sessions} />}
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

        <div className="lg:col-span-2">
          <VendorUsageSection vendorId={v.id} />
        </div>

        <Section icon={AlertTriangle} title="Errores" action={<Link to="/admin/errores" className="text-[12.5px] font-bold text-tertiary-accent">Ir a Errores</Link>}>
          {errors.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-verified-dark">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Nadie de esta tienda tuvo errores registrados.
            </p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-surface-container-high overflow-y-auto">
              {errors.map((e) => (
                <ErrorRow key={e.id} e={e} />
              ))}
            </ul>
          )}
          {tickets.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-wide text-outline">Problemas que reportó con captura</h3>
              <ul className="divide-y divide-surface-container-high">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link to={`/admin/errores?tab=tickets&ticket=${t.id}`} className="block py-2 hover:bg-surface-container/40">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-bold text-on-surface">{t.code}</span>
                        <StatusChip status={t.status} />
                        {t.section && <Chip tone="teal">{t.section}</Chip>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-on-surface">{t.description}</span>
                      <span className="text-[11.5px] text-outline">
                        {t.reporterName ?? "Sin nombre"} · {exactDateTime(t.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
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
        open={modal === "downgrade"}
        title={`¿Pasar "${v.companyName}" al plan Regular?`}
        message="Pierde las funciones Premium y se aplican los límites del plan Regular. Los productos que pasen del cupo quedan ocultos, no se borran. Conserva la insignia de verificada si ya la tiene."
        confirmLabel={downgrade.isPending ? "Guardando..." : downgradeWhen === "now" ? "Pasar a Regular ahora" : "Programar el cambio"}
        confirmDisabled={reason.trim().length < 5 || downgrade.isPending}
        onConfirm={() => downgrade.mutate({ when: downgradeWhen, reason: reason.trim() })}
        onCancel={() => setModal(null)}
      >
        <fieldset className="mb-3 flex flex-col gap-2">
          <legend className="mb-1.5 text-[12.5px] font-bold text-on-surface">¿Cuándo?</legend>
          {[
            {
              value: "period_end",
              label: v.premiumUntil && new Date(v.premiumUntil) > new Date() ? `Al terminar lo que ya tiene (${exactDate(v.premiumUntil)})` : "Al terminar lo que ya tiene",
              hint: v.trial.active
                ? "Sigue con la prueba gratis hasta esa fecha y después pasa sola a Regular."
                : `Sigue con Premium hasta esa fecha y no se le renueva${v.paysWithCard ? " el cobro con tarjeta" : ""}.`,
              disabled: !(v.premiumUntil && new Date(v.premiumUntil) > new Date()),
            },
            { value: "now", label: "Ahora mismo", hint: v.paysWithCard ? "Pierde Premium al instante y se cancela su suscripción con tarjeta." : "Pierde Premium al instante." },
          ].map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${downgradeWhen === o.value ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant"} ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input type="radio" name="downgrade-when" value={o.value} checked={downgradeWhen === o.value} disabled={o.disabled} onChange={() => setDowngradeWhen(o.value)} className="mt-1" />
              <span>
                <span className="block text-[13px] font-bold text-on-surface">{o.label}</span>
                <span className="block text-[12px] text-on-surface-variant">{o.disabled ? "No tiene una prueba ni un periodo pagado en curso." : o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="downgrade-reason" className="mb-1 block text-[12.5px] font-bold text-on-surface">
          Motivo (lo verá la tienda)
        </label>
        <textarea
          id="downgrade-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: no cumple las condiciones del plan Premium"
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
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


const PLAN_KIND = {
  FREE: { label: "Plan gratis", tone: "neutral" },
  TRIAL: { label: "Prueba gratis de Premium", tone: "teal" },
  PAID: { label: "Plan de pago", tone: "good" },
};
const PAYMENT_METHOD = { CARD: "tarjeta", CUP_TRANSFER: "transferencia en CUP", MANUAL: "pago registrado por el equipo" };

// Plan y uso: qué plan tiene (gratis, prueba o de pago), cuánto usa de cada límite y cómo usa la plataforma en 30 días.
function PlanUsageSection({ v, plan, usage, counts }) {
  const kind = PLAN_KIND[plan.kind] ?? PLAN_KIND.FREE;
  return (
    <Section icon={CreditCard} title="Plan y uso">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip tone={kind.tone}>{kind.label}</Chip>
        <Chip>{plan.name}</Chip>
      </div>
      <p className="mb-3 text-[12.5px] text-on-surface-variant">
        {plan.kind === "TRIAL" && <>La prueba termina el {exactDate(v.trial.endsAt)}. Después pasa sola al plan gratis con sus límites.</>}
        {plan.kind === "PAID" && (
          <>
            {plan.nextPaymentDueDate ? <>Próximo pago: {exactDate(plan.nextPaymentDueDate)}. </> : null}
            {plan.paymentMethod ? <>Paga con {PAYMENT_METHOD[plan.paymentMethod] ?? plan.paymentMethod}. </> : null}
            {plan.paymentConfirmedAt ? <>Último pago confirmado el {exactDate(plan.paymentConfirmedAt)}.</> : null}
          </>
        )}
        {plan.kind === "FREE" && <>Usa el plan gratuito con sus límites.</>}
      </p>

      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">Límites del plan</h3>
      <ul className="mb-4 space-y-1.5">
        {plan.limits.map((l) => {
          const pct = l.max ? Math.min(100, Math.round((l.used / l.max) * 100)) : 0;
          return (
            <li key={l.label} className="text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="text-on-surface-variant">{l.label}</span>
                <span className={`font-semibold ${l.max && l.used >= l.max ? "text-error" : "text-on-surface"}`}>{l.max ? `${l.used} de ${l.max}` : `${l.used} (sin límite)`}</span>
              </div>
              {l.max ? (
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-container">
                  <span className={`block h-full rounded-full ${pct >= 100 ? "bg-error" : "bg-tertiary-accent"}`} style={{ width: `${pct}%` }} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">Funciones de su plan</h3>
      <ul className="mb-4 flex flex-wrap gap-1.5">
        {plan.features.map((f) => (
          <li key={f.label}>
            <Chip tone={f.on ? "good" : "neutral"}>
              {f.on ? "" : "Sin "}
              {f.on ? f.label : f.label.toLowerCase()}
            </Chip>
          </li>
        ))}
      </ul>

      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">
        <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Uso en los últimos 30 días
      </h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ["Pedidos en línea", `${usage.orders}`, usage.orders ? formatPrice(usage.ordersTotal, usage.currency) : null],
          ["Ventas en caja", `${usage.posSales}`, usage.posSales ? formatPrice(usage.posTotal, usage.currency) : null],
          ["Días con actividad", `${usage.activeDays} de 30`, usage.lastActivityAt ? `Último uso ${timeAgo(usage.lastActivityAt).toLowerCase()}` : "Sin uso registrado"],
          ["Productos activos", `${counts.activeProducts} de ${counts.products}`, usage.productsCreated ? `${usage.productsCreated} nuevos` : null],
          ["Reseñas recibidas", `${usage.reviews}`, null],
          ["Moneda", v.currency, null],
        ].map(([k, val, sub]) => (
          <div key={k} className="min-w-0 rounded-xl bg-surface-container/60 px-3 py-2">
            <dt className="text-[11.5px] text-outline">{k}</dt>
            <dd className="text-[14px] font-extrabold text-on-surface">{val}</dd>
            {sub && <dd className="truncate text-[11.5px] text-on-surface-variant">{sub}</dd>}
          </div>
        ))}
      </dl>
      {usage.topActions.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-4 text-[12px] font-bold uppercase tracking-wide text-outline">Lo que más hace en su panel</h3>
          <ul className="space-y-1 text-[12.5px] text-on-surface">
            {usage.topActions.map((a) => (
              <li key={a.action} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{a.example}</span>
                <span className="flex-shrink-0 font-semibold text-on-surface-variant">{a.count} {a.count === 1 ? "vez" : "veces"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// Requisitos del plan Premium (los mismos de la prueba gratis y de la verificación): primero lo que falta, después lo que
// completó con el dato con que lo hizo, y aparte lo que ayuda a vender aunque no sea obligatorio.
function RequirementsSection({ requirements, extras }) {
  const done = requirements.filter((r) => r.done);
  const pending = requirements.filter((r) => !r.done);
  const pct = requirements.length ? Math.round((done.length / requirements.length) * 100) : 0;
  const extrasPending = extras.filter((x) => !x.done);
  return (
    <Section icon={ListChecks} title="Requisitos para Premium">
      <div className="mb-3">
        <div className="flex justify-between text-[12.5px]">
          <span className="text-on-surface-variant">{pending.length === 0 ? "Tiene todos los requisitos." : `Le faltan ${pending.length} de ${requirements.length}.`}</span>
          <span className="font-bold text-on-surface">{done.length} de {requirements.length}</span>
        </div>
        <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-container" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Requisitos completos">
          <span className={`block h-full rounded-full ${pct === 100 ? "bg-verified" : "bg-secondary-container"}`} style={{ width: `${pct}%` }} />
        </span>
      </div>

      {pending.length > 0 && (
        <>
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-error">Le falta</h3>
          <ul className="mb-4 space-y-1">
            {pending.map((r) => (
              <li key={r.key} className="flex items-center gap-2 text-[13px] text-on-surface">
                <CircleDashed className="h-4 w-4 flex-shrink-0 text-error" aria-hidden="true" /> {r.label}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">Completado</h3>
      {done.length === 0 ? (
        <p className="mb-4 text-[13px] text-on-surface-variant">Todavía no completó ninguno.</p>
      ) : (
        <dl className="mb-4 divide-y divide-surface-container-high">
          {done.map((r) => (
            <div key={r.key} className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3">
              <dt className="flex items-center gap-1.5 text-[12.5px] text-on-surface-variant">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-verified-dark" aria-hidden="true" /> {r.label}
              </dt>
              <dd className="min-w-0 break-words text-[13px] text-on-surface">
                {r.value ?? "Sí"}
                {r.at && <span className="text-on-surface-variant"> · {exactDateTime(r.at)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">Además ayuda a vender{extrasPending.length ? ` (le faltan ${extrasPending.length})` : ""}</h3>
      <dl className="divide-y divide-surface-container-high">
        {extras.map((x) => (
          <div key={x.key} className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3">
            <dt className="flex items-center gap-1.5 text-[12.5px] text-on-surface-variant">
              {x.done ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-verified-dark" aria-hidden="true" /> : <CircleDashed className="h-3.5 w-3.5 flex-shrink-0 text-outline" aria-hidden="true" />} {x.label}
            </dt>
            {/* No es obligatorio: lo que falta va en gris, no en rojo (el rojo se leía como un error de la tienda). */}
            <dd className={`min-w-0 break-words text-[13px] ${x.done ? "text-on-surface" : "text-on-surface-variant"}`}>
              {x.done ? (Array.isArray(x.value) ? x.value.map((m) => resolvePaymentMethod(m).label).join(", ") : x.value ?? "Sí") : "Todavía no lo configuró"}
              {!x.done && x.hint && <span className="block text-[11.5px] text-outline">{x.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

// Sesiones agrupadas por dispositivo (navegador, sistema y tipo): antes salía una fila por cada inicio de sesión y la lista
// se hacía interminable con el mismo celular repetido. Cada grupo se abre para ver sus sesiones.
function DeviceGroups({ sessions }) {
  const [open, setOpen] = useState(null);
  const groups = [];
  const byKey = new Map();
  for (const s of sessions) {
    const key = `${s.browser}|${s.os}|${s.device}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: `${s.browser} en ${s.os} · ${s.device}`, sessions: [], who: new Set() };
      byKey.set(key, g);
      groups.push(g);
    }
    g.sessions.push(s);
    g.who.add(s.who);
  }
  return (
    <ul className="divide-y divide-surface-container-high">
      {groups.map((g) => {
        const openCount = g.sessions.filter((s) => s.active).length;
        const last = g.sessions[0];
        const isOpen = open === g.key;
        return (
          <li key={g.key} className="py-1">
            <button type="button" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg py-1.5 text-left hover:bg-surface-container/50">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-on-surface">{g.title}</span>
                <span className="block truncate text-[12px] text-on-surface-variant">
                  {[...g.who].join(", ")} · {g.sessions.length} {g.sessions.length === 1 ? "sesión" : "sesiones"} · última {timeAgo(last.lastUsedAt).toLowerCase()}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {openCount > 0 ? <span className="text-[11.5px] font-bold text-verified-dark">{openCount} {openCount === 1 ? "abierta" : "abiertas"}</span> : <span className="text-[11.5px] text-outline">Cerradas</span>}
                <ChevronDown className={`h-4 w-4 text-outline transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </span>
            </button>
            {isOpen && (
              <ul className="mb-1 ml-1 border-l-2 border-surface-container-high pl-3">
                {g.sessions.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-1.5 text-[12px]">
                    <span className="min-w-0 text-on-surface-variant">
                      {s.who} · entró el {exactDateTime(s.createdAt)}
                    </span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block text-on-surface-variant">usada {exactDateTime(s.lastUsedAt)}</span>
                      {s.active ? <span className="font-bold text-verified-dark">Abierta</span> : <span className="text-outline">Cerrada</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const ERROR_ORIGIN = { REPORTE_USUARIO: "Reporte de la tienda", PAGINA: "La pantalla se rompió" };

// Un error de alguien de la tienda: en qué sección pasó, qué estaba haciendo y qué respondió el sistema.
function ErrorRow({ e }) {
  const where = sectionForPath(e.page) ?? sectionForPath(e.requestPath) ?? sectionForPath(e.path);
  const request = e.requestPath ?? e.path;
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {where && <Chip tone="teal">{where}</Chip>}
        <Chip tone={e.resolved ? "good" : "bad"}>{e.resolved ? "Resuelto" : "Sin resolver"}</Chip>
        {ERROR_ORIGIN[e.origin] && <Chip>{ERROR_ORIGIN[e.origin]}</Chip>}
      </div>
      <p className="mt-1 text-[13px] text-on-surface">{e.userDescription ?? e.message}</p>
      {(request || e.status) && (
        <p className="mt-0.5 break-all text-[12px] text-on-surface-variant">
          Qué falló: {[e.method, request].filter(Boolean).join(" ")}
          {e.status ? ` · respuesta ${e.status}` : " · sin respuesta del servidor"}
          {e.requestMessage ? ` · ${e.requestMessage}` : ""}
        </p>
      )}
      {e.page && <p className="break-all text-[12px] text-on-surface-variant">Pantalla: {e.page}</p>}
      <p className="text-[11.5px] text-outline">{exactDateTime(e.createdAt)}</p>
    </li>
  );
}
