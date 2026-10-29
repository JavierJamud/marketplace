import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Plus, Trash2, X } from "lucide-react";
import toast from "../../../lib/toast.jsx";
import { api } from "../../../lib/api.js";
import { Input } from "../../ui/Input.jsx";
import { Select } from "../../ui/Select.jsx";
import { PlanDialog, DialogButton } from "./PlanDialog.jsx";
import { MAX_TEXT_LINES, MAX_TEXT_LINE_LENGTH, apiError, includesPreview } from "./planUtils.js";

// Texto que pide el contrato de planes para toda función personalizada: el servidor no la hace cumplir.
const CUSTOM_NOTICE = "Solo se muestra como beneficio. La plataforma no la activa ni la bloquea: cúmplela tú.";

// Lista de líneas de texto libre del plan (el campo features de siempre), con su chip para quitar cada una. Mismos topes
// que textFeaturesSchema del servidor (12 líneas de 80 caracteres): pasarse hacía fallar el guardado con un 400.
function FeatureChipList({ items, onChange, error }) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const hintId = useId();
  const full = items.length >= MAX_TEXT_LINES;
  function addItem() {
    const value = draft.trim();
    if (!value || full || items.includes(value)) return;
    onChange([...items, value]);
    setDraft("");
  }
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="flex min-h-9 items-center gap-1 rounded-full border border-tertiary-accent bg-tertiary-accent/10 py-1 pl-3.5 pr-1 text-[12.5px] font-semibold text-[#245a5b]">
            {item}
            <button
              type="button"
              aria-label={`Quitar "${item}"`}
              onClick={() => onChange(items.filter((x) => x !== item))}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-tertiary-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-[12.5px] italic text-on-surface-variant">Sin líneas todavía.</li>}
      </ul>
      <label htmlFor={inputId} className="sr-only">
        Nueva línea de texto libre
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={draft}
          maxLength={MAX_TEXT_LINE_LENGTH}
          disabled={full}
          aria-describedby={hintId}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder={full ? "Llegaste al tope de líneas" : "Ej.: Atención por WhatsApp en horario laboral"}
          className="h-11 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[14px] outline-none placeholder:text-on-surface-variant focus:border-tertiary-accent focus-visible:ring-2 focus-visible:ring-tertiary-accent/30 disabled:cursor-not-allowed disabled:bg-surface-container-low"
        />
        <button
          type="button"
          disabled={!draft.trim() || full}
          onClick={addItem}
          aria-label="Agregar línea"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p id={hintId} className="mt-1 text-[12px] text-on-surface-variant">
        {items.length} de {MAX_TEXT_LINES} líneas, hasta {MAX_TEXT_LINE_LENGTH} caracteres cada una.
      </p>
      {error && <p className="mt-1 text-[12.5px] font-semibold text-error">{error}</p>}
    </div>
  );
}

const EMPTY_DRAFT = { label: "", description: "", publicLabel: "", group: "Otras" };

// Crear una función personalizada: va al catálogo de TODOS los planes, sin marcar en ninguno salvo en este (se marca aquí
// y se guarda con el plan).
function NewCustomFeatureForm({ groups, catalog, onCreated, onCancel }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const nameTaken = catalog.some((f) => f.label.trim().toLowerCase() === draft.label.trim().toLowerCase());
  const create = useMutation({
    mutationFn: async () => {
      const maxSort = Math.max(0, ...catalog.map((f) => Number(f.sortOrder) || 0));
      const body = {
        label: draft.label.trim(),
        description: draft.description.trim() || undefined,
        publicLabel: draft.publicLabel.trim() || undefined,
        group: draft.group,
        sortOrder: Math.max(500, maxSort + 10),
      };
      return (await api.post("/admin/plan-features", body)).data;
    },
    onSuccess: (data) => {
      toast.success(`Función "${draft.label.trim()}" creada.`);
      setDraft(EMPTY_DRAFT);
      onCreated(data?.feature);
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo crear la función."));
    },
  });
  const ready = draft.label.trim().length >= 2 && !nameTaken;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) create.mutate();
      }}
      className="rounded-xl border border-outline-variant p-3.5"
    >
      <h4 className="text-[13.5px] font-bold text-on-surface">Nueva función personalizada</h4>
      <p className="mb-3 mt-0.5 text-[12.5px] text-on-surface-variant">Queda disponible para todos los planes, sin marcar. Aquí se marca para este plan al crearla.</p>
      <div className="grid gap-3">
        <Input label="Nombre" required value={draft.label} maxLength={60} onChange={set("label")} placeholder="Ej.: Asesoría inicial" error={nameTaken ? "Ya hay una función con ese nombre." : undefined} />
        <Input label="Texto en la página de planes (opcional)" value={draft.publicLabel} maxLength={90} onChange={set("publicLabel")} placeholder="Si lo dejas vacío se usa el nombre" />
        <label className="block">
          <span className="mb-1 block text-label-md text-on-surface-variant">Qué incluye (opcional, lo ves tú)</span>
          <textarea
            value={draft.description}
            maxLength={300}
            rows={2}
            onChange={set("description")}
            className="w-full rounded border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-[14px] text-on-surface outline-none focus:border-primary-container"
          />
        </label>
        <Select label="Grupo" value={draft.group} onChange={set("group")}>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogButton variant="outline" onClick={onCancel} disabled={create.isPending}>
          Cancelar
        </DialogButton>
        <DialogButton type="submit" disabled={!ready || create.isPending}>
          {create.isPending ? "Creando..." : "Crear función"}
        </DialogButton>
      </div>
    </form>
  );
}

export function PlanExtrasTab({ form, setForm, catalog, groups, errors = {} }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const customs = catalog.filter((f) => f.kind === "custom");
  const active = customs.filter((f) => f.isActive);
  const paused = customs.filter((f) => !f.isActive);
  const preview = includesPreview(form, catalog);
  const toggle = (key, value) => setForm((f) => ({ ...f, custom: { ...f.custom, [key]: value } }));

  const refreshCatalog = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-plan-features"] });
    queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
    queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    queryClient.invalidateQueries({ queryKey: ["public-plans"] });
  };

  const setActive = useMutation({
    mutationFn: async ({ key, isActive }) => (await api.patch(`/admin/plan-features/${encodeURIComponent(key)}`, { isActive })).data,
    onSuccess: (_d, { isActive }) => {
      toast.success(isActive ? "La función vuelve a mostrarse en los planes que la tengan marcada." : "La función dejó de mostrarse en todos los planes.");
      refreshCatalog();
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo cambiar la función."));
    },
  });

  const remove = useMutation({
    mutationFn: async (key) => (await api.delete(`/admin/plan-features/${encodeURIComponent(key)}`)).data,
    onSuccess: (_d, key) => {
      toast.success("Función borrada de todos los planes.");
      setForm((f) => {
        const custom = { ...f.custom };
        delete custom[key];
        return { ...f, custom };
      });
      setDeleting(null);
      refreshCatalog();
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(apiError(err, "No se pudo borrar la función."));
    },
  });

  return (
    <div>
      <div className="mb-5 flex gap-2.5 rounded-xl border border-secondary-container/60 bg-secondary-container/10 px-3.5 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" aria-hidden="true" />
        <div className="text-[12.5px] leading-relaxed text-on-surface">
          <p className="font-bold">{CUSTOM_NOTICE}</p>
          <p className="mt-0.5">
            Un beneficio extra aparece en la página de planes y en "Tu plan incluye" de cada tienda, pero no cambia nada en su panel. Úsalo para lo que cumple tu equipo a mano.
          </p>
        </div>
      </div>

      <section className="mb-6">
        <h3 className="mb-2 text-[14px] font-bold text-on-surface">Funciones personalizadas</h3>
        {active.length === 0 && !creating && <p className="mb-3 text-[12.5px] text-on-surface-variant">Todavía no hay funciones personalizadas. Crea la primera.</p>}
        <ul className="grid gap-2">
          {active.map((f) => (
            <li key={f.key} className={`rounded-xl border p-3 ${form.custom[f.key] ? "border-tertiary-accent/40 bg-tertiary-accent/[0.03]" : "border-outline-variant"}`}>
              <div className="flex items-start gap-2">
                <label className="flex min-h-11 flex-1 cursor-pointer items-start gap-2.5">
                  <input type="checkbox" checked={!!form.custom[f.key]} onChange={(e) => toggle(f.key, e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-tertiary-accent" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-on-surface">{f.label}</span>
                    {f.publicLabel && f.publicLabel !== f.label && <span className="block text-[12px] text-on-surface-variant">En la página de planes: "{f.publicLabel}"</span>}
                    {f.description && <span className="block text-[12px] text-on-surface-variant">{f.description}</span>}
                    <span className="mt-0.5 block text-[11.5px] text-on-surface-variant">Grupo: {f.group}</span>
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setDeleting(f)}
                  aria-label={`Borrar la función ${f.label}`}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-error hover:bg-error/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                disabled={setActive.isPending}
                onClick={() => setActive.mutate({ key: f.key, isActive: false })}
                className="ml-7 min-h-11 rounded-lg px-1 text-[12.5px] font-semibold text-tertiary-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
              >
                Dejar de mostrarla en todos los planes
              </button>
            </li>
          ))}
        </ul>
        {paused.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1.5 text-[12.5px] font-bold text-on-surface-variant">Pausadas (no se muestran en ningún plan)</h4>
            <ul className="grid gap-1.5">
              {paused.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-1.5 text-[13px] text-on-surface">
                  {f.label}
                  <button
                    type="button"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ key: f.key, isActive: true })}
                    className="min-h-11 rounded-lg px-2 text-[12.5px] font-bold text-tertiary-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent"
                  >
                    Volver a mostrar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          {creating ? (
            <NewCustomFeatureForm
              groups={groups}
              catalog={catalog}
              onCancel={() => setCreating(false)}
              onCreated={(feature) => {
                setCreating(false);
                if (feature?.key) toggle(feature.key, true);
                refreshCatalog();
              }}
            />
          ) : (
            <DialogButton variant="outline" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Crear función personalizada
            </DialogButton>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-[14px] font-bold text-on-surface">Líneas de texto libre de este plan</h3>
        <p className="mb-2 mt-0.5 text-[12.5px] text-on-surface-variant">
          Solo para este plan. Las líneas con números o que repiten algo de la lista de funciones no se muestran, para que nunca contradigan un límite real.
        </p>
        <FeatureChipList items={form.features} error={errors.lines} onChange={(features) => setForm((f) => ({ ...f, features }))} />
      </section>

      <section aria-labelledby="plan-includes-preview" className="rounded-xl bg-primary px-4 py-4 text-on-primary">
        <h3 id="plan-includes-preview" className="text-[14px] font-bold">
          Vista previa de "Tu plan incluye"
        </h3>
        <p className="mt-0.5 text-[12px] text-on-primary/80">Así lo ve la tienda con los cambios sin guardar de todas las pestañas.</p>
        <ul className="mt-3 grid gap-1.5 text-[13px]">
          {[...preview.lines, ...preview.extras].map((line, i) => (
            <li key={`${line}-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-secondary-container" />
              {line}
            </li>
          ))}
        </ul>
        {preview.hiddenExtras.length > 0 && (
          <p className="mt-3 text-[12px] text-on-primary/80">No se muestran por tener números o repetir una función: {preview.hiddenExtras.map((l) => `"${l}"`).join(", ")}.</p>
        )}
      </section>

      <PlanDialog
        open={!!deleting}
        title={`¿Borrar "${deleting?.label ?? ""}"?`}
        description="Se quita del catálogo y de todos los planes que la tengan marcada. Si solo quieres que deje de verse por un tiempo, usa Dejar de mostrarla."
        busy={remove.isPending}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <DialogButton variant="outline" data-autofocus onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancelar
            </DialogButton>
            <DialogButton variant="danger" onClick={() => remove.mutate(deleting.key)} disabled={remove.isPending}>
              {remove.isPending ? "Borrando..." : "Sí, borrar"}
            </DialogButton>
          </>
        }
      />
    </div>
  );
}
