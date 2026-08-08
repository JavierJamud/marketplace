import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Trash2, ScanBarcode, X, ArrowUpDown, Star, Ruler, Layers } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";

// Bloque 52: presets rápidos de tallas de ropa — un click para agregar/quitar,
// además del input libre (numéricas de calzado, "Talla única", etc.).
const PRESET_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
// Bloque 52: "whatsapp" ya no está hardcodeado en esta lista — es el único
// canal que products.controller.js permite SIEMPRE (universal, no
// desactivable); "cod"/"prepaid" recién se muestran si el admin los activó
// (SiteSettings.productPaymentMethods, ver AdminBranding.jsx).
const PAYMENT_METHOD_LABEL = { whatsapp: "WhatsApp", cod: "Contra entrega", prepaid: "Transferencia" };

// Bloque 49: `path` puede ser un link externo pegado por el vendedor (no solo
// un archivo subido a nuestro server) — si ya es absoluto, se usa tal cual.
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
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
  unlimited: { background: "rgba(0,105,181,0.12)", color: "#0069b5" },
  "no-photos": { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
};
const STATUS_LABEL = {
  active: "Activo",
  low: "Stock bajo",
  out: "Sin stock",
  paused: "Pausado",
  unlimited: "Siempre disponible",
  "no-photos": "Sin fotos (pausado)",
};
const ROW_TINT = {
  out: "bg-[#ba1a1a]/[0.03]",
  low: "bg-[#8a5100]/[0.04]",
  active: "",
  paused: "",
  unlimited: "",
  "no-photos": "bg-[#ba1a1a]/[0.03]",
};

// Bloque 56: un producto sin ninguna foto queda pausado de forma forzada por
// el backend (ver createProduct/removeProductImage) — se distingue de un
// "Pausado" común para que el vendedor sepa exactamente qué le falta.
function stockStatus(p) {
  if (!p.isActive) return p.images?.length > 0 ? "paused" : "no-photos";
  if (p.unlimitedStock) return "unlimited";
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
  unlimitedStock: false,
  barcode: "",
  badge: "Nuevo",
  currency: "USD",
  paymentMethods: ["whatsapp"],
  availableForTableMenu: false,
  tags: [],
  sizes: [],
  sizeStock: {},
  priceTiers: [],
};

function ProductModal({ product, prefillBarcode, planType, isRestaurant, categories, onClose, vendorCurrency }) {
  const queryClient = useQueryClient();
  // Bloque 66: a diferencia de savedProduct (que pasa a existir tanto para
  // un producto editado COMO para uno recién creado en esta misma sesión de
  // modal), isEdit distingue "ya existía al abrir el modal" — es lo que
  // decide si el guardado exitoso cierra el modal solo (ver save.onSuccess).
  const isEdit = !!product;
  // savedProduct != null en cuanto el producto existe en la DB (ya sea
  // porque se abrió en modo edición, o porque se acaba de crear) — recién
  // ahí se puede subir fotos, que necesitan un productId real.
  const [savedProduct, setSavedProduct] = useState(product);
  const [removeImageTarget, setRemoveImageTarget] = useState(null); // url de la foto a eliminar
  const [linkInput, setLinkInput] = useState("");
  // Bloque 51: cada foto se sube de a una, con recorte — este contador fuerza
  // un remount del ImageCropUploader (via key) después de cada subida, para
  // que el tile "Subir" vuelva a mostrarse vacío en vez de quedarse pegado
  // mostrando la última foto recortada.
  const [cropResetKey, setCropResetKey] = useState(0);
  const [form, setForm] = useState(
    product
      ? {
          name: product.name,
          description: product.description ?? "",
          categoryId: product.categoryId ?? "",
          price: String(product.price),
          oldPrice: product.oldPrice ? String(product.oldPrice) : "",
          stock: String(product.stock),
          unlimitedStock: product.unlimitedStock ?? false,
          barcode: product.barcode ?? "",
          badge: product.badge ?? "",
          currency: product.currency ?? "USD",
          paymentMethods: product.paymentMethods,
          availableForTableMenu: product.availableForTableMenu ?? false,
          tags: product.tags ?? [],
          sizes: product.sizes ?? [],
          sizeStock: product.sizeStock ?? {},
          priceTiers: (product.priceTiers ?? []).map((t) => ({ minQty: String(t.minQty), price: String(t.price) })),
        }
      : { ...EMPTY_FORM, barcode: prefillBarcode ?? "", currency: vendorCurrency ?? "CUP" }
  );
  const [tagInput, setTagInput] = useState("");
  const [sizeInput, setSizeInput] = useState("");
  // Estado propio (no derivado de form.sizes.length) — si no, tildar el
  // checkbox y todavía no haber elegido ninguna talla lo "apagaría" solo.
  const [sizesEnabled, setSizesEnabled] = useState((product?.sizes ?? []).length > 0);
  // Bloque 55: mismo criterio que sizesEnabled — estado propio para no
  // "apagar" el checkbox solo si el vendedor borra momentáneamente todos los
  // tramos mientras edita.
  const [priceTiersEnabled, setPriceTiersEnabled] = useState((product?.priceTiers ?? []).length > 0);

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

  // Bloque 52: tallas — preset (click) o libre (tag + Enter, para numéricas
  // de calzado o cualquier otra convención). Al agregar una talla nueva
  // arranca con stock 0 (el vendedor lo carga en la grilla de abajo); al
  // quitarla, se descarta también su entrada en sizeStock.
  function toggleSize(size) {
    setForm((f) => {
      if (f.sizes.includes(size)) {
        const { [size]: _omit, ...restStock } = f.sizeStock;
        return { ...f, sizes: f.sizes.filter((s) => s !== size), sizeStock: restStock };
      }
      return { ...f, sizes: [...f.sizes, size], sizeStock: { ...f.sizeStock, [size]: f.sizeStock[size] ?? 0 } };
    });
  }

  function addCustomSize() {
    const clean = sizeInput.trim();
    if (!clean) return;
    if (form.sizes.includes(clean)) {
      setSizeInput("");
      return;
    }
    toggleSize(clean);
    setSizeInput("");
  }

  function setSizeStock(size, qty) {
    setForm((f) => ({ ...f, sizeStock: { ...f.sizeStock, [size]: Math.max(0, Number(qty) || 0) } }));
  }

  // El vendedor puede prender/apagar "este producto tiene tallas" sin perder
  // el stock general ya cargado — al apagar, se limpian sizes/sizeStock y el
  // campo Stock normal vuelve a mandar.
  function toggleHasSizes(next) {
    setSizesEnabled(next);
    // Bloque 56: tallas y "disponible siempre" son mutuamente excluyentes —
    // cada talla necesita su propio stock real (el backend también lo exige,
    // ver assertStockModeConsistent).
    if (!next) setForm((f) => ({ ...f, sizes: [], sizeStock: {} }));
    else if (form.unlimitedStock) setForm((f) => ({ ...f, unlimitedStock: false }));
  }

  // Bloque 56: "disponible siempre" — el vendedor no lleva (o no quiere
  // llevar) stock real de este producto; se muestra siempre disponible y no
  // se le hace ningún seguimiento (ver pricing.js del backend). Apagable en
  // cualquier momento sin perder el número de stock ya cargado.
  function toggleUnlimitedStock(next) {
    if (next) setSizesEnabled(false);
    setForm((f) => ({ ...f, unlimitedStock: next, ...(next ? { sizes: [], sizeStock: {} } : {}) }));
  }

  // Bloque 55: precios por cantidad (mayoreo) — opcional por producto. Al
  // apagar el checkbox se vacía form.priceTiers, y como siempre se manda esa
  // clave en el payload (ver `save` abajo), el backend borra los tramos que
  // ya existieran para ese producto.
  function togglePriceTiers(next) {
    setPriceTiersEnabled(next);
    if (!next) setForm((f) => ({ ...f, priceTiers: [] }));
    else if (form.priceTiers.length === 0) setForm((f) => ({ ...f, priceTiers: [{ minQty: "3", price: "" }] }));
  }

  function addPriceTier() {
    setForm((f) => {
      const last = f.priceTiers[f.priceTiers.length - 1];
      const nextMinQty = last?.minQty ? Number(last.minQty) + 1 : 3;
      return { ...f, priceTiers: [...f.priceTiers, { minQty: String(nextMinQty), price: "" }] };
    });
  }

  function updatePriceTier(index, key, value) {
    setForm((f) => ({ ...f, priceTiers: f.priceTiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)) }));
  }

  function removePriceTier(index) {
    setForm((f) => ({ ...f, priceTiers: f.priceTiers.filter((_, i) => i !== index) }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        categoryId: form.categoryId || undefined,
        price: Number(form.price),
        oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
        // Con tallas, el stock lo recalcula el backend a partir de
        // sizeStock (reconcileStock) — igual se manda el número actual
        // como referencia, no hace daño.
        stock: Number(form.stock),
        unlimitedStock: form.unlimitedStock,
        barcode: form.barcode || undefined,
        badge: form.badge || null,
        paymentMethods: form.paymentMethods,
        availableForTableMenu: form.availableForTableMenu,
        tags: form.tags,
        sizes: sizesEnabled ? form.sizes : [],
        sizeStock: sizesEnabled ? form.sizeStock : {},
        // Siempre se manda (aunque sea []) para que apagar el checkbox borre
        // tramos ya guardados en el backend (ver hasTiersInPayload allá).
        priceTiers: priceTiersEnabled
          ? form.priceTiers
              .filter((t) => t.minQty !== "" && t.price !== "")
              .map((t) => ({ minQty: Number(t.minQty), price: Number(t.price) }))
          : [],
        currency: form.currency,
      };
      if (savedProduct) return (await api.patch(`/products/${savedProduct.id}`, payload)).data;
      return (await api.post("/products", payload)).data;
    },
    onSuccess: (data) => {
      // Bloque 56: un producto recién creado se guarda en pausa hasta que
      // tenga al menos 1 foto (ver createProduct en el backend) — el toast
      // deja claro por qué, así el vendedor no piensa que algo falló.
      toast.success(savedProduct ? "Producto actualizado." : "Producto creado — sube al menos 1 foto para que salga a la venta.");
      setSavedProduct(data.product);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
      // Bloque 66 (bug real reportado en vivo): el modal se quedaba abierto
      // para siempre tras editar — nunca se cerraba solo. Ahora sí, apenas
      // el guardado fue exitoso Y el producto ya tiene al menos 1 foto (si
      // edita uno que quedó sin ninguna, se queda abierto para que la suba).
      if (isEdit && data.product.images?.length > 0) onClose();
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
      setRemoveImageTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la foto.");
      setRemoveImageTarget(null);
    },
  });

  // Bloque 49: pegar un link externo como alternativa a subir archivo —
  // apagable desde el admin (AdminLocations.jsx → allowProductImageLinks).
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const addImageLink = useMutation({
    mutationFn: async (url) => (await api.post(`/products/${savedProduct.id}/images/link`, { url })).data,
    onSuccess: (data) => {
      setSavedProduct(data.product);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
      setLinkInput("");
      if (data.warning) toast(data.warning, { icon: "⚠️" });
      else toast.success("Imagen agregada.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar el link."),
  });

  const reorderImages = useMutation({
    mutationFn: async (images) => (await api.patch(`/products/${savedProduct.id}/images/reorder`, { images })).data,
    onSuccess: (data) => setSavedProduct(data.product),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reordenar las fotos."),
  });

  const dragIndexRef = useRef(null);
  function handleImageDrop(dropIndex) {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (fromIndex === null || fromIndex === dropIndex) return;
    const next = [...savedProduct.images];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(dropIndex, 0, moved);
    setSavedProduct((p) => ({ ...p, images: next }));
    reorderImages.mutate(next);
  }

  // Bloque 51 (pedido explícito): además del reordenar por drag & drop, un
  // botón directo para marcar cuál es la imagen principal/portada — misma
  // acción (mover a la posición 0) pero explícita, sin depender de arrastrar.
  function makeCover(index) {
    if (index === 0) return;
    const next = [...savedProduct.images];
    const [moved] = next.splice(index, 1);
    next.unshift(moved);
    setSavedProduct((p) => ({ ...p, images: next }));
    reorderImages.mutate(next);
  }

  // Bloque 51: subida con recorte — el Blob que entrega ImageCropUploader no
  // trae nombre/extensión (a diferencia de un <input type=file>), y
  // productUpload.js filtra por extensión del nombre — por eso se envuelve en
  // un File con extensión real antes de reusar la misma mutación de siempre.
  function handleCroppedUpload(blob) {
    const file = new File([blob], `product-${Date.now()}.jpg`, { type: blob.type });
    uploadImages.mutate([file]);
    setCropResetKey((k) => k + 1);
  }

  function submitImageLink() {
    const url = linkInput.trim();
    if (!url) return;
    addImageLink.mutate(url);
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
            <span className="mb-1 block text-label-md text-on-surface-variant">
              Descripción <span className="text-error">*</span>
            </span>
            <p className="mb-1.5 text-label-sm text-outline">
              Obligatoria — es la que ven los clientes resumida en la tarjeta del producto.
            </p>
            <AiGenerateButton
              kind="product"
              currentText={form.description}
              productName={form.name}
              onGenerated={(text) => setForm((f) => ({ ...f, description: text }))}
            />
            <textarea
              required
              minLength={10}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Escribe unas palabras clave del producto (ej: zapatillas rojas, cuero sintético, talla 38-42) y usa 'Mejorar con IA' arriba."
              className="min-h-[80px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none focus:border-primary-container"
            />
          </div>

          <Select
            label="Categoría"
            required
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="" disabled>
              Elige una categoría...
            </option>
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

          <div className="grid grid-cols-[1fr_1fr_120px] gap-3">
            <Input label="Precio" type="number" min={1} required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input label="Precio anterior (opcional)" type="number" min={1} value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value })} />
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Moneda</span>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-[13px] font-semibold text-on-surface focus:outline-none"
              >
                {(siteSettings?.availableCurrencies ?? ["USD", "CUP", "EUR", "MXN"]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!sizesEnabled && !form.unlimitedStock && (
              <Input label="Stock" type="number" min={0} required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            )}
            <Input
              label="Código de barras"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              className={sizesEnabled || form.unlimitedStock ? "col-span-2" : ""}
            />
          </div>

          {!sizesEnabled && (
            <label className="flex items-start gap-2 rounded-lg border border-outline-variant p-3.5 text-body-md font-semibold text-on-surface">
              <input type="checkbox" className="mt-0.5" checked={form.unlimitedStock} onChange={(e) => toggleUnlimitedStock(e.target.checked)} />
              <span>
                Disponible siempre (sin stock definido)
                <span className="mt-1 block text-label-sm font-normal text-outline">
                  Para productos que no se agotan o que siempre repones al momento — el stock deja de ser obligatorio. Ojo: no vas a tener ningún
                  seguimiento de este producto (no aparece en "stock bajo" ni "sin stock" aunque en algún momento se te termine de verdad).
                </span>
              </span>
            </label>
          )}

          <div className="rounded-lg border border-outline-variant p-3.5">
            <label className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
              <input type="checkbox" checked={sizesEnabled} onChange={(e) => toggleHasSizes(e.target.checked)} />
              <Ruler className="h-4 w-4 text-tertiary-accent" /> Este producto tiene tallas (ropa, calzado, etc.)
            </label>
            {sizesEnabled && (
              <div className="mt-3">
                <p className="mb-1.5 text-label-sm text-outline">Elige las tallas rápidas o escribe la tuya (números de calzado, "Talla única", etc.) y Enter.</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESET_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSize(s)}
                      className={`rounded-full border px-3 py-1 text-[12.5px] font-bold ${
                        form.sizes.includes(s) ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface-variant"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mb-3 flex gap-2">
                  <input
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomSize(); } }}
                    placeholder="Ej: 38, 39, 40... y Enter"
                    className="h-9 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-primary-container"
                  />
                  <button
                    type="button"
                    onClick={addCustomSize}
                    className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[13px] font-bold text-on-surface-variant hover:bg-surface-container"
                  >
                    +
                  </button>
                </div>
                {form.sizes.length > 0 && (
                  <>
                    <p className="mb-1.5 text-label-sm text-on-surface-variant">Stock por talla:</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {form.sizes.map((size) => (
                        <div key={size} className="flex items-center gap-1.5 rounded border border-outline-variant px-2.5 py-1.5">
                          <span className="flex-1 truncate text-[12.5px] font-bold text-on-surface">{size}</span>
                          <input
                            type="number"
                            min={0}
                            value={form.sizeStock[size] ?? 0}
                            onChange={(e) => setSizeStock(size, e.target.value)}
                            className="h-7 w-14 rounded border border-outline-variant bg-surface-container-lowest px-1.5 text-center text-[12.5px] outline-none"
                          />
                          <button type="button" onClick={() => toggleSize(size)} className="text-outline hover:text-error">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-label-sm text-outline">
                      Stock total: <strong className="text-on-surface">{Object.values(form.sizeStock).reduce((sum, n) => sum + Number(n || 0), 0)}</strong> unidades
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-outline-variant p-3.5">
            <label className="flex items-center gap-2 text-body-md font-semibold text-on-surface">
              <input type="checkbox" checked={priceTiersEnabled} onChange={(e) => togglePriceTiers(e.target.checked)} />
              <Layers className="h-4 w-4 text-tertiary-accent" /> Precios especiales por cantidad (mayoreo)
            </label>
            {priceTiersEnabled && (
              <div className="mt-3">
                <p className="mb-2 text-label-sm text-outline">
                  Opcional: ofrece un precio más bajo por unidad a partir de cierta cantidad (ej. 3+ unidades a $90, 10+ a $80). Cada tramo debe pedir
                  más unidades y costar menos que el anterior.
                </p>
                <div className="space-y-2">
                  {form.priceTiers.map((tier, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex-shrink-0 text-[12.5px] text-on-surface-variant">A partir de</span>
                      <input
                        type="number"
                        min={2}
                        value={tier.minQty}
                        onChange={(e) => updatePriceTier(i, "minQty", e.target.value)}
                        className="h-9 w-16 rounded border border-outline-variant bg-surface-container-lowest px-2 text-center text-[13px] outline-none focus:border-primary-container"
                      />
                      <span className="flex-shrink-0 text-[12.5px] text-on-surface-variant">u.:</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Precio c/u"
                        value={tier.price}
                        onChange={(e) => updatePriceTier(i, "price", e.target.value)}
                        className="h-9 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-2 text-[13px] outline-none focus:border-primary-container"
                      />
                      <span className="flex-shrink-0 text-[12px] text-outline">{currency}</span>
                      <button type="button" onClick={() => removePriceTier(i)} className="flex-shrink-0 text-outline hover:text-error">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addPriceTier}
                  disabled={form.priceTiers.length >= 10}
                  className="mt-2 rounded-md border border-outline-variant px-3 py-1.5 text-[12.5px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-40"
                >
                  + Agregar otro tramo
                </button>
              </div>
            )}
          </div>
          <div>
            <Select label="Etiqueta" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })}>
              <option value="">Sin etiqueta</option>
              <option value="Nuevo">Nuevo</option>
              {(siteSettings?.availableProductBadges ?? []).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
            {!savedProduct && (
              <p className="mt-1 text-label-sm text-outline">
                Todo producto nuevo sale con "Nuevo" — se quita sola a los {siteSettings?.newBadgeDurationDays ?? 14} días, o puedes
                cambiarla ahora.
              </p>
            )}
          </div>

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
                  placeholder="Escribe un tag y Enter..."
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
                {["whatsapp", ...(siteSettings?.productPaymentMethods ?? ["cod", "prepaid"])].map((id) => (
                  <label key={id} className="flex items-center gap-2 text-body-md text-on-surface">
                    <input
                      type="checkbox"
                      checked={form.paymentMethods.includes(id)}
                      disabled={id === "whatsapp"}
                      onChange={() => togglePayment(id)}
                    />
                    {PAYMENT_METHOD_LABEL[id] ?? id}
                    {id === "whatsapp" && <span className="text-label-sm text-outline">(por default, siempre activo)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-label-md text-on-surface-variant">
              Fotos del producto <span className="text-error">*</span>
            </span>
            {savedProduct && !savedProduct.images?.length && (
              <p className="mb-2.5 rounded-md bg-error/10 px-3 py-2 text-label-sm font-semibold text-error">
                ⚠️ Este producto está en pausa y no se muestra a la venta hasta que subas al menos 1 foto.
              </p>
            )}
            {savedProduct ? (
              <>
                <div className="mb-2.5 flex flex-wrap gap-2">
                  {savedProduct.images?.map((url, index) => (
                    <div
                      key={url}
                      draggable
                      onDragStart={() => { dragIndexRef.current = index; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleImageDrop(index)}
                      title="Arrastra para reordenar"
                      className="group relative h-16 w-16 flex-shrink-0 cursor-grab overflow-hidden rounded-md border border-surface-container-high active:cursor-grabbing"
                    >
                      <img src={imgUrl(url)} alt="" className="h-full w-full object-cover" />
                      {index === 0 ? (
                        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                          Portada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => makeCover(index)}
                          title="Hacer portada"
                          className="absolute bottom-0.5 left-0.5 rounded bg-black/60 p-0.5 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRemoveImageTarget(url)}
                        disabled={removeImage.isPending}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <ImageCropUploader
                    key={cropResetKey}
                    aspect={7 / 4}
                    accept="image/jpeg,image/webp"
                    boxClassName="h-16 w-16 flex-shrink-0"
                    compact
                    onFileReady={handleCroppedUpload}
                  />
                </div>
                <p className="text-label-sm text-outline">
                  {uploadImages.isPending
                    ? "Subiendo foto..."
                    : "Tamaño recomendado: 1400×800px (relación 7:4) — al subir una foto podrás recortarla para ajustarla. Solo JPG o WebP."}
                  {savedProduct.images?.length > 1 && " Arrastra una foto (o usa la estrella) para elegir la portada."}
                </p>

                {siteSettings?.allowProductImageLinks && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitImageLink(); } }}
                      placeholder="O pega el link de una imagen (https://...)"
                      className="h-9 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-primary-container"
                    />
                    <button
                      type="button"
                      onClick={submitImageLink}
                      disabled={addImageLink.isPending || !linkInput.trim()}
                      className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[13px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                    >
                      {addImageLink.isPending ? "..." : "Agregar link"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-label-sm text-outline">Guarda el producto primero para poder subirle fotos.</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                // Bloque 66 (pedido explícito): nunca cerrar dejando el
                // producto sin ninguna foto — queda pausado y sin avisar
                // resulta en vendedores que creen haber terminado.
                if (savedProduct && !savedProduct.images?.length) {
                  toast.error("Sube al menos 1 foto antes de terminar — sin fotos el producto queda pausado y no se muestra en tu tienda.");
                  return;
                }
                onClose();
              }}
            >
              {savedProduct ? "Listo" : "Cancelar"}
            </Button>
            <Button type="submit" className="flex-1" disabled={save.isPending || form.description.trim().length < 10}>
              {save.isPending ? "Guardando..." : savedProduct ? "Guardar cambios" : "Crear producto"}
            </Button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={!!removeImageTarget}
        title="¿Eliminar esta foto?"
        message="Se quita del producto de inmediato. Esta acción no se puede deshacer."
        confirmLabel={removeImage.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        onConfirm={() => removeImage.mutate(removeImageTarget)}
        onCancel={() => setRemoveImageTarget(null)}
      />
    </div>
  );
}

export default function VendorProducts() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const [modalState, setModalState] = useState(null); // null | { mode: "new", barcode? } | { mode: "edit", product }
  const [deleteTarget, setDeleteTarget] = useState(null); // producto a eliminar, para el modal de confirmación
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
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar.");
      setDeleteTarget(null);
    },
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
                  <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-on-surface">
                    {p.name}
                    {p.sizes?.length > 0 && (
                      <span title={`Tallas: ${p.sizes.join(", ")}`} className="rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent">
                        {p.sizes.length} tallas
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-outline">Cód: {p.barcode ?? "—"}</div>
                </div>
              </div>
              <span className="text-[13.5px] font-bold text-on-surface">{formatPrice(p.price, p.currency)}</span>
              <span className="text-[13.5px] text-on-surface-variant">{p.unlimitedStock ? "∞" : `${p.stock} u.`}</span>
              <span className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={STATUS_STYLE[status]}>
                {STATUS_LABEL[status]}
              </span>
              {stockFilter === "out" && (
                <span className="text-[13.5px] font-bold text-on-surface">
                  {p._count?.requests ?? 0} {p._count?.requests === 1 ? "pedido" : "pedidos"}
                </span>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setModalState({ mode: "edit", product: p })} aria-label={`Editar ${p.name}`} title="Editar producto" className="text-tertiary-accent">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setDeleteTarget(p)} aria-label={`Eliminar ${p.name}`} title="Eliminar producto" className="text-error">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border border-secondary-container/25 bg-secondary-container/[0.08] px-[18px] py-3.5 text-[12.5px] text-secondary">
        💡 {data?.limit ? `En plan Business tienes productos ilimitados. En Regular el límite es ${data.limit}.` : "Tienes productos ilimitados con el Plan Business."}
      </div>

      {modalState && (
        <ProductModal
          product={modalState.mode === "edit" ? modalState.product : null}
          prefillBarcode={modalState.barcode}
          planType={data?.planType}
          isRestaurant={vendor?.isRestaurant}
          categories={categories}
          vendorCurrency={vendor?.currency}
          onClose={closeModal}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${deleteTarget.name}"?`}
          description="El producto se va a quitar de tu tienda y de cualquier menú donde aparezca."
          pending={deleteProduct.isPending}
          onConfirm={() => deleteProduct.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
