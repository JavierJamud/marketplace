import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Trash2, ScanBarcode, X, ImagePlus, ArrowUpDown } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  return `${api.defaults.baseURL}${path}`;
}

const MAX_TAGS = 5;

// Bloque 23: mismo umbral que LOW_STOCK_THRESHOLD en
// vendors.controller.js (getDashboard) — si cambia uno, cambiar el otro.
const LOW_STOCK_THRESHOLD = 3;

const STATUS_STYLE = {
  active: { background: "rgba(12,174,83,0.12)", color: "#0A8F42" },
  low: { background: "rgba(138,81,0,0.12)", color: "#8a5100" },
  out: { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  paused: { background: "rgba(117,119,124,0.12)", color: "#75777c" },
};
const STATUS_LABEL = { active: "Activo", low: "Stock bajo", out: "Sin stock", paused: "Pausado" };
const ROW_TINT = { out: "bg-[#ba1a1a]/[0.03]", low: "bg-[#8a5100]/[0.04]", active: "", paused: "" };

function stockStatus(p) {
  if (!p.isActive) return "paused";
  if (p.stock <= 0) return "out";
  if (p.stock <= LOW_STOCK_THRESHOLD) return "low";
  return "active";
}

const EMPTY_FORM = {
  name: "",
  description: "",
  categoryId: "",
  price: "",
  oldPrice: "",
  stock: "0",
  barcode: "",
  badge: "",
  paymentMethods: ["whatsapp"],
  availableForTableMenu: false,
  tags: [],
};

function ProductModal({ product, prefillBarcode, planType, isRestaurant, categories, onClose }) {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  // savedProduct != null en cuanto el producto existe en la DB (ya sea
  // porque se abrió en modo edición, o porque se acaba de crear) — recién
  // ahí se puede subir fotos, que necesitan un productId real.
  const [savedProduct, setSavedProduct] = useState(product);
  const [form, setForm] = useState(
    product
      ? {
          name: product.name,
          description: product.description ?? "",
          categoryId: product.categoryId ?? "",
          price: String(product.price),
          oldPrice: product.oldPrice ? String(product.oldPrice) : "",
          stock: String(product.stock),
          barcode: product.barcode ?? "",
          badge: product.badge ?? "",
          paymentMethods: product.paymentMethods,
          availableForTableMenu: product.availableForTableMenu ?? false,
          tags: product.tags ?? [],
        }
      : { ...EMPTY_FORM, barcode: prefillBarcode ?? "" }
  );
  const [tagInput, setTagInput] = useState("");

  function addTag() {
    const clean = tagInput.trim().toLowerCase();
    if (!clean) return;
    if (form.tags.length >= MAX_TAGS) {
      toast.error(`Máximo ${MAX_TAGS} tags por producto.`);
      return;
    }
    if (form.tags.includes(clean)) {
      setTagInput("");
      return;
    }
    setForm((f) => ({ ...f, tags: [...f.tags, clean] }));
    setTagInput("");
  }

  function removeTag(tag) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        categoryId: form.categoryId || undefined,
        price: Number(form.price),
        oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
        stock: Number(form.stock),
        barcode: form.barcode || undefined,
        badge: form.badge || null,
        paymentMethods: form.paymentMethods,
        availableForTableMenu: form.availableForTableMenu,
        tags: form.tags,
      };
      if (savedProduct) return (await api.patch(`/products/${savedProduct.id}`, payload)).data;
      return (await api.post("/products", payload)).data;
    },
    onSuccess: (data) => {
      toast.success(savedProduct ? "Producto actualizado." : "Producto creado — ahora podés subirle fotos.");
      setSavedProduct(data.product);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el producto."),
  });

  const uploadImages = useMutation({
    mutationFn: async (files) => {
      const body = new FormData();
      for (const f of files) body.append("images", f);
      return (await api.post(`/products/${savedProduct.id}/images`, body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (data) => {
      setSavedProduct(data.product);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
      toast.success("Fotos subidas.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron subir las fotos."),
  });

  const removeImage = useMutation({
    mutationFn: async (url) => (await api.delete(`/products/${savedProduct.id}/images`, { data: { url } })).data,
    onSuccess: (data) => {
      setSavedProduct(data.product);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la foto."),
  });

  function handleFileChange(e) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) uploadImages.mutate(files);
    e.target.value = "";
  }

  function togglePayment(id) {
    setForm((f) => ({
      ...f,
      paymentMethods: f.paymentMethods.includes(id) ? f.paymentMethods.filter((m) => m !== id) : [...f.paymentMethods, id],
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <h3 className="mb-4 text-title-lg text-on-surface">{savedProduct ? "Editar producto" : "Nuevo producto"}</h3>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3.5">
          <Input label="Nombre" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Descripción</span>
            <AiGenerateButton
              kind="product"
              currentText={form.description}
              productName={form.name}
              onGenerated={(text) => setForm((f) => ({ ...f, description: text }))}
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Escribí unas palabras clave del producto (ej: zapatillas rojas, cuero sintético, talla 38-42) y usá 'Mejorar con IA' arriba."
              className="min-h-[80px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none focus:border-primary-container"
            />
          </div>

          <Select label="Categoría" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sin categoría</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Precio (CUP)" type="number" min={1} required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input label="Precio anterior (opcional)" type="number" min={1} value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Stock" type="number" min={0} required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            <Input label="Código de barras" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
          <Input label="Badge (opcional)" placeholder="Nuevo, -20%, Bestseller..." value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} />

          <div>
            <span className="mb-1 block text-label-md text-on-surface-variant">Tags de búsqueda (opcional, hasta {MAX_TAGS})</span>
            <p className="mb-2 text-label-sm text-outline">
              Palabras sueltas para que el cliente encuentre este producto buscando algo que no está en el nombre ni la descripción.
            </p>
            {form.tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {form.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} aria-label={`Quitar tag ${tag}`} className="text-outline hover:text-error">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {form.tags.length < MAX_TAGS ? (
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Escribí un tag y Enter..."
                  className="h-9 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-primary-container"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[13px] font-bold text-on-surface-variant hover:bg-surface-container"
                >
                  +
                </button>
              </div>
            ) : (
              <p className="text-label-sm text-outline">Llegaste al máximo de {MAX_TAGS} tags.</p>
            )}
          </div>

          {isRestaurant && (
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={form.availableForTableMenu}
                onChange={(e) => setForm({ ...form, availableForTableMenu: e.target.checked })}
              />
              Disponible para pedir en mesa (menú QR)
            </label>
          )}

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Métodos de pago</span>
            {planType === "REGULAR" ? (
              <p className="text-label-sm text-outline">Plan Regular: solo pedidos por WhatsApp.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {[
                  { id: "whatsapp", label: "WhatsApp" },
                  { id: "cod", label: "Contra entrega" },
                  { id: "prepaid", label: "Transferencia CUP" },
                ].map((pm) => (
                  <label key={pm.id} className="flex items-center gap-2 text-body-md text-on-surface">
                    <input type="checkbox" checked={form.paymentMethods.includes(pm.id)} onChange={() => togglePayment(pm.id)} />
                    {pm.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">Fotos del producto</span>
            {savedProduct ? (
              <>
                <div className="mb-2.5 flex flex-wrap gap-2">
                  {savedProduct.images?.map((url) => (
                    <div key={url} className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-surface-container-high">
                      <img src={imgUrl(url)} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage.mutate(url)}
                        disabled={removeImage.isPending}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploadImages.isPending}
                    className="flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-outline-variant text-outline disabled:opacity-50"
                  >
                    <ImagePlus className="h-4 w-4" />
                    <span className="text-[10px] font-semibold">{uploadImages.isPending ? "..." : "Subir"}</span>
                  </button>
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileChange} />
                <p className="text-label-sm text-outline">JPG, PNG o WEBP · hasta 5MB por foto.</p>
              </>
            ) : (
              <p className="text-label-sm text-outline">Guardá el producto primero para poder subirle fotos.</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {savedProduct ? "Cerrar" : "Cancelar"}
            </Button>
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? "Guardando..." : savedProduct ? "Guardar cambios" : "Crear producto"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VendorProducts() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | { mode: "new", barcode? } | { mode: "edit", product }
  const [stockFilter, setStockFilter] = useState("all"); // all | low | out
  const [requestSortDesc, setRequestSortDesc] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["my-products"],
    queryFn: async () => (await api.get("/products/me/list")).data,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get("/categories")).data.categories,
  });

  const deleteProduct = useMutation({
    mutationFn: async (id) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success("Producto eliminado");
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  function handleScanBarcode() {
    const code = window.prompt("Código de barras escaneado:");
    if (code) setModalState({ mode: "new", barcode: code });
  }

  function closeModal() {
    setModalState(null);
    queryClient.invalidateQueries({ queryKey: ["my-products"] });
  }

  const products = data?.products ?? [];
  const atLimit = data?.limit && products.length >= data.limit;

  // Bloque 23: mismo criterio que outOfStockProducts/lowStockProducts en
  // vendors.controller.js (getDashboard) — solo cuenta productos activos,
  // uno pausado no necesita reponerse porque el cliente no lo ve igual.
  const lowStockCount = products.filter((p) => stockStatus(p) === "low").length;
  const outOfStockCount = products.filter((p) => stockStatus(p) === "out").length;

  const filteredProducts =
    stockFilter === "low" ? products.filter((p) => stockStatus(p) === "low")
    : stockFilter === "out" ? products.filter((p) => stockStatus(p) === "out")
    : products;

  // El conteo de solicitudes solo importa (y solo se muestra como columna)
  // mirando la pestaña "Sin stock" — ahí es donde el vendedor decide qué
  // reponer primero.
  const visibleProducts =
    stockFilter === "out"
      ? [...filteredProducts].sort((a, b) => {
          const diff = (a._count?.requests ?? 0) - (b._count?.requests ?? 0);
          return requestSortDesc ? -diff : diff;
        })
      : filteredProducts;

  const gridCols = stockFilter === "out" ? "grid-cols-[2.1fr_0.9fr_0.9fr_1fr_1fr_0.8fr]" : "grid-cols-[2.4fr_1fr_1fr_1fr_0.8fr]";

  const TABS = [
    { id: "all", label: "Todos", count: products.length },
    { id: "low", label: "Stock bajo", count: lowStockCount },
    { id: "out", label: "Sin stock", count: outOfStockCount },
  ];

  return (
    <div>
      <div className="mb-[22px] flex items-center justify-between">
        <div>
          <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Productos</h1>
          <p className="text-[13.5px] text-outline">{products.length} productos publicados</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={handleScanBarcode}
            className="flex items-center gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant"
          >
            <ScanBarcode className="h-4 w-4" /> Escanear código
          </button>
          <button
            onClick={() => (atLimit ? toast.error(`Alcanzaste el límite de ${data.limit} productos del Plan Regular.`) : setModalState({ mode: "new" }))}
            className="rounded-md bg-secondary-container px-[18px] py-2.5 text-[13.5px] font-bold text-on-secondary-container"
          >
            + Nuevo producto
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setStockFilter(t.id)}
            className={`rounded-full px-4 py-2 text-[12.5px] font-bold transition-colors ${
              stockFilter === t.id
                ? "bg-primary-container text-white"
                : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className={`grid ${gridCols} gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline`}>
          <span>Producto</span><span>Precio</span><span>Stock</span><span>Estado</span>
          {stockFilter === "out" && (
            <button
              onClick={() => setRequestSortDesc((d) => !d)}
              className="flex items-center gap-1 text-left normal-case text-tertiary-accent"
              title="Ordenar por más solicitado"
            >
              Solicitudes <ArrowUpDown className="h-3 w-3" />
            </button>
          )}
          <span></span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && products.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Todavía no publicaste productos.</p>}
        {!isLoading && products.length > 0 && visibleProducts.length === 0 && (
          <p className="p-5 text-body-md text-on-surface-variant">Ningún producto coincide con este filtro.</p>
        )}
        {visibleProducts.map((p) => {
          const status = stockStatus(p);
          return (
            <div
              key={p.id}
              className={`grid ${gridCols} items-center gap-3 border-t border-surface-container px-[22px] py-3.5 ${ROW_TINT[status]}`}
            >
              <div className="flex items-center gap-3">
                {p.images?.[0] ? (
                  <img src={imgUrl(p.images[0])} alt="" className="h-11 w-11 flex-shrink-0 rounded-[9px] object-cover" />
                ) : (
                  <div className="h-11 w-11 flex-shrink-0 rounded-[9px] bg-surface-container" />
                )}
                <div>
                  <div className="text-[13.5px] font-semibold text-on-surface">{p.name}</div>
                  <div className="text-[11.5px] text-outline">Cód: {p.barcode ?? "—"}</div>
                </div>
              </div>
              <span className="text-[13.5px] font-bold text-on-surface">{fmtCUP(p.price)}</span>
              <span className="text-[13.5px] text-on-surface-variant">{p.stock} u.</span>
              <span className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={STATUS_STYLE[status]}>
                {STATUS_LABEL[status]}
              </span>
              {stockFilter === "out" && (
                <span className="text-[13.5px] font-bold text-on-surface">
                  {p._count?.requests ?? 0} {p._count?.requests === 1 ? "pedido" : "pedidos"}
                </span>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setModalState({ mode: "edit", product: p })} className="text-tertiary-accent">
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => window.confirm(`¿Eliminar "${p.name}"?`) && deleteProduct.mutate(p.id)}
                  className="text-error"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border border-secondary-container/25 bg-secondary-container/[0.08] px-[18px] py-3.5 text-[12.5px] text-secondary">
        💡 {data?.limit ? `En plan Business tenés productos ilimitados. En Regular el límite es ${data.limit}.` : "Tenés productos ilimitados con el Plan Business."}
      </div>

      {modalState && (
        <ProductModal
          product={modalState.mode === "edit" ? modalState.product : null}
          prefillBarcode={modalState.barcode}
          planType={data?.planType}
          isRestaurant={vendor?.isRestaurant}
          categories={categories}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
