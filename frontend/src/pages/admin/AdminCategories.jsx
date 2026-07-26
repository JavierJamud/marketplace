import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Icons from "lucide-react";
import toast from "react-hot-toast";
import { Check, X, Pencil, Trash2, Plus, GripVertical } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

// Mismo criterio de validación que el backend (businessCategories.controller.js):
// nombre "canónico" de un export real de lucide-react, sin el alias "*Icon".
function isValidIconName(name) {
  return !!name && !!Icons[name] && !name.endsWith("Icon");
}

function CategoryModal({ category, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);

  const iconValid = isValidIconName(icon);

  const save = useMutation({
    mutationFn: async () =>
      category
        ? (await api.patch(`/admin/business-categories/${category.id}`, { name, icon, sortOrder: Number(sortOrder) })).data
        : (await api.post("/admin/business-categories", { name, icon, sortOrder: Number(sortOrder) })).data,
    onSuccess: () => {
      toast.success(category ? "Categoría actualizada." : "Categoría creada.");
      queryClient.invalidateQueries({ queryKey: ["admin-business-categories"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la categoría."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
                <CategoryIcon name={iconValid ? icon : undefined} className="h-5 w-5 text-on-surface-variant" />
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
    </div>
  );
}

export default function AdminCategories() {
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | {} | category
  const [toDelete, setToDelete] = useState(null);

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
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Categorías de tipo de negocio</h1>
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
          className="flex items-center gap-1.5 rounded-md bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar categoría
        </button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        {categories?.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
            <GripVertical className="h-4 w-4 flex-shrink-0 text-outline/40" />
            <span className="w-8 flex-shrink-0 text-center text-[11.5px] font-bold text-outline">{c.sortOrder}</span>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
              <CategoryIcon name={c.icon} className="h-4 w-4 text-tertiary-accent" />
            </div>
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold text-on-surface">{c.name}</div>
              <div className="text-[11.5px] text-outline">{c._count?.vendors ?? 0} tiendas asignadas</div>
            </div>
            <button
              onClick={() => toggleActive.mutate(c)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container text-outline"}`}
            >
              {c.active ? "Activa" : "Inactiva"}
            </button>
            <button onClick={() => setModalState(c)} className="text-tertiary-accent">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setToDelete(c)} className="text-error">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!isLoading && !categories?.length && <p className="p-4 text-body-md text-on-surface-variant">Todavía no hay categorías cargadas.</p>}
      </div>

      {modalState && <CategoryModal category={modalState.id ? modalState : null} onClose={() => setModalState(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.name}"?`}
          description={
            toDelete._count?.vendors > 0
              ? `Hay ${toDelete._count.vendors} tienda(s) usando esta categoría — no se puede eliminar. Desactivala en su lugar.`
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
