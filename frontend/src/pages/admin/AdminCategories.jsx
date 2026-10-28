import { SearchBox, matchesQuery } from "../../components/ui/SearchBox.jsx";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Icons from "lucide-react";
import toast from "../../lib/toast.jsx";
import { Check, X, Pencil, Trash2, Plus, GripVertical, Tags, ChevronDown } from "lucide-react";
import { VendorAvatar } from "../../components/ui/VendorAvatar.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Bloque 112 (bug real reportado en vivo, con captura): "users" (el nombre
// tal cual aparece en la URL de lucide.dev/icons/users) se rechazaba como
// "no existe" porque el export real de lucide-react es "Users" (PascalCase).
// Mismo resolver tolerante que el backend (businessCategories.controller.js)
// — si el nombre exacto no matchea, arma la versión PascalCase esperada
// antes de darlo por inválido. Se guarda siempre el nombre CANÓNICO
// resuelto, nunca lo que escribió el admin tal cual.
function toPascalCase(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function resolveIconName(name) {
  if (!name) return null;
  const exact = name.trim();
  if (Icons[exact] && !exact.endsWith("Icon")) return exact;
  const pascal = toPascalCase(exact);
  if (Icons[pascal] && !pascal.endsWith("Icon")) return pascal;
  return null;
}

function CategoryModal({ category, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);

  const resolvedIcon = resolveIconName(icon);
  const iconValid = !!resolvedIcon;

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx).
  const initialCategorySnapshot = useRef(JSON.stringify({ name, icon, sortOrder }));
  const isDirty = JSON.stringify({ name, icon, sortOrder }) !== initialCategorySnapshot.current;

  const save = useMutation({
    mutationFn: async () =>
      category
        ? (await api.patch(`/admin/business-categories/${category.id}`, { name, icon: resolvedIcon, sortOrder: Number(sortOrder) })).data
        : (await api.post("/admin/business-categories", { name, icon: resolvedIcon, sortOrder: Number(sortOrder) })).data,
    onSuccess: () => {
      toast.success(category ? "Categoría actualizada." : "Categoría creada.");
      queryClient.invalidateQueries({ queryKey: ["admin-business-categories"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la categoría."),
  });

  // Bloque 196: misma condición que ya deshabilita "Guardar" más abajo (sin
  // save.isPending).
  const canSaveNow = !!name.trim() && iconValid;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: canSaveNow ? () => save.mutateAsync() : undefined,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">{category ? "Editar categoría" : "Agregar categoría"}</h2>

        <div className="mb-3.5 flex flex-col gap-3.5">
          <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurante" />

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Ícono (nombre exacto de lucide-react)</span>
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded border ${
                  icon ? (iconValid ? "border-verified bg-verified/10" : "border-error bg-error/10") : "border-outline-variant"
                }`}
              >
                <CategoryIcon name={resolvedIcon ?? undefined} className="h-5 w-5 text-on-surface-variant" />
              </div>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value.trim())}
                placeholder="UtensilsCrossed"
                className="h-11 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3.5 font-mono text-[13px] outline-none"
              />
              {icon && (iconValid ? <Check className="h-4 w-4 flex-shrink-0 text-verified" /> : <X className="h-4 w-4 flex-shrink-0 text-error" />)}
            </div>
            <p className="mt-1 text-[11px] text-outline">
              Busca el nombre exacto en{" "}
              <span className="font-mono">lucide.dev/icons</span> (ej. "ShoppingBag", "Utensils", "Scissors").
            </p>
            {icon && !iconValid && <p className="mt-1 text-[11px] font-semibold text-error">Ese nombre no existe en lucide-react.</p>}
          </div>

          <Input
            label="Orden (menor = aparece primero)"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={!name.trim() || !iconValid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

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

// Tiendas de un rubro, con enlace para gestionarlas y en qué categorías de producto venden de verdad. Sirve para ver cuándo
// el rubro ya no describe a la tienda (por ejemplo, "Electrodomésticos" con casi todo en Ropa) y cambiárselo desde Editar.
function CategoryVendors({ category }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-business-category-vendors", category.id],
    queryFn: async () => (await api.get(`/admin/business-categories/${category.id}/vendors`)).data.vendors,
  });
  const link = "inline-flex min-h-11 items-center rounded-lg px-3 text-[12.5px] font-semibold md:min-h-9";
  return (
    <div className="border-b border-surface-container bg-surface-container/40 px-4 py-3">
      {isLoading && <p className="text-[12.5px] text-on-surface-variant">Cargando tiendas...</p>}
      {isError && (
        <p className="text-[12.5px] text-error">
          No se pudieron cargar las tiendas.{" "}
          <button type="button" onClick={() => refetch()} className="font-bold underline">Reintentar</button>
        </p>
      )}
      {data?.length === 0 && <p className="text-[12.5px] text-on-surface-variant">Ninguna tienda tiene este rubro.</p>}
      {data?.length > 0 && (
        <ul className="divide-y divide-surface-container-high">
          {data.map((v) => (
            <li key={v.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <VendorAvatar vendor={v} className="h-9 w-9 flex-shrink-0 rounded-full text-sm" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
                    <span className="truncate">{v.companyName}</span>
                    {v.verificationStatus === "VERIFIED" && <VerifiedBadge size="sm" />}
                    {v.isBlocked && <span className="rounded-full bg-error/10 px-2 py-0.5 text-[10.5px] font-bold text-error">Bloqueada</span>}
                  </p>
                  <p className="text-[12px] text-on-surface-variant">
                    {v.activeProducts === 0
                      ? "Sin productos activos"
                      : `Vende: ${v.sells.map((s) => `${s.name} (${s.count})`).join(", ")}${v.moreCategories ? ` y ${v.moreCategories} más` : ""}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-1.5 pl-12 sm:pl-0">
                <Link to={`/admin/tiendas/${v.id}?tab=productos`} className={`${link} border border-outline-variant text-on-surface hover:bg-surface-container`}>Productos</Link>
                <Link to={`/admin/tiendas/${v.id}`} className={`${link} bg-surface-container text-on-surface hover:bg-surface-container-high`}>Gestionar</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// `embedded`: dentro de la sección Categorías (AdminAllCategories.jsx), sin su propio encabezado.
export default function AdminCategories({ embedded = false } = {}) {
  const [openId, setOpenId] = useState(null);
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | {} | category
  const [toDelete, setToDelete] = useState(null);

  const [search, setSearch] = useState("");
  const { data: categories, isLoading } = useQuery({
    queryKey: ["admin-business-categories"],
    queryFn: async () => (await api.get("/admin/business-categories")).data.categories,
  });

  const toggleActive = useMutation({
    mutationFn: async (c) => (await api.patch(`/admin/business-categories/${c.id}`, { active: !c.active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-business-categories"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/business-categories/${id}`),
    onSuccess: () => {
      toast.success("Categoría eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-business-categories"] });
      setToDelete(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la categoría.");
      setToDelete(null);
    },
  });

  return (
    <div className="max-w-[820px]">
      {!embedded && (
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={Tags} tone="teal" />
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Categorías de tipo de negocio</h1>
        </div>
      )}
      <p className="mb-2 text-[13.5px] text-outline">
        Rubro que elige cada tienda al registrarse (restaurante, belleza, ferretería...). Se muestran en el Home y como
        filtro de búsqueda de Tiendas.
      </p>
      <div className="mb-[22px] rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        💡 Desactivar una categoría la saca del Home/filtro/alta de tienda, pero no le cambia el rubro a las tiendas que
        ya la tenían asignada.
      </div>

      <div className="mb-[18px] flex justify-end">
        <button
          onClick={() => setModalState({})}
          className="flex items-center gap-1.5 rounded-full bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar categoría
        </button>
      </div>

      {categories && categories.length > 6 && (
        <SearchBox
          className="mb-3"
          value={search}
          onChange={setSearch}
          placeholder="Buscar categoría por nombre"
          resultText={search.trim() ? `${(categories ?? []).filter((c) => matchesQuery(c.name, search)).length} de ${categories.length} categorías` : undefined}
        />
      )}

      {isLoading && <ListSkeleton />}

      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        {categories?.filter((c) => matchesQuery(c.name, search)).map((c) => {
          const count = c._count?.vendors ?? 0;
          const open = openId === c.id;
          return (
            <div key={c.id} className="border-b border-surface-container last:border-b-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <GripVertical className="hidden h-4 w-4 flex-shrink-0 text-outline/40 sm:block" />
                <span className="hidden w-8 flex-shrink-0 text-center text-[11.5px] font-bold text-outline sm:block">{c.sortOrder}</span>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
                  <CategoryIcon name={c.icon} className="h-4 w-4 text-tertiary-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-on-surface">{c.name}</div>
                  {count > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : c.id)}
                      aria-expanded={open}
                      aria-label={`${open ? "Ocultar" : "Ver"} ${count === 1 ? "la tienda asignada" : `las ${count} tiendas asignadas`} a ${c.name}`}
                      className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-tertiary-accent hover:underline"
                    >
                      {count === 1 ? "1 tienda" : `${count} tiendas`}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                  ) : (
                    <div className="text-[11.5px] text-outline">Ninguna tienda asignada</div>
                  )}
                </div>
                <button
                  onClick={() => toggleActive.mutate(c)}
                  aria-label={c.active ? `Desactivar ${c.name}` : `Activar ${c.name}`}
                  className={`min-h-9 rounded-full px-2.5 text-[11px] font-bold ${c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container text-outline"}`}
                >
                  {c.active ? "Activa" : "Inactiva"}
                </button>
                <button onClick={() => setModalState(c)} aria-label={`Editar ${c.name}`} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-tertiary-accent hover:bg-surface-container">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button onClick={() => setToDelete(c)} aria-label={`Eliminar ${c.name}`} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-error hover:bg-error/5">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {open && <CategoryVendors category={c} />}
            </div>
          );
        })}
        {!isLoading && !categories?.length && <p className="p-4 text-body-md text-on-surface-variant">Todavía no hay categorías cargadas.</p>}
        {!isLoading && !!categories?.length && !categories.some((c) => matchesQuery(c.name, search)) && <p className="p-4 text-body-md text-on-surface-variant">No hay categorías que coincidan con “{search.trim()}”.</p>}
      </div>

      {modalState && <CategoryModal category={modalState.id ? modalState : null} onClose={() => setModalState(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.name}"?`}
          description={
            toDelete._count?.vendors > 0
              ? `Hay ${toDelete._count.vendors} tienda(s) usando esta categoría, así que no se puede eliminar. Desactívala en su lugar.`
              : "Esta categoría no tiene tiendas asignadas."
          }
          confirmLabel="Eliminar"
          pending={remove.isPending}
          onConfirm={() => remove.mutate(toDelete.id)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
