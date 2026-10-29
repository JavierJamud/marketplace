import { useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Gift, Plus, X, Pencil, Power, Clock, Sparkles, ShieldAlert, Percent, Trash2, CalendarClock } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { DiscountCodeFormModal } from "../../components/vendor/DiscountCodeFormModal.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";

// Una sola forma para la caché ["my-discount-codes"], que comparten las dos pestañas (y el formulario de oferta): la lista y
// el cupo del plan (`limit: { maxActive, activeCount }`, maxActive null = sin tope) de GET /discount-codes/me/list.
async function fetchMyDiscountCodes() {
  const { discountCodes, limit } = (await api.get("/discount-codes/me/list")).data;
  return { discountCodes: discountCodes ?? [], limit: limit ?? null };
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDateInput(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function discountLabel(code) {
  if (!code) return "";
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} ${code.currency ?? "CUP"}`;
}

// Bloque 232 (pedido explícito — "se podrán crear una oferta o varias
// dentro del panel del vendedor pero solo se podrá mantener una oferta
// activa por tienda, se puede programar cuándo empieza una y cuándo
// termina"): el formulario ahora cubre 3 cosas nuevas — "active" al crear
// (permite dejarla como borrador sin que cuente contra el límite),
// "startsAt" junto al "expiresAt" que ya existía, y `atLimit` (viene del
// padre, que ya sabe cuántas activas tiene contra la política del admin)
// para avisar ANTES de que el backend rechace el intento.
// `canCreateCodes`: "+ Crear nuevo" abre el alta de un código (POST /discount-codes), que pide escritura en la sección
// "codigos-descuento" y que el plan los incluya; sin eso el botón no sale. `codesError`: la lista de códigos no cargó (por
// ejemplo, un usuario del equipo con "ofertas-tienda" pero sin "codigos-descuento" mientras el servidor no le abra la lista).
// `atCodeLimit`/`maxActiveCodes`: el cupo de códigos activos del plan, el mismo que mira la pestaña Códigos; en el tope
// "+ Crear nuevo" queda apagado, porque el servidor rechaza el alta (assertCodeSlotAvailable). `planHasCodes`: el plan de
// la tienda trae códigos (planFeatures.allowDiscountCodes); sin eso no sirve pedirle al dueño que cree uno.
function StoreOfferFormModal({ offer, discountCodes, codesError, onRetryCodes, canCreateCodes, atCodeLimit, maxActiveCodes, planHasCodes, isStaff, atLimit, maxActive, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const isEdit = !!offer;
  const [title, setTitle] = useState(isEdit ? offer.title : "");
  const [description, setDescription] = useState(isEdit ? offer.description ?? "" : "");
  const [discountCodeId, setDiscountCodeId] = useState(isEdit ? offer.discountCode.id : "");
  const [discountCodeExclusive, setDiscountCodeExclusive] = useState(isEdit ? offer.discountCodeExclusive : false);
  const [isLimitedTime, setIsLimitedTime] = useState(isEdit ? offer.isLimitedTime : false);
  const [startsAt, setStartsAt] = useState(isEdit && offer.startsAt ? fmtDateInput(offer.startsAt) : "");
  const [expiresAt, setExpiresAt] = useState(fmtDateInput(isEdit ? offer.expiresAt : null));
  // Solo tiene efecto real al CREAR — editar una oferta ya activa no la
  // apaga sola por acá (eso sigue siendo el botón "Retirar" de la lista).
  const [active, setActive] = useState(isEdit ? offer.active : !atLimit);
  const [showCreateCode, setShowCreateCode] = useState(false);

  const wantsActiveButBlocked = !isEdit && active && atLimit;

  const save = useMutation({
    mutationFn: async () => {
      const body = { title: title.trim(), discountCodeId, isLimitedTime };
      if (description.trim()) body.description = description.trim();
      if (isLimitedTime) {
        if (startsAt) body.startsAt = new Date(startsAt).toISOString();
        body.expiresAt = new Date(expiresAt).toISOString();
        body.discountCodeExclusive = discountCodeExclusive;
      }
      if (!isEdit) body.active = active;

      if (isEdit) return (await api.patch(`/store-offers/${offer.id}`, body)).data;
      return (await api.post("/store-offers", body)).data;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Oferta actualizada." : active ? "Oferta publicada en tu tienda." : "Oferta guardada como borrador.");
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la oferta."),
  });

  const invalidRange = isLimitedTime && startsAt && expiresAt && new Date(startsAt) >= new Date(expiresAt);
  const disabledSubmit =
    save.isPending || !title.trim() || !discountCodeId || (isLimitedTime && !expiresAt) || invalidRange || wantsActiveButBlocked;

  // Bloque 196: mismo mecanismo de snapshot-en-ref que ProductModal.
  const draftSnapshot = () =>
    JSON.stringify({ title, description, discountCodeId, discountCodeExclusive, isLimitedTime, startsAt, expiresAt, active });
  const initialFormSnapshot = useRef(draftSnapshot());
  const isDirty = draftSnapshot() !== initialFormSnapshot.current;
  // Misma condición que ya deshabilita "Guardar"/"Publicar" más abajo,
  // menos save.isPending (transitorio, no de validez).
  const canSaveNow = !!title.trim() && !!discountCodeId && !(isLimitedTime && !expiresAt) && !invalidRange && !wantsActiveButBlocked;
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => save.mutateAsync() : undefined });

  // Aviso bajo el selector de código. Un 403 de la lista solo es "te falta la sección" para el personal y cuando el
  // servidor no manda `details`: con details el motivo es otro (tienda bloqueada o suspendida por pago, o el plan sin
  // usuarios del equipo) y se muestra el mensaje del servidor tal cual. Si el plan no trae códigos, eso va primero: ni
  // la sección ni el dueño lo resuelven.
  const planNoCodesNote = isStaff
    ? "El plan de la tienda no incluye códigos de descuento, y cada oferta necesita uno."
    : "Tu plan no incluye códigos de descuento, y cada oferta necesita uno.";
  let codesErrorNote = null;
  if (codesError?.response?.status === 403) {
    const data = codesError.response.data;
    if (data?.details) codesErrorNote = data.error ?? "No tienes acceso a los códigos de descuento de la tienda.";
    else if (!planHasCodes) codesErrorNote = planNoCodesNote;
    else if (isStaff) codesErrorNote = "No tienes acceso a los códigos de descuento de la tienda. Pide al dueño que te dé la sección Códigos de descuento.";
    else codesErrorNote = data?.error ?? "No tienes acceso a los códigos de descuento de la tienda.";
  }
  const codeLimitNote =
    canCreateCodes && atCodeLimit
      ? maxActiveCodes === 0
        ? "Tu plan no incluye códigos de descuento activos."
        : "Llegaste al tope de códigos activos de tu plan. Reusa uno o desactiva otro."
      : null;
  let emptyCodesNote = null;
  if (discountCodes && !discountCodes.length) {
    if (!planHasCodes) emptyCodesNote = planNoCodesNote;
    // En el tope ya lo explica codeLimitNote; "Crea uno" sería falso.
    else if (canCreateCodes) emptyCodesNote = atCodeLimit ? null : "Todavía no tienes códigos de descuento. Crea uno para esta oferta.";
    else if (isStaff) emptyCodesNote = "La tienda todavía no tiene códigos de descuento. Pide al dueño que cree uno.";
    else emptyCodesNote = "Todavía no tienes códigos de descuento.";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="modal-panel-6 w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">{isEdit ? "Editar oferta de tienda" : "Nueva oferta de tienda"}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          <Input label="Título de la oferta" required value={title} onChange={(e) => setTitle(e.target.value)} />

          <div>
            <AiGenerateButton kind="offer" currentText={description} onGenerated={setDescription} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción corta y persuasiva de la oferta..."
              className="min-h-[64px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Código de descuento</span>
            <div className="flex gap-2">
              <select
                value={discountCodeId}
                onChange={(e) => setDiscountCodeId(e.target.value)}
                className="h-11 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
              >
                <option value="">Elige un código...</option>
                {/* Un código suspendido por el administrador no se puede usar en una oferta (el servidor lo rechaza). Se deja
                    elegible solo si ya era el de esta oferta, para que el select no quede vacío al editarla. */}
                {discountCodes?.map((c) => (
                  <option key={c.id} value={c.id} disabled={!!c.suspendedAt && c.id !== discountCodeId}>
                    {c.code} ({discountLabel(c)}) {c.suspendedAt ? "· suspendido" : c.active ? "" : "· inactivo"}
                  </option>
                ))}
              </select>
              {canCreateCodes && (
                <button
                  type="button"
                  onClick={() => setShowCreateCode(true)}
                  disabled={atCodeLimit}
                  title={atCodeLimit ? "Llegaste al tope de códigos activos de tu plan" : undefined}
                  className="min-h-11 flex-shrink-0 rounded-full border border-outline-variant px-3.5 text-[12.5px] font-bold text-tertiary-accent hover:bg-surface-container disabled:cursor-not-allowed disabled:text-outline disabled:hover:bg-transparent"
                >
                  + Crear nuevo
                </button>
              )}
            </div>
            {codesError ? (
              codesErrorNote ? (
                <p role="alert" className="mt-1.5 text-[11.5px] font-semibold text-error">
                  {codesErrorNote}
                </p>
              ) : (
                <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] font-semibold text-error">
                  No pudimos cargar tus códigos de descuento.
                  <button type="button" onClick={onRetryCodes} className="min-h-11 font-bold text-tertiary-accent underline">
                    Reintentar
                  </button>
                </p>
              )
            ) : (
              <>
                {codeLimitNote && (
                  <p role="status" className="mt-1.5 text-[11.5px] text-on-surface-variant">
                    {codeLimitNote}
                  </p>
                )}
                {emptyCodesNote && <p className="mt-1.5 text-[11.5px] text-outline">{emptyCodesNote}</p>}
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <input type="checkbox" checked={isLimitedTime} onChange={(e) => setIsLimitedTime(e.target.checked)} className="h-4 w-4" />
            Oferta por tiempo limitado
          </label>

          {isLimitedTime && (
            <div className="rounded-xl border border-outline-variant p-3.5">
              {/* Bloque 232 (pedido explícito — "se puede programar cuándo
                  empieza una y cuándo termina"): antes solo había "Vence
                  el" — ahora, opcionalmente, también "Empieza el" (vacío =
                  arranca apenas se active, comportamiento de siempre). */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <span className="mb-1 flex items-center gap-1 text-label-sm text-outline">
                    <CalendarClock className="h-3.5 w-3.5" /> Empieza el (opcional)
                  </span>
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-label-sm text-outline">Vence el</span>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none"
                  />
                </div>
              </div>
              {invalidRange && <p className="mt-2 text-[11.5px] font-semibold text-error">"Empieza el" debe ser antes de "Vence el".</p>}
              {!discountCodeExclusive && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-tertiary-accent/[0.08] p-2.5 text-[11.5px] text-on-surface">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-tertiary-accent" />
                  {canCreateCodes && !atCodeLimit
                    ? 'Recomendado: usa un código exclusivo para esta oferta (con "+ Crear nuevo"). Se desactiva solo cuando la oferta vence. Si reusas uno existente, tú decides cuándo desactivarlo.'
                    : "Si reusas un código que ya existe, no se desactiva solo cuando la oferta vence: hay que desactivarlo a mano."}
                </p>
              )}
            </div>
          )}

          {/* Bloque 232 (pedido explícito — "se podrán crear una oferta o
              varias... pero solo se podrá mantener una oferta activa"):
              solo al CREAR — permite dejarla lista sin publicar todavía,
              sin que cuente contra el límite de activas. */}
          {!isEdit && (
            <label className={`flex items-start gap-2 rounded-xl border p-3.5 text-[13px] font-semibold ${atLimit ? "border-outline-variant text-outline" : "border-outline-variant text-on-surface"}`}>
              <input type="checkbox" checked={active} disabled={atLimit} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                Publicarla de inmediato
                <span className="mt-1 block text-label-sm font-normal text-outline">
                  {atLimit
                    ? `Ya tienes el máximo de ofertas activas permitidas (${maxActive}). Guárdala como borrador y activa esta cuando desactives otra.`
                    : "Destildado, queda guardada como borrador: podrás activarla más adelante desde la lista."}
                </span>
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={disabledSubmit}>
              {save.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : active ? "Publicar oferta" : "Guardar borrador"}
            </Button>
          </div>
        </form>
      </div>

      {showCreateCode && (
        <DiscountCodeFormModal
          onClose={() => setShowCreateCode(false)}
          onSaved={(createdCode) => {
            // Bloque 231 (bug real reportado en vivo — "cuando creo un
            // código desde esa sección no se muestra en la lista
            // inmediatamente"): la lista de <option> venía del
            // `discountCodes` de la página padre, que nunca se refrescaba.
            queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
            setDiscountCodeId(createdCode.id);
            setDiscountCodeExclusive(true);
            setShowCreateCode(false);
          }}
        />
      )}

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={canSaveNow ? dirtyModal.handleSaveAndClose : undefined}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}

// Bloque 232: pestaña "Ofertas" — antes toda esta página; ahora vive
// separada para compartir espacio con "Códigos de descuento" dentro de la
// misma sección (ver el componente default de abajo).
// `canWrite`: escritura en "ofertas-tienda" (un usuario del equipo en solo lectura ve las ofertas sin botones que el
// servidor le rechaza). `canCreateCodes`: ver StoreOfferFormModal.
function StoreOffersTab({ vendor, isStaff, canWrite, canCreateCodes }) {
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null); // null cerrado, {} crear, offer editar

  const { data: storeOffers, isLoading } = useQuery({
    queryKey: ["my-store-offers"],
    queryFn: async () => (await api.get("/store-offers/me/list")).data.storeOffers,
    enabled: !!vendor?.isVerified,
  });
  // Hace falta para elegir el código de cada oferta. Si falla (un 403 al personal sin "codigos-descuento" mientras el
  // servidor no le abra la lista), el formulario lo explica en vez de mostrar un selector vacío como si no hubiera códigos.
  const {
    data: codesData,
    error: codesError,
    refetch: refetchCodes,
  } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: fetchMyDiscountCodes,
    retry: (count, err) => err?.response?.status !== 403 && count < 2,
  });
  const discountCodes = codesData?.discountCodes;
  // Mismo cupo de códigos que la pestaña Códigos (codesData.limit), para que "+ Crear nuevo" del formulario no abra un
  // alta que el servidor rechaza en el tope.
  const maxActiveCodes = codesData?.limit?.maxActive ?? null;
  const atCodeLimit = maxActiveCodes !== null && (codesData?.limit?.activeCount ?? 0) >= maxActiveCodes;
  const planHasCodes = !vendor?.planFeatures || !!vendor.planFeatures.allowDiscountCodes;
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/store-offers/${id}`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-store-offers"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la oferta."),
  });

  function closeForm() {
    setFormTarget(null);
  }
  function handleSaved() {
    closeForm();
    queryClient.invalidateQueries({ queryKey: ["my-store-offers"] });
    queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
  }

  // Bloque 52: el tope de ofertas de tienda activas pasó a ser un límite POR
  // PLAN (PlanConfig.maxActiveStoreOffers) — antes era un único valor global
  // en siteSettings. null = sin límite.
  const planConfig = siteSettings?.plans?.find((p) => p.planType === vendor?.planType);
  const maxActive = planConfig?.maxActiveStoreOffers ?? null;
  const activeCount = (storeOffers ?? []).filter((o) => o.active).length;
  const atLimit = maxActive !== null && activeCount >= maxActive;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        {/* Bloque 232 (pedido explícito — "los vendedores podrán ver
            cuántas ofertas pueden tener activas en su tienda"): visible
            solo cuando ya hay ofertas cargadas (con 0 no aporta nada). */}
        {storeOffers?.length > 0 && (
          <span
            className="rounded-full px-3 py-1.5 text-[12px] font-bold"
            style={atLimit ? { background: "rgba(138,81,0,0.12)", color: "#8A5100" } : { background: "rgba(12,174,83,0.12)", color: "#087A38" }}
          >
            {activeCount}/{maxActive ?? "∞"} {maxActive === 1 ? "oferta activa" : "ofertas activas"}
          </span>
        )}
        {canWrite && (
          <div className="ml-auto" title={!vendor?.isVerified ? "Disponible solo para tiendas verificadas" : undefined}>
            <Button className="rounded-xl font-bold" disabled={!vendor?.isVerified} onClick={() => setFormTarget({})}>
              <Plus className="mr-1 h-4 w-4" /> Agregar oferta
            </Button>
          </div>
        )}
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Se muestran en la página pública de tu tienda mientras estén activas y dentro de su fecha programada. Cada una
        lleva un código de descuento asignado: puedes reusar uno ya existente o crear uno nuevo exclusivo para la oferta.
      </p>

      {!vendor?.isVerified && (
        <EmptyState
          icon={ShieldAlert}
          title="Disponible solo para tiendas verificadas"
          description="Verifica tu tienda para poder publicar ofertas dentro de tu propia página."
          action={
            <Link
              to="/vendedor/verificacion"
              className="mt-1 inline-flex items-center gap-1.5 rounded-xl bg-secondary-container px-5 py-2.5 text-[13px] font-bold text-primary transition hover:brightness-95"
            >
              Ver planes
            </Link>
          }
        />
      )}

      {vendor?.isVerified && isLoading && <ListSkeleton />}

      {vendor?.isVerified && !isLoading && !storeOffers?.length && (
        <EmptyState
          icon={Gift}
          title="Todavía no publicaste ninguna oferta de tienda"
          description="Agrega un título, descripción y un código de descuento. Se muestra en tu tienda mientras esté activa."
        />
      )}

      {vendor?.isVerified && storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => {
            const scheduled = o.active && o.startsAt && new Date(o.startsAt) > new Date();
            // Suspendida por el administrador: la tienda no puede reactivarla (el servidor responde 403), así que no se
            // ofrece el botón y se muestra el motivo si el admin lo escribió.
            const suspended = !!o.suspendedAt;
            return (
              <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
                <div className="p-3.5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        suspended
                          ? "bg-error/10 text-error"
                          : scheduled
                          ? "bg-secondary/10 text-secondary"
                          : o.active
                          ? "bg-verified/10 text-verified-dark"
                          : "bg-surface-container text-outline"
                      }`}
                    >
                      {suspended ? "Suspendida por el administrador" : scheduled ? "Programada" : o.active ? "Activa" : "Inactiva"}
                    </span>
                    <span className="rounded-full bg-error/10 px-2.5 py-1 text-[10.5px] font-bold text-error">
                      {o.discountCode.code} · {discountLabel(o.discountCode)}
                    </span>
                  </div>
                  <div className="mb-1 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                  {suspended && (
                    <p className="mb-2 flex items-start gap-1.5 text-[11.5px] text-error">
                      <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>{o.suspendedReason ? `Motivo: ${o.suspendedReason}` : "No se muestra en tu tienda. Si crees que es un error, escríbenos."}</span>
                    </p>
                  )}
                  {o.isLimitedTime && scheduled && (
                    <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-secondary">
                      <CalendarClock className="h-3 w-3 flex-shrink-0" /> Empieza el {fmtDate(o.startsAt)}
                    </div>
                  )}
                  {o.isLimitedTime && o.expiresAt && (
                    <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-outline">
                      <Clock className="h-3 w-3 flex-shrink-0" /> Vence el {fmtDate(o.expiresAt)}
                    </div>
                  )}
                  {canWrite && (
                    <div className="flex items-center gap-3.5">
                      <button
                        onClick={() => setFormTarget(o)}
                        className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-tertiary-accent hover:underline"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      {!suspended && (
                        <button
                          onClick={() => toggleActive.mutate({ id: o.id, active: !o.active })}
                          disabled={toggleActive.isPending || (!o.active && atLimit)}
                          title={!o.active && atLimit ? `Ya tienes ${maxActive}/${maxActive} ofertas activas. Desactiva otra primero.` : undefined}
                          className="flex min-h-11 items-center gap-1.5 text-[12px] font-semibold text-error hover:underline disabled:cursor-not-allowed disabled:text-outline disabled:no-underline"
                        >
                          <Power className="h-3.5 w-3.5" /> {o.active ? "Retirar" : "Reactivar"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {formTarget && (
        <StoreOfferFormModal
          offer={formTarget.id ? formTarget : null}
          discountCodes={discountCodes}
          codesError={codesError}
          onRetryCodes={() => refetchCodes()}
          canCreateCodes={canCreateCodes}
          atCodeLimit={atCodeLimit}
          maxActiveCodes={maxActiveCodes}
          planHasCodes={planHasCodes}
          isStaff={isStaff}
          atLimit={atLimit}
          maxActive={maxActive}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// Bloque 232: pestaña "Códigos de descuento" — antes VendorDiscountCodes.jsx
// (página propia con su propio NAV), ahora vive acá adentro tal cual, sin
// cambios de comportamiento.
function vigenciaLabel(c) {
  if (!c.expiresAt) return "Sin vencimiento";
  const expired = new Date(c.expiresAt) < new Date();
  return `${expired ? "Venció" : "Vence"} el ${fmtDate(c.expiresAt)}`;
}

function valueLabel(c) {
  return c.type === "PERCENTAGE" ? `${Number(c.value)}% · productos en ${c.currency ?? "CUP"}` : `${Number(c.value).toLocaleString("es-CU")} ${c.currency ?? "CUP"}`;
}

// `canWrite`: escritura en "codigos-descuento" (en solo lectura no salen crear, activar, editar ni eliminar, que el servidor
// rechaza).
function DiscountCodesTab({ canWrite }) {
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: codesData, isLoading, error: codesError, refetch: refetchCodes, isFetching: codesFetching } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: fetchMyDiscountCodes,
  });
  const discountCodes = codesData?.discountCodes;
  // Cupo del plan: solo cuentan los códigos encendidos, sin suspender y sin vencer (countedCodeWhere en
  // discountCodes.controller.js), así que desactivar uno libera su lugar. Se muestra "X/N" y, en el tope, no se ofrece
  // crear ni encender otro que contaría, en vez de esperar al error del servidor.
  const maxActiveCodes = codesData?.limit?.maxActive ?? null;
  const activeCodes = codesData?.limit?.activeCount ?? 0;
  const atCodeLimit = maxActiveCodes !== null && activeCodes >= maxActiveCodes;
  const wouldCount = (c) => !c.suspendedAt && (!c.expiresAt || new Date(c.expiresAt) > new Date());

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/discount-codes/${id}`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el código."),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/discount-codes/${id}`)).data,
    onSuccess: () => {
      toast.success("Código eliminado.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el código.");
      setDeleteTarget(null);
    },
  });

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        {codesData?.limit && discountCodes.length > 0 && (
          <span
            className="rounded-full px-3 py-1.5 text-[12px] font-bold"
            style={atCodeLimit ? { background: "rgba(138,81,0,0.12)", color: "#8A5100" } : { background: "rgba(12,174,83,0.12)", color: "#087A38" }}
          >
            {activeCodes}/{maxActiveCodes ?? "∞"} {maxActiveCodes === 1 ? "código activo" : "códigos activos"}
          </span>
        )}
        {canWrite && (
          <div className="ml-auto" title={atCodeLimit ? "Llegaste al tope de códigos activos de tu plan" : undefined}>
            <Button className="rounded-xl font-bold" disabled={atCodeLimit} onClick={() => setFormTarget({})}>
              <Plus className="mr-1 h-4 w-4" /> Crear código
            </Button>
          </div>
        )}
      </div>
      {canWrite && atCodeLimit && (
        <p role="status" className="mb-3 mt-2 rounded-xl border border-secondary/30 bg-secondary/[0.06] px-4 py-3 text-[13px] text-on-surface">
          {maxActiveCodes === 0
            ? "Tu plan actual no incluye códigos de descuento activos."
            : `Tu plan permite hasta ${maxActiveCodes === 1 ? "1 código activo" : `${maxActiveCodes} códigos activos`}. Desactiva uno o mejora tu plan para crear otro.`}
        </p>
      )}
      <p className="mb-[22px] text-[13.5px] text-outline">
        Códigos que tus clientes pueden aplicar en el carrito para llevarse un descuento. Un código ya usado no se puede
        editar ni eliminar: solo activar o desactivar.
      </p>

      {isLoading && <ListSkeleton />}

      {!isLoading && codesError && !codesData && (
        <div role="alert" className="rounded-2xl border border-error/30 bg-error/[0.06] p-5 text-[13.5px] text-on-surface-variant">
          <p className="font-bold text-on-surface">No pudimos cargar tus códigos de descuento.</p>
          <button
            type="button"
            onClick={() => refetchCodes()}
            disabled={codesFetching}
            className="mt-2 inline-flex min-h-11 items-center font-bold text-tertiary-accent underline disabled:opacity-60"
          >
            {codesFetching ? "Reintentando..." : "Reintentar"}
          </button>
        </div>
      )}

      {!isLoading && !codesError && !discountCodes?.length && (
        <EmptyState
          icon={Percent}
          title="Todavía no creaste ningún código"
          description="Crea uno con porcentaje o monto fijo, en la moneda de tus productos, con o sin límite de usos ni vencimiento."
        />
      )}

      {discountCodes?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11.5px] font-bold uppercase tracking-wide text-outline">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Vigencia</th>
                <th className="px-4 py-3">Usos</th>
                <th className="px-4 py-3">Estado</th>
                {canWrite && <th className="px-4 py-3">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {discountCodes.map((c) => (
                <tr key={c.id} className="border-b border-surface-container last:border-b-0">
                  <td className="px-4 py-3 font-mono font-bold text-on-surface">{c.code}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{valueLabel(c)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{vigenciaLabel(c)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {c.usesCount}
                    {c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3">
                    {/* Suspendido por el administrador: no se puede activar ni eliminar desde aquí (el servidor lo rechaza). */}
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        c.suspendedAt ? "bg-error/10 text-error" : c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container-high text-outline"
                      }`}
                    >
                      {c.suspendedAt ? "Suspendido por el administrador" : c.active ? "Activo" : "Inactivo"}
                    </span>
                    {c.suspendedAt && c.suspendedReason && <p className="mt-1.5 max-w-[240px] text-[11.5px] text-error">Motivo: {c.suspendedReason}</p>}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {!c.suspendedAt && (
                          <button
                            onClick={() => toggleActive.mutate({ id: c.id, active: !c.active })}
                            // Encender uno que contaría (sin vencer) en el tope lo rechaza el servidor: se deja apagado aquí.
                            disabled={toggleActive.isPending || (!c.active && atCodeLimit && wouldCount(c))}
                            title={!c.active && atCodeLimit && wouldCount(c) ? "Llegaste al tope de códigos activos de tu plan" : c.active ? "Desactivar" : "Activar"}
                            className="flex min-h-11 items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline disabled:cursor-not-allowed disabled:text-outline disabled:no-underline"
                          >
                            <Power className="h-3.5 w-3.5" /> {c.active ? "Desactivar" : "Activar"}
                          </button>
                        )}
                        {c.usesCount === 0 && !c.suspendedAt && (
                          <>
                            <button
                              onClick={() => setFormTarget(c)}
                              className="flex min-h-11 items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button
                              onClick={() => setDeleteTarget(c)}
                              className="flex min-h-11 items-center gap-1 text-[12px] font-semibold text-error hover:underline"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formTarget && (
        <DiscountCodeFormModal
          code={formTarget.id ? formTarget : null}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
          }}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="¿Eliminar este código?"
        message="Se borra por completo. Solo se puede eliminar un código que nunca fue usado."
        confirmLabel={remove.isPending ? "Eliminando..." : "Eliminar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const TABS = [
  { id: "ofertas-tienda", label: "Ofertas", icon: Gift },
  { id: "codigos-descuento", label: "Códigos de descuento", icon: Percent },
];

// Bloque 232 (pedido explícito — "creo que la sección... de crear código de
// oferta y crear oferta dentro de la tienda pueden estar fusionadas y en
// una misma sección, valora eso"): antes 2 páginas/links de NAV aparte
// (VendorDiscountCodes.jsx + este archivo) — ahora una sola, con pestañas
// (mismo componente Tabs que ya usa VendorSettings.jsx). Cada pestaña se
// filtra por su propio permiso de sección (un usuario de sistema puede
// tener una sola de las 2 asignadas — ver VendorLayout.jsx, que ahora deja
// entrar acá con CUALQUIERA de las 2).
export default function VendorStoreOffers() {
  const { vendor, isStaff, mySections, staffSectionPermissions } = useOutletContext();
  // Además del permiso de sección, cada pestaña sale solo si el plan trae su función (planFeatures, GET /vendors/me): un
  // plan con códigos y sin ofertas no ve un "Agregar oferta" que el servidor rechaza. Sin ninguna de las dos, VendorLayout
  // ya muestra el aviso del plan en lugar de esta pantalla.
  const planFeatures = vendor?.planFeatures;
  const canViewOfertas = (!isStaff || mySections?.includes("ofertas-tienda")) && (!planFeatures || planFeatures.allowStoreOffers);
  const canViewCodigos = (!isStaff || mySections?.includes("codigos-descuento")) && (!planFeatures || planFeatures.allowDiscountCodes);
  const visibleTabs = TABS.filter((t) => (t.id === "ofertas-tienda" ? canViewOfertas : canViewCodigos));
  const [tab, setTab] = useState(visibleTabs[0]?.id ?? "ofertas-tienda");
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;
  // Nivel de cada sección (Bloque 185: "manage" escribe, "view" solo mira; null para el dueño = todo). "+ Crear nuevo" del
  // formulario de oferta crea un código: pide la sección de códigos con escritura y que el plan los incluya (mismas reglas
  // que POST /discount-codes), aunque se use desde la pestaña Ofertas.
  const canWriteOfertas = canWriteSection(staffSectionPermissions, "ofertas-tienda");
  const canWriteCodigos = canWriteSection(staffSectionPermissions, "codigos-descuento");
  const canCreateCodes = canViewCodigos && canWriteCodigos;

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Gift} tone="orange" />
        <div>
          <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Ofertas y códigos</h1>
          <p className="text-[12px] text-outline">Ofertas dentro de tu tienda y los códigos de descuento que usan. Son distintas de la sección "Ofertas" del Home.</p>
        </div>
      </div>

      {/* Con una sola pestaña visible (usuario de sistema con solo 1 de las
          2 secciones), no tiene sentido mostrar una barra de pestañas de 1
          solo botón — se muestra el contenido directo. */}
      {visibleTabs.length > 1 && <Tabs tabs={visibleTabs} value={activeTab} onChange={setTab} className="mb-5 mt-4" />}
      {visibleTabs.length <= 1 && <div className="mt-4" />}

      {activeTab === "ofertas-tienda" && <StoreOffersTab vendor={vendor} isStaff={isStaff} canWrite={canWriteOfertas} canCreateCodes={canCreateCodes} />}
      {activeTab === "codigos-descuento" && <DiscountCodesTab canWrite={canWriteCodigos} />}
    </div>
  );
}
