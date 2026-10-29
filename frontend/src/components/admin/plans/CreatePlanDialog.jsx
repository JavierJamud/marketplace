import { useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import toast from "../../../lib/toast.jsx";
import { Input } from "../../ui/Input.jsx";
import { Select } from "../../ui/Select.jsx";
import { PlanDialog, DialogButton } from "./PlanDialog.jsx";
import { apiError } from "./planUtils.js";

const FIELD =
  "h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none placeholder:text-on-surface-variant focus:border-tertiary-accent focus-visible:ring-2 focus-visible:ring-tertiary-accent/30";

// Asistente corto para crear un plan: nombre, de qué plan copiar funciones y límites, y precio (opcional). El servidor lo
// crea OCULTO (isPublic=false) con una clave nueva que nunca cambia; después se abre Configurar para revisarlo antes de
// mostrarlo. Si no se elige de dónde copiar, el servidor copia del plan por defecto: así un plan nuevo nunca nace con
// todo encendido e ilimitado.
export function CreatePlanDialog({ open, plans, preset, onClose, onCreated }) {
  const defaultKey = plans.find((p) => p.isDefault)?.planType ?? plans[0]?.planType ?? "";
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState(defaultKey);
  const [priceCup, setPriceCup] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(preset?.name ?? "");
    setCopyFrom(preset?.copyFrom ?? defaultKey);
    setPriceCup("");
    setPriceUsd("");
    // Solo al abrir: si la lista de planes se recarga con la ventana abierta, no se pisa lo escrito.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim();
  const taken = plans.some((p) => p.displayName.trim().toLowerCase() === trimmed.toLowerCase());
  const usd = Number(priceUsd.replace(",", "."));
  const onePrice = (priceCup !== "") !== (priceUsd !== "");
  const priceZero = priceCup !== "" && priceUsd !== "" && (!(Number(priceCup) > 0) || !(usd > 0));
  const nameError = trimmed.length > 40 ? "El nombre admite hasta 40 caracteres." : taken ? "Ya hay un plan con ese nombre." : null;
  const priceError = onePrice ? "Escribe el precio en las dos monedas, o deja las dos vacías." : priceZero ? "Los precios tienen que ser mayores que 0." : null;
  const ready = trimmed.length >= 1 && !nameError && !priceError && !!copyFrom;
  const source = plans.find((p) => p.planType === copyFrom);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    let created = null;
    try {
      created = (await api.post("/admin/plans", { displayName: trimmed, copyFrom })).data?.plan ?? null;
    } catch (err) {
      setBusy(false);
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo crear el plan."));
      return;
    }
    if (!created) {
      setBusy(false);
      toast.error("El servidor no devolvió el plan creado. Recarga la página para verlo.");
      onClose();
      return;
    }
    // Con precio escrito, el plan pasa a cobrarse (deja de ser gratis o por WhatsApp si lo copió así). Todavía no tiene
    // tiendas, así que nadie recibe avisos de cobro.
    if (priceCup !== "" && priceUsd !== "") {
      try {
        created =
          (await api.patch(`/admin/plans/${encodeURIComponent(created.planType)}`, { priceCup: Number(priceCup), priceUsd: usd, isFree: false, contactOnly: false })).data?.plan ?? created;
      } catch (err) {
        toast.error(err.actionCodeCancelled ? "El plan se creó sin el precio. Ponlo en Configurar." : apiError(err, "El plan se creó, pero no se guardó el precio. Ponlo en Configurar."));
      }
    }
    setBusy(false);
    toast.success(`Plan ${created.displayName} creado. Está oculto hasta que lo muestres.`);
    onCreated(created);
  }

  return (
    <PlanDialog
      open={open}
      title={preset?.copyFrom ? "Duplicar plan" : "Crear plan"}
      description="El plan nace oculto: revísalo en Configurar y muéstralo en la página de planes cuando esté listo."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <DialogButton variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </DialogButton>
          <DialogButton onClick={submit} disabled={!ready || busy}>
            {busy ? "Creando..." : "Crear y configurar"}
          </DialogButton>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-3"
      >
        <Input label="Nombre del plan" required data-autofocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Restaurante" error={nameError ?? undefined} />
        <div>
          <Select label="Copiar funciones, límites y precio de" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {plans.map((p) => (
              <option key={p.planType} value={p.planType}>
                {p.displayName}
              </option>
            ))}
          </Select>
          {source && (
            <p className="mt-1 text-[12px] text-on-surface-variant">
              Empieza igual que {source.displayName}. Después cambias lo que quieras en Configurar.
            </p>
          )}
          {/* Lo que se copia, para elegir el punto de partida sin tener que abrir el otro plan. */}
          {source?.includes?.length > 0 && (
            <div className="mt-2 rounded-lg bg-surface-container-low px-3 py-2.5">
              <p className="mb-1 text-[12px] font-bold text-on-surface">Empieza con:</p>
              <ul className="grid gap-0.5 text-[12px] text-on-surface-variant">
                {source.includes.slice(0, 6).map((line) => (
                  <li key={line} className="truncate">· {line}</li>
                ))}
              </ul>
              {source.includes.length > 6 && <p className="mt-1 text-[12px] text-on-surface-variant">y {source.includes.length - 6} más.</p>}
            </div>
          )}
        </div>
        <fieldset>
          <legend className="mb-1 text-label-md text-on-surface-variant">Precio al mes (opcional)</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">CUP</span>
              <input inputMode="numeric" value={priceCup} onChange={(e) => setPriceCup(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Como el copiado" className={FIELD} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-on-surface-variant">USD</span>
              <input inputMode="decimal" value={priceUsd} onChange={(e) => setPriceUsd(e.target.value.replace(/[^\d.,]/g, "").slice(0, 9))} placeholder="Como el copiado" className={FIELD} />
            </label>
          </div>
          <p className={`mt-1 text-[12px] ${priceError ? "font-semibold text-error" : "text-on-surface-variant"}`}>
            {priceError ?? "Si escribes precio, el plan se cobra. Vacío: queda con el precio y la forma de venta del plan copiado."}
          </p>
        </fieldset>
        {/* Enter en cualquier campo crea el plan. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </PlanDialog>
  );
}
