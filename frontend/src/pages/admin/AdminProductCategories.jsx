import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { SearchBox, matchesQuery } from "../../components/ui/SearchBox.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Categorías de producto (las que elige el vendedor al publicar). Dos niveles: categoría y subcategorías.
// Las que crearon los vendedores aparecen marcadas "Nueva" hasta que el admin las edita o las acepta al renombrarlas.
function CategoryForm({ category, parents, onClose }) {
  const queryClient = useQueryClient();
  const editing = !!category?.id;
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const canMove = !editing || !category.childCount;

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), parentId: parentId || null };
      return editing ? (await api.patch(`/admin/product-categories/${category.id}`, body)).data : (await api.post("/admin/product-categories", body)).data;
    },
    onSuccess: () => {
      toast.success(editing ? "Categoría actualizada." : "Categoría creada.");
      queryClient.invalidateQueries({ queryKey: ["admin-product-categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la categoría."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-inverse-surface/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-t-2xl bg-surface-container-lowest p-5 sm:rounded-2xl"
      >
        <h2 className="font-display text-[18px] font-extrabold text-on-surface">{editing ? "Editar categoría" : "Agregar categoría"}</h2>
        <Input label="Nombre" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Categoría principal" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!canMove}>
          <option value="">Ninguna (categoría principal)</option>
          {parents
            .filter((p) => p.id !== category?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        {!canMove && <p className="-mt-2 text-[12px] text-outline">Tiene subcategorías, por eso no puede pasar a ser subcategoría de otra.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// `embedded`: dentro de la sección Categorías (AdminAllCategories.jsx), sin su propio encabezado.
export default function AdminProductCategories({ embedded = false } = {}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [form, setForm] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ["admin-product-categories"],
    queryFn: async () => (await api.get("/admin/product-categories")).data.categories,
  });

  const tree = useMemo(() => {
    const parents = (rows ?? []).filter((r) => !r.parentId);
    return parents.map((p) => ({ ...p, children: (rows ?? []).filter((r) => r.parentId === p.id) }));
  }, [rows]);

  const searching = search.trim().length > 0;
  const visible = useMemo(
    () =>
      tree
        .map((p) => {
          const parentHit = matchesQuery(p.name, search);
          const children = p.children.filter((c) => !searching || parentHit || matchesQuery(c.name, search));
          return { ...p, shownChildren: children, hit: !searching || parentHit || children.length > 0 };
        })
        .filter((p) => p.hit),
    [tree, search, searching]
  );
  const pendingReview = (rows ?? []).filter((r) => r.isUserCreated).length;

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/product-categories/${id}`),
    onSuccess: () => {
      toast.success("Categoría eliminada.");
      queryClient.invalidateQueries({ queryKey: ["admin-product-categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setToDelete(null);
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo eliminar la categoría.");
      setToDelete(null);
    },
  });

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  function Row({ c, child }) {
    return (
      <div className={`flex items-center gap-2 border-b border-surface-container px-3 py-2.5 last:border-b-0 ${child ? "pl-10 sm:pl-12" : ""}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`truncate text-[13.5px] ${child ? "text-on-surface" : "font-semibold text-on-surface"}`}>{c.name}</span>
            {c.isUserCreated && <span className="rounded-full bg-secondary-container/60 px-2 py-0.5 text-[10.5px] font-bold text-on-secondary-container">Nueva de un vendedor</span>}
          </div>
          <div className="text-[11.5px] text-outline">
            {c.productCount} producto{c.productCount === 1 ? "" : "s"}
            {!child && ` · ${c.childCount} subcategoría${c.childCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <button type="button" onClick={() => setForm(c)} aria-label={`Editar ${c.name}`} className="flex h-11 w-11 items-center justify-center rounded text-tertiary-accent hover:bg-surface-container">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setToDelete(c)} aria-label={`Eliminar ${c.name}`} className="flex h-11 w-11 items-center justify-center rounded text-error hover:bg-surface-container">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[820px]">
      {!embedded && (
        <div className="mb-1 flex items-center gap-3">
          <IconCircle icon={Boxes} tone="teal" />
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Categorías de producto</h1>
        </div>
      )}
      <p className="mb-4 text-[13.5px] text-outline">
        Las que elige cada vendedor al publicar un producto. Si no encuentra la suya, puede crear una nueva y aparece aquí marcada para que la revises.
        {pendingReview > 0 && <strong className="text-on-surface"> Hay {pendingReview} creada{pendingReview === 1 ? "" : "s"} por vendedores.</strong>}
      </p>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <SearchBox className="flex-1" value={search} onChange={setSearch} placeholder="Buscar categoría o subcategoría" />
        <button type="button" onClick={() => setForm({})} className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-secondary-container px-4 text-[13px] font-bold text-on-secondary-container">
          <Plus className="h-4 w-4" /> Agregar categoría
        </button>
      </div>

      {isLoading && <ListSkeleton />}
      {isError && <p className="text-body-md text-error">No se pudieron cargar las categorías.</p>}

      <div className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest">
        {visible.map((p) => {
          const expanded = searching || open.has(p.id);
          return (
            <div key={p.id} className="border-b border-surface-container last:border-b-0">
              <div className="flex items-center">
                <button type="button" onClick={() => toggle(p.id)} aria-expanded={expanded} aria-label={`${expanded ? "Contraer" : "Expandir"} ${p.name}`} className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-outline">
                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <Row c={p} />
                </div>
              </div>
              {expanded && p.shownChildren.map((c) => <Row key={c.id} c={c} child />)}
            </div>
          );
        })}
        {!isLoading && !visible.length && <p className="p-4 text-body-md text-on-surface-variant">{searching ? `No hay categorías que coincidan con “${search.trim()}”.` : "Todavía no hay categorías."}</p>}
      </div>

      {form && <CategoryForm category={form.id ? form : null} parents={tree} onClose={() => setForm(null)} />}
      {toDelete && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${toDelete.name}"?`}
          description={
            toDelete.productCount > 0
              ? `Tiene ${toDelete.productCount} producto(s): no se puede eliminar hasta moverlos a otra categoría.`
              : toDelete.childCount > 0
                ? "Tiene subcategorías: elimínalas o muévelas primero."
                : "Esta categoría no tiene productos."
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
