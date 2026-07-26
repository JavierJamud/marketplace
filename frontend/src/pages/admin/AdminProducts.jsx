import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Search, X, Pencil, Trash2, PackageSearch, Ruler } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const CURRENCIES = ["CUP", "USD", "EUR"];

// Bloque 52 (pedido explícito): "todo lo que agrega el vendedor debe tener
// supervisión y conexión visual o de edición para el administrador en todo
// momento" — antes no existía ninguna pantalla para ver/editar productos
// individuales de cualquier tienda, solo estadísticas agregadas por vendedor.
function ProductEditModal({ product, categories, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: product.name,
    description: product.description ?? "",
    categoryId: product.categoryId ?? "",
    price: String(product.price),
    oldPrice: product.oldPrice ? String(product.oldPrice) : "",
    currency: product.currency ?? "CUP",
    stock: String(product.stock),
    badge: product.badge ?? "",
    isActive: product.isActive,
    isFeatured: product.isFeatured,
  });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/admin/products/${product.id}`, {
          name: form.name,
          description: form.description || null,
          categoryId: form.categoryId || undefined,
          price: Number(form.price),
          oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
          currency: form.currency,
          stock: Number(form.stock),
          badge: form.badge || null,
          isActive: form.isActive,
          isFeatured: form.isFeatured,
        })
      ).data,
    onSuccess: () => {
      toast.success("Producto actualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-title-lg text-on-surface">Editar producto</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-outline hover:bg-surface-variant">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Tienda: <span className="font-semibold text-on-surface">{product.vendor?.companyName}</span>
          {product.sizes?.length > 0 && (
            <span className="ml-2 rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[11px] font-bold text-tertiary-accent">
              {product.sizes.length} tallas — stock por talla se edita desde el panel del vendedor
            </span>
          )}
        </p>

        <div className="flex flex-col gap-3.5">
          <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Descripción</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="min-h-[70px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none"
            />
          </div>
          <Select label="Categoría" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sin categoría</option>
            {categories?.map((c) =>
              c.children?.length ? (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} (general)</option>
                  {c.children.map((child) => (
                    <option key={child.id} value={child.id}>{child.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={c.id} value={c.id}>{c.name}</option>
              )
            )}
          </Select>
          <div className="grid grid-cols-[1fr_1fr_88px] gap-3">
            <Input label="Precio" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input label="Precio anterior" type="number" min={0} value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value })} />
            <Select label="Moneda" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          {!(product.sizes?.length > 0) && (
            <Input label="Stock" type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          )}
          <Input label="Badge" placeholder="Nuevo, -20%, Bestseller..." value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} />

          <label className="flex items-center gap-2 text-body-md text-on-surface">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Activo (visible en la tienda)
          </label>
          <label className="flex items-center gap-2 text-body-md text-on-surface">
            <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
            Destacado en el Home
          </label>
        </div>

        <div className="mt-5 flex gap-2.5">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminProducts() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const searchTimer = useRef(null);

  // Debounce simple — evita una request por tecla en la búsqueda.
  function handleSearchChange(value) {
    setQ(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(value.trim()), 300);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products", debouncedQ],
    queryFn: async () => (await api.get("/admin/products", { params: debouncedQ ? { q: debouncedQ } : {} })).data.products,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get("/categories")).data.categories,
  });

  const toggleActive = useMutation({
    mutationFn: async (p) => (await api.patch(`/admin/products/${p.id}`, { isActive: !p.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-products"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      toast.success("Producto eliminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  return (
    <div className="max-w-[1080px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Productos</h1>
      <p className="mb-[18px] text-[13.5px] text-outline">
        Supervisión de todo lo que cargan los vendedores — busca, edita precio/moneda/categoría/estado, o elimina un producto
        de cualquier tienda.
      </p>

      <div className="relative mb-[18px] max-w-[420px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
        <input
          value={q}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Buscar producto por nombre..."
          className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        {data?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
            <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-md bg-surface-container">
              {p.images?.[0] ? <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-on-surface">
                {p.name}
                {p.sizes?.length > 0 && (
                  <span title={`Tallas: ${p.sizes.join(", ")}`} className="flex items-center gap-0.5 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent">
                    <Ruler className="h-2.5 w-2.5" /> {p.sizes.length}
                  </span>
                )}
              </div>
              <div className="truncate text-[11.5px] text-outline">
                {p.vendor?.companyName} · {p.category?.name ?? "Sin categoría"} · {formatPrice(p.price, p.currency)} · {p.stock} u.
              </div>
            </div>
            <button
              onClick={() => toggleActive.mutate(p)}
              className="rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={p.isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "rgba(117,119,124,0.12)", color: "#75777c" }}
            >
              {p.isActive ? "Activo" : "Pausado"}
            </button>
            <button onClick={() => setEditTarget(p)} className="text-tertiary-accent">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => setDeleteTarget(p)} className="text-error">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!isLoading && !data?.length && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <PackageSearch className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">{debouncedQ ? "Sin resultados." : "Todavía no hay productos cargados."}</p>
          </div>
        )}
      </div>

      {editTarget && <ProductEditModal product={editTarget} categories={categories} onClose={() => setEditTarget(null)} />}
      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${deleteTarget.name}"?`}
          description="Se quita de la tienda del vendedor de inmediato."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
