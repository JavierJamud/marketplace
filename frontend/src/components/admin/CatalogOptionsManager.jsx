import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Wallet, ShoppingBag, Store, Pencil, Trash2, Plus, Star, AlertCircle } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { iconFor } from "../../lib/catalog.js";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";

// Admin > Marca > Tiendas y productos: monedas y formas de pago editables (backend/src/lib/catalog.js).
// Lo guardado en productos, tiendas y pedidos es el código, que no cambia; aquí se cambia el nombre y se ve al instante en
// todo el sitio. Lo que está en uso no se elimina: se renombra o se desactiva (deja de ofrecerse para lo nuevo).

const SECTIONS = [
  {
    kind: "CURRENCY",
    icon: Coins,
    title: "Monedas",
    intro: "Las que pueden elegir las tiendas para sus precios y envíos. El nombre corto es el que se ve junto al precio.",
    noun: "moneda",
    labelField: "Nombre corto (junto al precio)",
    descriptionField: "Nombre completo",
    descriptionPlaceholder: "Dólar canadiense",
  },
  {
    kind: "PRODUCT_PAYMENT",
    icon: ShoppingBag,
    title: "Formas de pago del producto",
    intro: "La universal va en todos los productos y es la única del plan Regular. Puedes elegir cuál es.",
    noun: "forma de pago",
    labelField: "Nombre",
    descriptionField: "Explicación (opcional)",
    descriptionPlaceholder: "Se acuerda el pago con el vendedor",
  },
  {
    kind: "CHECKOUT_PAYMENT",
    icon: Wallet,
    title: "Formas de cobro al finalizar la compra",
    intro: "Las que ve el cliente al terminar su pedido. Cada tienda marca cuáles ofrece. Tiene que quedar al menos una activa.",
    noun: "forma de cobro",
    labelField: "Nombre",
    descriptionField: "Explicación para el cliente",
    descriptionPlaceholder: "Coordinas el pago por WhatsApp",
  },
  {
    kind: "STORE_PAYMENT",
    icon: Store,
    title: "Métodos que aceptan las tiendas",
    intro: "Zelle, Visa, Tropipay y otros. Cada tienda marca los suyos y se muestran en su página. También pueden escribir uno propio.",
    noun: "método",
    labelField: "Nombre",
    descriptionField: null,
  },
];

const plural = (n, one, many) => `${n.toLocaleString("es-CU")} ${n === 1 ? one : many}`;

function usageText(kind, usage) {
  if (!usage) return "";
  const parts = [];
  if (usage.products) parts.push(plural(usage.products, "producto", "productos"));
  if (usage.stores) parts.push(plural(usage.stores, "tienda", "tiendas"));
  if (usage.orders) parts.push(kind === "CURRENCY" ? plural(usage.orders, "artículo vendido", "artículos vendidos") : plural(usage.orders, "pedido", "pedidos"));
  if (usage.listings) parts.push(plural(usage.listings, "venta rápida", "ventas rápidas"));
  if (usage.discountCodes) parts.push(plural(usage.discountCodes, "código de descuento", "códigos de descuento"));
  if (usage.posSales) parts.push(plural(usage.posSales, "movimiento de caja", "movimientos de caja"));
  return parts.join(" · ");
}

function errorText(err) {
  if (err?.actionCodeCancelled) return null;
  return err?.response?.data?.error ?? "No se pudo guardar. Intenta de nuevo.";
}

function IconPicker({ icons, value, onChange }) {
  return (
    <div>
      <span className="mb-1 block text-label-md text-on-surface-variant">Ícono</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ícono">
        {icons.map((key) => {
          const Icon = iconFor(key);
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={key}
              onClick={() => onChange(key)}
              className={`flex h-11 w-11 items-center justify-center rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent ${
                active ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Formulario para crear (sin `option`) o editar una opción.
function OptionForm({ section, option, icons, pending, onSave, onCancel }) {
  const isCurrency = section.kind === "CURRENCY";
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(option?.label ?? "");
  const [description, setDescription] = useState(option?.description ?? "");
  const [icon, setIcon] = useState(option?.icon ?? null);

  function submit(e) {
    e.preventDefault();
    const payload = { label: label.trim(), icon };
    if (section.descriptionField) payload.description = description.trim() || null;
    if (!option && isCurrency) payload.code = code.trim().toUpperCase();
    onSave(payload);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-tertiary-accent/40 bg-tertiary-accent/5 p-3.5">
      {!option && isCurrency && (
        <Input
          label="Código"
          required
          maxLength={12}
          placeholder="CAD"
          value={code}
          onChange={(e) => {
            const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            // El nombre corto arranca igual que el código; se puede cambiar.
            if (label === code) setLabel(next);
            setCode(next);
          }}
        />
      )}
      <Input label={section.labelField} required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
      {section.descriptionField && (
        <Input
          label={section.descriptionField}
          required={isCurrency && !option}
          maxLength={160}
          placeholder={section.descriptionPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      )}
      {!isCurrency && <IconPicker icons={icons} value={icon} onChange={setIcon} />}
      {option && (
        <p className="text-[12px] text-outline">
          El código guardado (<span className="font-semibold text-on-surface-variant">{option.code}</span>) no cambia: productos, tiendas y pedidos siguen
          enlazados y muestran el nombre nuevo.
        </p>
      )}
      {!option && isCurrency && <p className="text-[12px] text-outline">El código no se puede cambiar después. El nombre sí.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="dark" disabled={pending || !label.trim() || (!option && isCurrency && !code)}>
          {pending ? <Spinner className="text-white" /> : null}
          {option ? "Guardar cambios" : `Agregar ${section.noun}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function OptionRow({ section, option, icons, onUpdate, onDelete, busyId }) {
  const [editing, setEditing] = useState(false);
  const busy = busyId === option.id;
  const Icon = iconFor(option.icon, section.icon);
  const used = usageText(section.kind, option.usage);

  if (editing) {
    return (
      <li>
        <OptionForm
          section={section}
          option={option}
          icons={icons}
          pending={busy}
          onCancel={() => setEditing(false)}
          onSave={(payload) => onUpdate(option, payload, () => setEditing(false))}
        />
      </li>
    );
  }

  return (
    <li className={`rounded-xl border p-3 ${option.isActive ? "border-surface-container-high" : "border-dashed border-outline-variant bg-surface-container-low"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${option.isActive ? "bg-tertiary-accent/10 text-tertiary-accent" : "bg-surface-container text-outline"}`}>
          {section.kind === "CURRENCY" ? <span className="text-[11px] font-bold">{option.label.slice(0, 4)}</span> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold text-on-surface">{option.label}</span>
            {option.isUniversal && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-bold text-on-secondary-container">
                <Star className="h-3 w-3" /> Universal
              </span>
            )}
            {!option.isActive && <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">Desactivada</span>}
          </div>
          {option.description && <p className="text-[12.5px] text-on-surface-variant">{option.description}</p>}
          <p className="mt-0.5 text-[12px] text-outline">
            Código {option.code} · {used ? <span className="font-semibold text-on-surface-variant">En uso: {used}</span> : "Sin uso todavía"}
          </p>
          {/* Por qué no se puede eliminar: así el admin sabe qué sí puede hacer. */}
          {(option.isUniversal || option.inUse) && (
            <p className="mt-1 flex items-start gap-1 text-[12px] text-outline">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {option.isUniversal ? "Es la universal: elige otra como universal para poder desactivarla o eliminarla." : "En uso, no se puede eliminar. Puedes renombrarla o desactivarla."}
            </p>
          )}
        </div>
        <ToggleSwitch
          isActive={option.isActive}
          disabled={busy || option.isUniversal}
          label={option.isActive ? `Desactivar ${option.label}` : `Activar ${option.label}`}
          onToggle={() => onUpdate(option, { isActive: !option.isActive })}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-12">
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setEditing(true)} disabled={busy}>
          <Pencil className="h-3.5 w-3.5" /> Editar
        </Button>
        {section.kind === "PRODUCT_PAYMENT" && !option.isUniversal && (
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onUpdate(option, { isUniversal: true })} disabled={busy}>
            <Star className="h-3.5 w-3.5" /> Hacer universal
          </Button>
        )}
        {!option.inUse && !option.isUniversal && (
          <button
            type="button"
            onClick={() => onDelete(option)}
            disabled={busy}
            aria-label={`Eliminar ${option.label}`}
            title="Eliminar"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-error hover:bg-error/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {busy && <Spinner className="self-center text-tertiary-accent" />}
      </div>
    </li>
  );
}

function Section({ section, options, icons, onCreate, onUpdate, onDelete, busyId, creatingKind, setCreatingKind }) {
  const SectionIcon = section.icon;
  const adding = creatingKind === section.kind;
  return (
    <div className="mt-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-sm sm:p-6">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <SectionIcon className="h-4 w-4 text-tertiary-accent" /> {section.title}
      </div>
      <p className="mb-4 text-[12.5px] text-outline">{section.intro}</p>
      {options.length === 0 ? (
        <p className="mb-3 rounded-xl bg-surface-container-low p-3 text-[12.5px] text-on-surface-variant">Todavía no hay ninguna. Agrega la primera.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {options.map((o) => (
            <OptionRow key={o.id} section={section} option={o} icons={icons} onUpdate={onUpdate} onDelete={onDelete} busyId={busyId} />
          ))}
        </ul>
      )}
      {adding ? (
        <OptionForm
          section={section}
          icons={icons}
          pending={busyId === `new-${section.kind}`}
          onCancel={() => setCreatingKind(null)}
          onSave={(payload) => onCreate(section.kind, payload)}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setCreatingKind(section.kind)}>
          <Plus className="h-4 w-4" /> Agregar {section.noun}
        </Button>
      )}
    </div>
  );
}

export function CatalogOptionsManager() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const [creatingKind, setCreatingKind] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-catalog"],
    queryFn: async () => (await api.get("/admin/catalog")).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-catalog"] });
    queryClient.invalidateQueries({ queryKey: ["site-settings"] });
  };

  const create = useMutation({
    mutationFn: async ({ kind, payload }) => (await api.post("/admin/catalog", { kind, ...payload })).data,
    onMutate: ({ kind }) => setBusyId(`new-${kind}`),
    onSuccess: (res) => {
      toast.success(`Se agregó "${res.option.label}".`);
      setCreatingKind(null);
      refresh();
    },
    onError: (err) => {
      const msg = errorText(err);
      if (msg) toast.error(msg);
    },
    onSettled: () => setBusyId(null),
  });

  const update = useMutation({
    mutationFn: async ({ option, payload }) => (await api.patch(`/admin/catalog/${option.id}`, payload)).data,
    onMutate: ({ option }) => setBusyId(option.id),
    onSuccess: (res, { payload, done }) => {
      const o = res.option;
      toast.success(
        payload.isUniversal ? `"${o.label}" es ahora la forma de pago universal.` : payload.isActive === false ? `Se desactivó "${o.label}". Lo que ya la usa sigue igual.` : payload.isActive ? `Se activó "${o.label}".` : "Cambios guardados. Ya se ven en todo el sitio."
      );
      done?.();
      refresh();
    },
    onError: (err) => {
      const msg = errorText(err);
      if (msg) toast.error(msg);
    },
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: async (option) => (await api.delete(`/admin/catalog/${option.id}`)).data,
    onSuccess: (_res, option) => {
      toast.success(`Se eliminó "${option.label}".`);
      setToDelete(null);
      refresh();
    },
    onError: (err) => {
      const msg = errorText(err);
      if (msg) toast.error(msg);
      setToDelete(null);
      refresh();
    },
  });

  if (isLoading) {
    return (
      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 text-[13px] text-outline">
        <Spinner className="text-tertiary-accent" /> Cargando monedas y formas de pago...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mt-5 rounded-2xl border border-error/30 bg-error/5 p-6 text-[13px] text-on-surface">
        No se pudieron cargar las monedas y formas de pago.
        <Button type="button" variant="outline" size="sm" className="ml-2 min-h-11" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const icons = data.icons ?? [];
  return (
    <>
      {SECTIONS.map((section) => (
        <Section
          key={section.kind}
          section={section}
          options={data.options.filter((o) => o.kind === section.kind)}
          icons={icons}
          busyId={busyId}
          creatingKind={creatingKind}
          setCreatingKind={setCreatingKind}
          onCreate={(kind, payload) => create.mutate({ kind, payload })}
          onUpdate={(option, payload, done) => update.mutate({ option, payload, done })}
          onDelete={(option) => setToDelete(option)}
        />
      ))}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.label}"?`}
          description="No la usa ningún producto, tienda ni pedido. Deja de aparecer en todo el sitio."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(toDelete)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  );
}
