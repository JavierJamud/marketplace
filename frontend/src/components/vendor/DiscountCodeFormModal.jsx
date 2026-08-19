import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Input } from "../ui/Input.jsx";

function fmtDateInput(iso) {
  // datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, sin offset —
  // mismo helper que AdminAnnouncements.jsx.
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Bloque 52: formulario único de código de descuento — reusado tal cual
// desde "Códigos de descuento" del panel (crear/editar) y embebido desde
// "Ofertas de mi tienda" cuando el vendedor elige "Crear código nuevo para
// esta oferta" (ahí solo se usa en modo crear). Editar condiciones solo si
// usesCount === 0 — el backend ya lo valida, acá se refleja deshabilitando
// esos campos para no dar una falsa sensación de que se puede.
export function DiscountCodeFormModal({ code, onClose, onSaved }) {
  const isEdit = !!code;
  const locked = isEdit && code.usesCount > 0;

  const [manualCode, setManualCode] = useState(isEdit ? code.code : "");
  const [type, setType] = useState(isEdit ? code.type : "PERCENTAGE");
  const [value, setValue] = useState(isEdit ? String(code.value) : "");
  const [minPurchase, setMinPurchase] = useState(isEdit && code.minPurchase != null ? String(code.minPurchase) : "");
  const [maxPurchase, setMaxPurchase] = useState(isEdit && code.maxPurchase != null ? String(code.maxPurchase) : "");
  const [maxUses, setMaxUses] = useState(isEdit && code.maxUses != null ? String(code.maxUses) : "");
  const [hasExpiry, setHasExpiry] = useState(isEdit ? !!code.expiresAt : false);
  const [startsAt, setStartsAt] = useState(fmtDateInput(isEdit ? code.startsAt : null));
  const [expiresAt, setExpiresAt] = useState(fmtDateInput(isEdit ? code.expiresAt : null));

  const invalidRange = hasExpiry && new Date(expiresAt) <= new Date(startsAt);
  const invalidPurchaseRange = minPurchase && maxPurchase && Number(maxPurchase) <= Number(minPurchase);
  const invalidPercentage = type === "PERCENTAGE" && value && Number(value) > 100;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        type,
        value: Number(value),
        minPurchase: minPurchase ? Number(minPurchase) : undefined,
        maxPurchase: maxPurchase ? Number(maxPurchase) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
        hasExpiry,
        startsAt: hasExpiry ? new Date(startsAt).toISOString() : undefined,
        expiresAt: hasExpiry ? new Date(expiresAt).toISOString() : undefined,
      };
      if (isEdit) {
        return (await api.patch(`/discount-codes/${code.id}`, payload)).data;
      }
      return (await api.post("/discount-codes", { ...payload, code: manualCode.trim() || undefined })).data;
    },
    onSuccess: ({ discountCode }) => {
      toast.success(isEdit ? "Código actualizado." : `Código "${discountCode.code}" creado.`);
      onSaved(discountCode);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el código."),
  });

  const disabledSubmit =
    save.isPending || !value.trim() || invalidRange || invalidPurchaseRange || invalidPercentage || (hasExpiry && (!startsAt || !expiresAt));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">{isEdit ? "Editar código de descuento" : "Crear código de descuento"}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>

        {locked && (
          <p className="mb-4 rounded-xl bg-tertiary-accent/[0.08] p-3 text-[12.5px] text-on-surface">
            Este código ya fue usado {code.usesCount} {code.usesCount === 1 ? "vez" : "veces"} — solo puedes activarlo o desactivarlo, no
            editar sus condiciones.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-3.5"
        >
          {!isEdit && (
            <Input
              label="Código (opcional)"
              placeholder="Ej: VERANO20 — vacío = se genera automático"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              maxLength={24}
            />
          )}
          {isEdit && (
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Código</span>
              <div className="h-11 w-full rounded border border-outline-variant bg-surface-container px-3.5 py-2.5 text-body-md font-bold text-on-surface">
                {code.code}
              </div>
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Tipo de descuento</span>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { v: "PERCENTAGE", l: "Porcentaje (%)" },
                { v: "FIXED_AMOUNT", l: "Monto fijo (CUP)" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  disabled={locked}
                  onClick={() => setType(o.v)}
                  className={`rounded-xl border-2 py-2.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                    type === o.v ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          <Input
            label={type === "PERCENTAGE" ? "Valor del descuento (%)" : "Valor del descuento (CUP)"}
            type="number"
            min={0}
            max={type === "PERCENTAGE" ? 100 : undefined}
            required
            disabled={locked}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={invalidPercentage ? "El porcentaje no puede superar 100%." : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Compra mínima (opcional)"
              type="number"
              min={0}
              disabled={locked}
              value={minPurchase}
              onChange={(e) => setMinPurchase(e.target.value)}
            />
            <Input
              label="Compra máxima (opcional)"
              type="number"
              min={0}
              disabled={locked}
              value={maxPurchase}
              onChange={(e) => setMaxPurchase(e.target.value)}
              error={invalidPurchaseRange ? "Debe ser mayor que el mínimo." : undefined}
            />
          </div>

          <Input
            label="Límite de usos totales (opcional, vacío = ilimitado)"
            type="number"
            min={1}
            disabled={locked}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />

          <label className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <input type="checkbox" checked={hasExpiry} disabled={locked} onChange={(e) => setHasExpiry(e.target.checked)} className="h-4 w-4" />
            Con fecha de vencimiento
          </label>

          {hasExpiry && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-label-sm text-outline">Desde</span>
                <input
                  type="datetime-local"
                  disabled={locked}
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none disabled:opacity-50"
                />
              </div>
              <div>
                <span className="mb-1 block text-label-sm text-outline">Hasta</span>
                <input
                  type="datetime-local"
                  disabled={locked}
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-[13px] outline-none disabled:opacity-50"
                />
              </div>
              {invalidRange && <p className="col-span-2 text-[11.5px] text-error">La fecha de fin debe ser posterior a la de inicio.</p>}
            </div>
          )}
          {!hasExpiry && <p className="text-[11px] text-outline">Sin vencimiento — el código sigue activo hasta que lo desactives a mano.</p>}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={disabledSubmit}>
              {save.isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear código"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
