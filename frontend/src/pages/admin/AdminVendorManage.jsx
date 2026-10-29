import { BlacklistCheckbox } from "../../components/admin/BlacklistCheckbox.jsx";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleDashed, CreditCard, ExternalLink, History, KeyRound, LayoutGrid, LifeBuoy, ListChecks, MonitorSmartphone, Package, ReceiptText, Users } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { timeAgo, exactDate, exactDateTime } from "../../lib/relativeTime.js";
import { formatPrice } from "../../lib/format.js";
import { resolvePaymentMethod } from "../../lib/catalog.js";
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
import { EditVendorModal, StatsModal, useAdminPlanList } from "./AdminVendors.jsx";
import { VendorUsageSection } from "../../components/admin/VendorUsage.jsx";
import { VendorAvatar } from "../../components/ui/VendorAvatar.jsx";
import { PanelSkeleton } from "../../components/ui/Skeleton.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { VendorOrdersPanel } from "../../components/admin/VendorOrdersPanel.jsx";
import AdminProducts from "./AdminProducts.jsx";
import { VendorHistorySections } from "./AdminDeletedVendors.jsx";

// Gestionar una tienda (/admin/tiendas/:id): estado, lo que le falta configurar, accesos y dispositivos, equipo, asistente,
// actividad y errores, con todas las acciones que antes estaban en el menú de tres puntos de la lista. La pestaña Pedidos
// (?tab=pedidos) busca, abre y gestiona los pedidos de la tienda, y Productos (?tab=productos) sus productos, para darle
// soporte sin ir a otra sección.
const TAB_IDS = ["resumen", "pedidos", "productos"];
const VERIFICATION_LABEL = {
  NOT_STARTED: "Sin verificar",
  PENDING_DOCS: "Faltan documentos",
  IN_REVIEW: "En revisión",
  PENDING_PAYMENT: "Pago pendiente",
  VERIFIED: "Verificada",
  PAYMENT_FAILED: "Pago fallido",
  REJECTED: "Rechazada",
  SUSPENDED: "Verificación suspendida",
  // El nombre del plan por defecto lo pone el componente (sale de la base); esto es solo el texto de reserva.
  PLAN_ENDED: "Volvió al plan por defecto",
};

const GRANT_MONTHS = [1, 2, 3, 6, 12, 24];

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
  const [blacklist, setBlacklist] = useState(false);
  const { plans, isLoading: plansLoading, isError: plansError } = useAdminPlanList();
  // Plan por defecto (el de registro y de bajada) por su bandera, nunca por la clave "REGULAR".
  const defaultPlan = plans.find((p) => p.isDefault) ?? null;
  // Sin artículo: se usa tras "a" ("Pasar a Básico"); el texto de reserva solo se ve si /settings no llegó.
  const defaultName = defaultPlan?.displayName ?? "plan por defecto";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TAB_IDS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "resumen";
  // Al cambiar de pestaña se limpian los filtros de la otra: cada una usa la URL para lo suyo.
  const setTab = (next) => setSearchParams(next === "resumen" ? {} : { tab: next }, { replace: true });
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["admin-vendor-manage", id], queryFn: async () => (await api.get(`/admin/vendors/${id}/manage`)).data });
  // Planes que se activan a mano: los de pago (ni el por defecto ni los gratis), también los ocultos y los que se
  // contratan hablando con el equipo. Mismo criterio que getPaidPlanKeys del backend. Incluye el plan que ya tiene: el
  // servidor (grantBusinessPlan) lo alarga sumando los meses desde su próxima fecha de pago, o pasa una prueba gratis a
  // un periodo pagado del mismo plan. Solo da 409 si se pide "Sin vencimiento" y ya lo tiene así.
  const currentPlanKey = data?.vendor?.planType ?? null;
  // Sin los que el servidor rechaza: un plan sin insignia que tampoco se cobra (gratis o por WhatsApp) no vencería nunca.
  // Mismo filtro que GrantBusinessCard de Suscripciones.
  const grantablePlans = plans.filter((p) => !p.isDefault && (p.grantsBadge || (!p.isFree && !p.contactOnly)));
  // Plan que el modal propone al abrirse: el que ya tiene (para alargarlo), si no el de prueba, si no el primero.
  const grantDefaultPlan =
    grantablePlans.find((p) => p.planType === currentPlanKey) ?? grantablePlans.find((p) => p.isTrialPlan) ?? grantablePlans[0] ?? null;

  const done = (msg) => {
    if (msg) toast.success(msg);
    setModal(null);
    setReason("");
    setNotify(false);
    queryClient.invalidateQueries({ queryKey: ["admin-vendor-manage", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-suspended-vendors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
    // Si cambió el rubro, los contadores y las listas de Categorías también.
    queryClient.invalidateQueries({ queryKey: ["admin-business-categories"] });
    queryClient.invalidateQueries({ queryKey: ["admin-business-category-vendors"] });
  };
  const fail = (fallback) => (err) => {
    if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? fallback);
  };

  const update = useMutation({
    mutationFn: async ({ payload, notify: n = false }) => (await api.patch(`/admin/vendors/${id}`, payload, notifyVendorConfig(n))).data,
    onSuccess: () => done("Tienda actualizada"),
    onError: fail("No se pudo actualizar la tienda."),
  });
  // Pasar al plan por defecto ahora o al terminar lo que ya tiene, o anular un cambio programado (ver planDowngrade.service.js).
  const downgrade = useMutation({
    mutationFn: async ({ when, reason: r }) => (await api.post(`/admin/vendors/${id}/downgrade`, { when, reason: r })).data,
    onSuccess: (_, { when }) =>
      done(when === "now" ? `La tienda pasó a ${defaultName}` : when === "cancel" ? "Se anuló el cambio programado" : `Cambio a ${defaultName} programado`),
    onError: fail("No se pudo cambiar el plan."),
  });
  // Activar un plan de pago a mano (con motivo), por meses o "Sin vencimiento" (#7 de la auditoría: antes vencía siempre a
  // los 30 días y el Empresarial caía solo al plan por defecto). "Sin vencimiento" solo existe en los planes con insignia:
  // en uno sin insignia las funciones duran mientras tenga tiempo pagado y el servidor lo rechaza (400). Los planes que se
  // contratan hablando con el equipo (contactOnly) no se renuevan solos: con insignia proponen "Sin vencimiento", pero se
  // puede elegir una cantidad de meses; sin insignia, solo por meses.
  const [grantPick, setGrantPick] = useState(null);
  const [grantMonths, setGrantMonths] = useState("1");
  // Sin elección todavía (o si la elegida ya no está): la propuesta de grantDefaultPlan.
  const grantPlan = grantablePlans.find((p) => p.planType === grantPick) ?? grantDefaultPlan;
  // Duración que propone cada plan al elegirlo; "Sin vencimiento" se descarta en un plan que no lo admite.
  const monthsFor = (p, current) => (p?.contactOnly && p?.grantsBadge ? "none" : current === "none" && !p?.grantsBadge ? "1" : current);
  const grantMonthsValue = grantMonths === "none" && !grantPlan?.grantsBadge ? "1" : grantMonths;
  const grantNoExpiry = !!grantPlan?.grantsBadge && grantMonthsValue === "none";
  const openGrantModal = () => {
    setGrantPick(null);
    setGrantMonths(monthsFor(grantDefaultPlan, "1"));
    setModal("plan");
  };
  const grant = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          `/admin/vendors/${id}/grant-business`,
          { reason: reason.trim(), planType: grantPlan.planType, ...(grantNoExpiry ? { noExpiry: true } : { months: Number(grantMonthsValue) }) },
          notifyVendorConfig(notify)
        )
      ).data,
    // `same` llega en las variables (no se lee grantSamePlan, que se calcula más abajo, después de los returns tempranos).
    onSuccess: (_, vars) =>
      done(vars?.same ? `Listo: sigue con ${vars.name}` : `La tienda pasó a ${vars?.name ?? grantPlan?.displayName ?? "el plan elegido"}`),
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
    // Si estaba bloqueada antes de eliminarla, restaurar le devuelve ese bloqueo (preDeletionBlockReason en el servidor).
    onSuccess: (data) => done(data?.isBlocked ? "Tienda restaurada. Sigue bloqueada por su motivo anterior." : "Tienda restaurada"),
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
  // Suspendida por falta de pago (planBilling.service.js) o por inactividad (vendorLifecycle.job.js): `v.suspension` dice
  // cuál. Antes cualquier SUSPENDED salía "por inactividad", también la de una tienda que no pagó su plan.
  const suspended = v.status === "SUSPENDED";
  const suspendedForBilling = !!v.suspension?.forBilling;
  const suspensionLabel = suspendedForBilling ? "Suspendida por falta de pago" : v.suspension ? "Suspendida por inactividad" : "Suspendida";
  // 44px de alto como mínimo: son los botones de acción de la tienda, también en el celular.
  const btn = "min-h-11";
  // ¿Está en el plan por defecto? Mientras /settings no llega se usa la bandera que ya manda el servidor (plan.isDefault).
  // No sirve plan.kind: el plan por defecto puede cobrarse y entonces llega como PAID.
  const onDefaultPlan = defaultPlan ? v.planType === defaultPlan.planType : !!plan?.isDefault;
  const premiumLeft = !!(v.premiumUntil && new Date(v.premiumUntil) > new Date());
  // Misma fecha que guarda el servidor: si alarga el plan que ya tiene con tiempo pagado por delante, los meses se suman
  // desde su próxima fecha de pago; si no, desde hoy. 30 días por mes, como cycleMs en admin.controller.
  const grantSamePlan = !!grantPlan && grantPlan.planType === v.planType;
  const grantBaseMs =
    grantSamePlan && plan?.nextPaymentDueDate && new Date(plan.nextPaymentDueDate) > new Date() ? new Date(plan.nextPaymentDueDate).getTime() : Date.now();
  const grantExtends = grantBaseMs > Date.now();
  const grantUntil = grantNoExpiry ? null : new Date(grantBaseMs + Number(grantMonthsValue) * 30 * 24 * 60 * 60 * 1000);

  return (
    <div className="max-w-[1180px]">
      <Link to="/admin/tiendas" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-tertiary-accent">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Tiendas
      </Link>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <VendorAvatar vendor={v} className="h-12 w-12 rounded-full text-lg" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 truncate font-display text-[24px] font-extrabold tracking-tight text-on-surface">
              {v.companyName} {v.verificationStatus === "VERIFIED" && <VerifiedBadge size="sm" />}
            </h1>
            {v.slug && <p className="text-[12.5px] font-semibold text-on-surface-variant">@{v.slug}</p>}
            <p className="text-[12.5px] text-outline">{[v.category, ...v.locations].filter(Boolean).join(" · ") || "Sin rubro ni zona"}</p>
            <p className="text-[12.5px] text-on-surface-variant">
              Registró la tienda el <strong className="font-semibold text-on-surface">{exactDateTime(v.createdAt)}</strong> ({timeAgo(v.createdAt).toLowerCase()})
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={v.trial.active ? "teal" : !onDefaultPlan ? "warn" : "neutral"}>{v.trial.active ? `${v.planName} · Prueba gratis` : v.planName}</Chip>
          {v.trial.active ? (
            <Chip tone={v.trial.daysLeft <= 7 ? "bad" : "teal"}>{v.trial.daysLeft === 1 ? "Queda 1 día" : `Quedan ${v.trial.daysLeft} días`}</Chip>
          ) : (
            <Chip tone={v.verificationStatus === "VERIFIED" ? "good" : "neutral"}>
              {v.verificationStatus === "PLAN_ENDED" && defaultPlan ? `Volvió a ${defaultPlan.displayName}` : VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}
            </Chip>
          )}
          {v.planDowngradeAt && <Chip tone="bad">Pasa a {defaultName} el {exactDate(v.planDowngradeAt)}</Chip>}
          {v.isBlocked && <Chip tone="bad">Bloqueada</Chip>}
          {suspended && <Chip tone="bad">{suspensionLabel}</Chip>}
          {pendingDeletion && <Chip tone="bad">Eliminación pendiente</Chip>}
        </div>
      </div>

      {v.isBlocked && v.blockReason && <p className="mb-4 rounded-xl bg-error/5 px-3 py-2 text-[13px] text-error">Motivo del bloqueo: {v.blockReason}</p>}
      {suspended && v.suspension?.reason && (
        <p className="mb-4 rounded-xl bg-error/5 px-3 py-2 text-[13px] text-error">
          Motivo de la suspensión: {v.suspension.reason}
          {v.suspension.at ? ` (desde el ${exactDate(v.suspension.at)})` : ""}
        </p>
      )}

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "resumen", label: "Resumen", icon: LayoutGrid },
          { id: "pedidos", label: `Pedidos${counts.orders != null ? ` (${counts.orders.toLocaleString("es-CU")})` : ""}`, icon: ReceiptText },
          { id: "productos", label: `Productos${counts.products != null ? ` (${counts.products.toLocaleString("es-CU")})` : ""}`, icon: Package },
          // Antes todo esto iba apilado en Resumen (8 bloques seguidos): ahora cada tema tiene su pestaña.
          { id: "equipo", label: "Equipo y accesos", icon: Users },
          { id: "soporte", label: "Soporte", icon: LifeBuoy, count: errors.length + tickets.length },
          { id: "historial", label: "Historial", icon: History },
        ]}
      />

      {tab === "pedidos" ? (
        <VendorOrdersPanel vendorId={v.id} />
      ) : tab === "productos" ? (
        <AdminProducts vendorId={v.id} embedded />
      ) : tab === "historial" ? (
        <VendorHistoryTab vendorId={v.id} />
      ) : (
      <>
      {tab === "resumen" && (
      <div className="mb-5 flex flex-wrap gap-2">
        <a href={`/tienda/${v.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded border border-outline px-3 text-label-sm font-semibold text-on-surface hover:bg-surface-container">
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
                Anular paso a {defaultName}
              </Button>
            ) : (
              <>
                {!onDefaultPlan && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={btn}
                    onClick={() => {
                      setDowngradeWhen(premiumLeft ? "period_end" : "now");
                      setModal("downgrade");
                    }}
                  >
                    Pasar a {defaultName}
                  </Button>
                )}
                {/* También desde un plan de pago: así se pasa de un plan de pago a otro sin bajar antes al plan por defecto.
                    No con tarjeta: Stripe seguiría cobrando el precio del plan anterior. */}
                {(onDefaultPlan || !v.paysWithCard) && (
                  <Button size="sm" variant="outline" className={btn} onClick={openGrantModal}>
                    {onDefaultPlan ? "Activar un plan de pago" : "Cambiar o alargar el plan"}
                  </Button>
                )}
              </>
            )}
            {v.isBlocked ? (
              <Button size="sm" className={btn} onClick={() => update.mutate({ payload: { isBlocked: false } })} disabled={update.isPending}>Desbloquear</Button>
            ) : (
              <Button size="sm" variant="outline" className={btn} onClick={() => setModal("block")}>Bloquear</Button>
            )}
            {suspended && <Button size="sm" className={btn} onClick={() => setModal("reactivate")}>Reactivar</Button>}
            <Button size="sm" variant="ghost" className={`${btn} text-error`} onClick={() => setModal("delete")}>Eliminar</Button>
          </>
        )}
      </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {tab === "resumen" && plan && usage && <PlanUsageSection v={v} plan={plan} usage={usage} counts={counts} />}

        {tab === "resumen" && <RequirementsSection requirements={requirements} extras={extras} />}

        {tab === "equipo" && (
        <Section icon={MonitorSmartphone} title="Accesos y dispositivos">
          <p className="text-[13px] text-on-surface">
            Último acceso del dueño: <strong title={exactDate(access.lastLoginAt)}>{access.lastLoginAt ? timeAgo(access.lastLoginAt) : "nunca"}</strong>
            {" · "}
            {access.trustedDevices} {access.trustedDevices === 1 ? "dispositivo de confianza" : "dispositivos de confianza"}
          </p>
          <p className="mb-2 text-[12px] text-outline">Correo de acceso: {owner.email}</p>
          {access.sessions.length === 0 ? <p className="text-[13px] text-on-surface-variant">Sin sesiones registradas.</p> : <DeviceGroups sessions={access.sessions} />}
        </Section>
        )}

        {tab === "equipo" && (
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
        )}

        {tab === "soporte" && (
        <Section icon={Bot} title="Asistente e inteligencia artificial" action={<Link to="/admin/asistente" className="text-[12.5px] font-bold text-tertiary-accent">Entrenar el asistente</Link>}>
          <ul className="space-y-1.5 text-[13px] text-on-surface">
            <li>Chat con IA en su tienda: <strong>{assistant.chatbotAllowedByPlan ? "incluido en su plan" : "no incluido en su plan"}</strong></li>
            <li>Documento para el chat: <strong>{assistant.hasAiDocument ? assistant.aiDocumentName ?? "cargado" : "no subió ninguno"}</strong></li>
            <li>Preguntas de clientes al chat (30 días): <strong>{assistant.chatQuestions30}</strong></li>
            <li>Preguntas al asistente de negocio (30 días): <strong>{assistant.assistantQuestions30}</strong></li>
            <li>Programa de fidelidad: <strong>{assistant.loyaltyEnabled ? "encendido" : "apagado"}</strong></li>
          </ul>
        </Section>
        )}

        {tab === "resumen" && (
        <div className="lg:col-span-2">
          <VendorUsageSection vendorId={v.id} />
        </div>
        )}

        {tab === "soporte" && (
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
        )}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-outline">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Los cambios de plan, bloqueos y eliminaciones piden el código que llega a tu correo.
      </p>
      </>
      )}

      {modal === "edit" && <EditVendorModal vendor={v} saving={update.isPending} onCancel={() => setModal(null)} onSave={(form) => update.mutateAsync({ payload: form })} />}
      {/* isRestaurant: con él, Estadísticas pide los pedidos de mesa y Usuarios ofrece el tipo "Mesero" (los dos lo miran). */}
      {modal === "stats" && <StatsModal vendorName={{ id: v.id, companyName: v.companyName, isRestaurant: v.isRestaurant }} onClose={() => setModal(null)} />}
      {modal === "rep" && <RepresentativeFileModal vendor={{ id: v.id, companyName: v.companyName }} onClose={() => setModal(null)} />}
      {modal === "staff" && <AdminVendorStaffModal vendor={{ id: v.id, companyName: v.companyName, isRestaurant: v.isRestaurant }} onClose={() => setModal(null)} />}

      <ConfirmModal
        open={modal === "plan"}
        title={onDefaultPlan ? `¿Activar un plan de pago para "${v.companyName}"?` : `¿Cambiar o alargar el plan de "${v.companyName}"?`}
        message={
          grantPlan
            ? `${
                grantSamePlan
                  ? `Sigue con el plan ${grantPlan.displayName} sin pasar por el pago`
                  : `${grantPlan.grantsBadge ? "Recibe la insignia de verificada y las funciones" : "Recibe las funciones"} del plan ${grantPlan.displayName} sin pasar por el pago`
              }${
                grantNoExpiry
                  ? ", sin fecha de vencimiento."
                  : grantPlan.contactOnly
                  ? ". Este plan se contrata hablando con el equipo y no se renueva solo: al terminar el tiempo elegido hay que volver a activarlo."
                  : ". Al terminar el tiempo elegido se le cobra la renovación como a cualquier tienda."
              }`
            : plansLoading
            ? "Cargando los planes..."
            : plansError
            ? "No se pudieron cargar los planes. Cierra y vuelve a intentarlo."
            : "No hay planes de pago para activar."
        }
        confirmLabel={
          grant.isPending ? "Guardando..." : grantPlan ? (grantSamePlan ? `Seguir con ${grantPlan.displayName}` : `Pasar a ${grantPlan.displayName}`) : "Pasar de plan"
        }
        confirmDisabled={!grantPlan || reason.trim().length < 5 || grant.isPending}
        onConfirm={() => grant.mutate({ same: grantSamePlan, name: grantPlan?.displayName })}
        onCancel={() => setModal(null)}
      >
        {grantablePlans.length > 0 && (
          <>
            <label htmlFor="grant-plan" className="mb-1 block text-[12.5px] font-bold text-on-surface">
              Plan
            </label>
            <select
              id="grant-plan"
              value={grantPlan?.planType ?? ""}
              onChange={(e) => {
                const next = grantablePlans.find((p) => p.planType === e.target.value);
                setGrantPick(e.target.value);
                setGrantMonths(monthsFor(next, grantMonths));
              }}
              className="mb-3 min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
            >
              {grantablePlans.map((p) => (
                <option key={p.planType} value={p.planType}>
                  {p.displayName}
                  {p.isPublic === false ? " (oculto)" : ""}
                  {p.planType === v.planType ? " (plan actual)" : ""}
                </option>
              ))}
            </select>
            <label htmlFor="grant-months" className="mb-1 block text-[12.5px] font-bold text-on-surface">
              Duración
            </label>
            <select
              id="grant-months"
              value={grantMonthsValue}
              onChange={(e) => setGrantMonths(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
            >
              {GRANT_MONTHS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} {n === 1 ? "mes" : "meses"}
                </option>
              ))}
              {grantPlan?.grantsBadge && <option value="none">Sin vencimiento</option>}
            </select>
            <p className="mb-3 mt-1 text-[12px] text-on-surface-variant">
              {grantNoExpiry
                ? "No vence ni se le cobra. Para quitárselo, pásala a otro plan."
                : `${grantExtends ? "Se suma al tiempo que ya tiene pagado: activo" : "Activo"} hasta el ${exactDate(grantUntil)}.${
                    grantPlan && !grantPlan.grantsBadge ? " Este plan no da la insignia, así que no se puede dejar sin vencimiento." : ""
                  }`}
            </p>
          </>
        )}
        <label htmlFor="grant-reason" className="mb-1 block text-[12.5px] font-bold text-on-surface">
          Motivo
        </label>
        <textarea
          id="grant-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: pagó por transferencia fuera del sistema"
          rows={3}
          className="mb-3 w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
        <NotifyVendorCheckbox checked={notify} onChange={setNotify} />
      </ConfirmModal>

      <ConfirmModal
        open={modal === "downgrade"}
        title={`¿Pasar "${v.companyName}" a ${defaultName}?`}
        message={`${
          v.verificationStatus === "VERIFIED" ? "Pierde la insignia de verificada y las funciones de su plan" : "Pierde las funciones de su plan"
        }, y se aplican los límites de ${defaultName}. Los productos que pasen del cupo quedan ocultos, no se borran. Sus documentos siguen aprobados: puede volver pagando, sin repetir la verificación.`}
        confirmLabel={downgrade.isPending ? "Guardando..." : downgradeWhen === "now" ? `Pasar a ${defaultName} ahora` : "Programar el cambio"}
        confirmDisabled={reason.trim().length < 5 || downgrade.isPending}
        onConfirm={() => downgrade.mutate({ when: downgradeWhen, reason: reason.trim() })}
        onCancel={() => setModal(null)}
      >
        <fieldset className="mb-3 flex flex-col gap-2">
          <legend className="mb-1.5 text-[12.5px] font-bold text-on-surface">¿Cuándo?</legend>
          {[
            {
              value: "period_end",
              label: premiumLeft ? `Al terminar lo que ya tiene (${exactDate(v.premiumUntil)})` : "Al terminar lo que ya tiene",
              hint: v.trial.active
                ? `Sigue con la prueba gratis hasta esa fecha y después pasa sola a ${defaultName}.`
                : `Sigue con ${v.planName} hasta esa fecha y no se le renueva${v.paysWithCard ? " el cobro con tarjeta" : ""}.`,
              disabled: !premiumLeft,
            },
            {
              value: "now",
              label: "Ahora mismo",
              hint: v.paysWithCard ? `Pierde ${v.planName} al instante y se cancela su suscripción con tarjeta.` : `Pierde ${v.planName} al instante.`,
            },
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
          placeholder="Ej.: no cumple las condiciones de su plan"
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
        onConfirm={() => update.mutate({ payload: { isBlocked: true, blockReason: reason.trim(), addToBlacklist: blacklist || undefined }, notify })}
        onCancel={() => {
          setModal(null);
          setBlacklist(false);
        }}
      >
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del bloqueo (obligatorio, lo verá el vendedor)..." rows={3} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent" />
        <NotifyVendorCheckbox checked={notify} onChange={setNotify} />
        <BlacklistCheckbox kind="tienda" checked={blacklist} onChange={setBlacklist} />
      </ConfirmModal>

      <ConfirmModal
        open={modal === "reactivate"}
        title={`¿Reactivar "${v.companyName}"?`}
        message={
          suspendedForBilling
            ? // Al reactivar, el servidor le da una semana más si el pago ya venció (adminReactivationBillingData): la fecha llega
              // calculada en suspension.reactivationDueDate. El dueño ya podía entrar a su panel para pagar.
              `Vuelve a verse en todo el sitio y a recibir pedidos.${
                v.suspension?.reactivationDueDate ? ` Tendrá hasta el ${exactDate(v.suspension.reactivationDueDate)} para pagar su plan.` : ""
              } Si no paga, deja de recibir pedidos y después se vuelve a suspender, como cualquier tienda con el pago vencido. Se le avisa por correo con el motivo que escribas.`
            : "Vuelve a verse en todo el sitio y su dueño puede volver a entrar al panel. Se le avisa por correo con el motivo que escribas."
        }
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
        message="La tienda se oculta de todo el sitio y su dueño ve el panel bloqueado. No se borra todavía: queda en eliminación pendiente durante el plazo configurado en Seguridad, y puedes restaurarla mientras tanto. Si estaba bloqueada, al restaurarla sigue bloqueada."
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


// plan.kind (adminVendorManage.controller): FREE = un plan gratis (isFree), PAID = cualquier plan que se cobra (también el
// plan por defecto cuando se cobra), TRIAL = en la prueba gratis. Que sea el plan por defecto lo dice plan.isDefault, no
// el kind: por eso la etiqueta se elige en planKindOf.
const PLAN_KIND = {
  FREE: { label: "Plan gratis", tone: "neutral" },
  // El nombre del plan de prueba va en el chip de al lado (plan.name), que sale de la base.
  TRIAL: { label: "Prueba gratis", tone: "teal" },
  PAID: { label: "Plan de pago", tone: "good" },
};
const DEFAULT_PLAN_KIND = { label: "Plan por defecto", tone: "neutral" };
function planKindOf(plan) {
  if (plan.kind === "TRIAL") return PLAN_KIND.TRIAL;
  if (plan.isDefault) return DEFAULT_PLAN_KIND;
  return PLAN_KIND[plan.kind] ?? PLAN_KIND.FREE;
}
const PAYMENT_METHOD = { CARD: "tarjeta", CUP_TRANSFER: "transferencia en CUP", MANUAL: "pago registrado por el equipo" };

// Plan y uso: qué plan tiene (gratis, prueba o de pago), cuánto usa de cada límite y cómo usa la plataforma en 30 días.
function PlanUsageSection({ v, plan, usage, counts }) {
  const kind = planKindOf(plan);
  return (
    <Section icon={CreditCard} title="Plan y uso">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Chip tone={kind.tone}>{kind.label}</Chip>
        <Chip>{plan.name}</Chip>
      </div>
      <p className="mb-3 text-[12.5px] text-on-surface-variant">
        {plan.kind === "TRIAL" && <>La prueba termina el {exactDate(v.trial.endsAt)}. Después pasa sola al plan por defecto con sus límites.</>}
        {plan.kind === "PAID" && (
          <>
            {plan.manualGrant ? <>Activado a mano por el equipo el {exactDate(plan.manualGrant.at)}. </> : null}
            {plan.noExpiry ? <>Sin fecha de vencimiento. </> : null}
            {plan.nextPaymentDueDate ? <>Próximo pago: {exactDate(plan.nextPaymentDueDate)}. </> : null}
            {plan.paymentMethod ? <>Paga con {PAYMENT_METHOD[plan.paymentMethod] ?? plan.paymentMethod}. </> : null}
            {plan.paymentConfirmedAt ? <>Último pago confirmado el {exactDate(plan.paymentConfirmedAt)}.</> : null}
          </>
        )}
        {plan.kind === "FREE" && <>Usa el plan {plan.name} con sus límites.</>}
      </p>

      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-outline">Límites del plan</h3>
      <ul className="mb-4 space-y-1.5">
        {plan.limits.map((l) => {
          const pct = l.max ? Math.min(100, Math.round((l.used / l.max) * 100)) : 0;
          // null = sin tope; 0 = su plan no incluye esa función (el servidor ya aplica el interruptor apagado). Si aun así tiene
          // algo (por ejemplo usuarios creados en un plan anterior), se ve en rojo.
          const text = l.max == null ? `${l.used} (sin límite)` : l.max === 0 ? (l.used ? `${l.used}, no incluido en su plan` : "No incluido en su plan") : `${l.used} de ${l.max}`;
          const over = l.max != null && l.used > 0 && l.used >= l.max;
          return (
            <li key={l.label} className="text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="text-on-surface-variant">{l.label}</span>
                <span className={`text-right font-semibold ${over ? "text-error" : l.max === 0 ? "text-on-surface-variant" : "text-on-surface"}`}>{text}</span>
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
            {/* Encendida en el plan pero el plan no da la insignia que exige: el servidor no la deja usar, y "Sin ..."
                haría pensar que el interruptor está apagado. */}
            <Chip tone={f.on ? "good" : "neutral"}>
              {f.badgeMissing ? `${f.label}: requiere insignia` : f.on ? f.label : `Sin ${f.label.toLowerCase()}`}
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
          [
            "Envío",
            v.shipping?.mode === "FIXED" ? "Fijo por pedido" : v.shipping?.mode === "COORDINATE" ? "A coordinar" : "Por producto",
            v.shipping?.mode === "FIXED"
              ? `${formatPrice(v.shipping.local, v.shipping.currency)} en su provincia, ${formatPrice(v.shipping.other, v.shipping.currency)} fuera`
              : v.shipping?.mode === "COORDINATE"
              ? "No se cobra al pedir"
              : "Gratis salvo que el producto diga otra cosa",
          ],
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

// Requisitos de la verificación (los mismos de la prueba gratis y de los planes con insignia): primero lo que falta, después lo que
// completó con el dato con que lo hizo, y aparte lo que ayuda a vender aunque no sea obligatorio.
function RequirementsSection({ requirements, extras }) {
  const done = requirements.filter((r) => r.done);
  const pending = requirements.filter((r) => !r.done);
  const pct = requirements.length ? Math.round((done.length / requirements.length) * 100) : 0;
  const extrasPending = extras.filter((x) => !x.done);
  return (
    <Section icon={ListChecks} title="Requisitos para la verificación">
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

// Pestaña Historial: quién creó la tienda y desde qué dispositivo e IP, con qué dispositivos entró su dueño y todo lo que pasó
// en ella (acciones, cambios de plan y de verificación). Mismo contenido que la ficha de una tienda eliminada.
function VendorHistoryTab({ vendorId }) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-vendor-history", vendorId],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/history`)).data,
  });
  if (isLoading) return <PanelSkeleton />;
  if (isError || !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body-md text-error">No se pudo cargar el historial.</p>
        <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? "Reintentando..." : "Reintentar"}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <VendorHistorySections data={data} />
    </div>
  );
}
