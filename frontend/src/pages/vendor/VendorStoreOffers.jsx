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
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} CUP`;
}

// Bloque 232 (pedido explícito — "se podrán crear una oferta o varias
// dentro del panel del vendedor pero solo se podrá mantener una oferta
// activa por tienda, se puede programar cuándo empieza una y cuándo
// termina"): el formulario ahora cubre 3 cosas nuevas — "active" al crear
// (permite dejarla como borrador sin que cuente contra el límite),
// "startsAt" junto al "expiresAt" que ya existía, y `atLimit` (viene del
// padre, que ya sabe cuántas activas tiene contra la política del admin)
// para avisar ANTES de que el backend rechace el intento.
function StoreOfferFormModal({ offer, discountCodes, atLimit, maxActive, onClose, onSaved }) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
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
                {discountCodes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({discountLabel(c)}) {c.active ? "" : "· inactivo"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowCreateCode(true)}
                className="flex-shrink-0 rounded-full border border-outline-variant px-3.5 text-[12.5px] font-bold text-tertiary-accent hover:bg-surface-container"
              >
                + Crear nuevo
              </button>
            </div>
            {!discountCodes?.length && (
              <p className="mt-1.5 text-[11px] text-outline">Todavía no tienes códigos de descuento — crea uno para esta oferta.</p>
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
                  Recomendado: usa un código exclusivo para esta oferta (con "+ Crear nuevo") — se desactiva solo cuando la oferta vence.
                  Si reusas uno existente, tú decides cuándo desactivarlo.
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
                    ? `Ya tienes el máximo de ofertas activas permitidas (${maxActive}) — guárdala como borrador y activa esta cuando desactives otra.`
                    : "Destildado, queda guardada como borrador — podrás activarla más adelante desde la lista."}
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
function StoreOffersTab({ vendor }) {
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null); // null cerrado, {} crear, offer editar

  const { data: storeOffers, isLoading } = useQuery({
    queryKey: ["my-store-offers"],
    queryFn: async () => (await api.get("/store-offers/me/list")).data.storeOffers,
    enabled: !!vendor?.isVerified,
  });
  const { data: discountCodes } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: async () => (await api.get("/discount-codes/me/list")).data.discountCodes,
  });
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

  const maxActive = siteSettings?.maxActiveStoreOffersPerVendor ?? 1;
  const activeCount = (storeOffers ?? []).filter((o) => o.active).length;
  const atLimit = activeCount >= maxActive;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        {/* Bloque 232 (pedido explícito — "los vendedores podrán ver
            cuántas ofertas pueden tener activas en su tienda"): visible
            solo cuando ya hay ofertas cargadas (con 0 no aporta nada). */}
        {storeOffers?.length > 0 && (
          <span
            className="rounded-full px-3 py-1.5 text-[12px] font-bold"
            style={atLimit ? { background: "rgba(138,81,0,0.12)", color: "#8A5100" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
          >
            {activeCount}/{maxActive} {maxActive === 1 ? "oferta activa" : "ofertas activas"}
          </span>
        )}
        <div className="ml-auto" title={!vendor?.isVerified ? "Disponible solo para tiendas verificadas" : undefined}>
          <Button className="rounded-xl font-bold" disabled={!vendor?.isVerified} onClick={() => setFormTarget({})}>
            <Plus className="mr-1 h-4 w-4" /> Agregar oferta
          </Button>
        </div>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Se muestran en la página pública de tu tienda mientras estén activas y dentro de su fecha programada. Cada una
        lleva un código de descuento asignado — puedes reusar uno ya existente o crear uno nuevo exclusivo para la oferta.
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

      {vendor?.isVerified && isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {vendor?.isVerified && !isLoading && !storeOffers?.length && (
        <EmptyState
          icon={Gift}
          title="Todavía no publicaste ninguna oferta de tienda"
          description="Agrega un título, descripción y un código de descuento — se muestra en tu tienda mientras esté activa."
        />
      )}

      {vendor?.isVerified && storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => {
            const scheduled = o.active && o.startsAt && new Date(o.startsAt) > new Date();
            return (
              <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
                <div className="p-3.5">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        scheduled
                          ? "bg-[#8A5100]/10 text-[#8A5100]"
                          : o.active
                          ? "bg-verified/10 text-verified-dark"
                          : "bg-surface-container text-outline"
                      }`}
                    >
                      {scheduled ? "Programada" : o.active ? "Activa" : "Inactiva"}
                    </span>
                    <span className="rounded-full bg-error/10 px-2.5 py-1 text-[10.5px] font-bold text-error">
                      {o.discountCode.code} · {discountLabel(o.discountCode)}
                    </span>
                  </div>
                  <div className="mb-1 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                  {o.isLimitedTime && scheduled && (
                    <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-[#8A5100]">
                      <CalendarClock className="h-3 w-3 flex-shrink-0" /> Empieza el {fmtDate(o.startsAt)}
                    </div>
                  )}
                  {o.isLimitedTime && o.expiresAt && (
                    <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-outline">
                      <Clock className="h-3 w-3 flex-shrink-0" /> Vence el {fmtDate(o.expiresAt)}
                    </div>
                  )}
                  <div className="flex items-center gap-3.5">
                    <button
                      onClick={() => setFormTarget(o)}
                      className="flex items-center gap-1.5 text-[12px] font-semibold text-tertiary-accent hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActive.mutate({ id: o.id, active: !o.active })}
                      disabled={toggleActive.isPending || (!o.active && atLimit)}
                      title={!o.active && atLimit ? `Ya tienes ${maxActive}/${maxActive} ofertas activas — desactiva otra primero.` : undefined}
                      className="flex items-center gap-1.5 text-[12px] font-semibold text-error hover:underline disabled:cursor-not-allowed disabled:text-outline disabled:no-underline"
                    >
                      <Power className="h-3.5 w-3.5" /> {o.active ? "Retirar" : "Reactivar"}
                    </button>
                  </div>
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
  return c.type === "PERCENTAGE" ? `${Number(c.value)}%` : `${Number(c.value).toLocaleString("es-CU")} CUP`;
}

function DiscountCodesTab() {
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: discountCodes, isLoading } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: async () => (await api.get("/discount-codes/me/list")).data.discountCodes,
  });

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
      <div className="mb-1 flex flex-wrap items-center justify-end gap-3">
        <Button className="rounded-xl font-bold" onClick={() => setFormTarget({})}>
          <Plus className="mr-1 h-4 w-4" /> Crear código
        </Button>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Códigos que tus clientes pueden aplicar en el carrito para llevarse un descuento. Un código ya usado no se puede
        editar ni eliminar — solo activar o desactivar.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && !discountCodes?.length && (
        <EmptyState
          icon={Percent}
          title="Todavía no creaste ningún código"
          description="Crea uno con porcentaje o monto fijo en CUP, con o sin límite de usos ni vencimiento."
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
                <th className="px-4 py-3">Acciones</th>
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
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container-high text-outline"
                      }`}
                    >
                      {c.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleActive.mutate({ id: c.id, active: !c.active })}
                        disabled={toggleActive.isPending}
                        title={c.active ? "Desactivar" : "Activar"}
                        className="flex items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" /> {c.active ? "Desactivar" : "Activar"}
                      </button>
                      {c.usesCount === 0 && (
                        <>
                          <button
                            onClick={() => setFormTarget(c)}
                            className="flex items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(c)}
                            className="flex items-center gap-1 text-[12px] font-semibold text-error hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
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
  const { vendor, isStaff, mySections } = useOutletContext();
  const canViewOfertas = !isStaff || mySections?.includes("ofertas-tienda");
  const canViewCodigos = !isStaff || mySections?.includes("codigos-descuento");
  const visibleTabs = TABS.filter((t) => (t.id === "ofertas-tienda" ? canViewOfertas : canViewCodigos));
  const [tab, setTab] = useState(visibleTabs[0]?.id ?? "ofertas-tienda");
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Gift} tone="orange" />
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Ofertas y códigos</h1>
          <p className="text-[12px] text-outline">Ofertas dentro de tu tienda y los códigos de descuento que usan — distintas de la sección "Ofertas" del Home.</p>
        </div>
      </div>

      {/* Con una sola pestaña visible (usuario de sistema con solo 1 de las
          2 secciones), no tiene sentido mostrar una barra de pestañas de 1
          solo botón — se muestra el contenido directo. */}
      {visibleTabs.length > 1 && <Tabs tabs={visibleTabs} value={activeTab} onChange={setTab} className="mb-5 mt-4" />}
      {visibleTabs.length <= 1 && <div className="mt-4" />}

      {activeTab === "ofertas-tienda" && <StoreOffersTab vendor={vendor} />}
      {activeTab === "codigos-descuento" && <DiscountCodesTab />}
    </div>
  );
}
