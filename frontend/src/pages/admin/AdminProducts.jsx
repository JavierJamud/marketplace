import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { X, Pencil, Trash2, PackageSearch, Ruler, Package, Star, ChevronDown, ExternalLink } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { useListParams, useDebouncedSearch } from "../../lib/useListParams.js";
import { StatTile, StatStrip, SortHeader, SearchField, RowSkeletons, Pagination } from "../../components/admin/ListControls.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 52 (pedido explícito): "todo lo que agrega el vendedor debe tener
// supervisión y conexión visual o de edición para el administrador en todo
// momento" — antes no existía ninguna pantalla para ver/editar productos
// individuales de cualquier tienda, solo estadísticas agregadas por vendedor.
function ProductEditModal({ product, categories, onClose }) {
  const queryClient = useQueryClient();
  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [form, setForm] = useState({
    name: product.name,
    description: product.description ?? "",
    categoryId: product.categoryId ?? "",
    price: String(product.price),
    oldPrice: product.oldPrice ? String(product.oldPrice) : "",
    stock: String(product.stock),
    badge: product.badge ?? "",
    isActive: product.isActive,
    isFeatured: product.isFeatured,
  });

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx).
  const initialFormSnapshot = useRef(JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== initialFormSnapshot.current;

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/admin/products/${product.id}`, {
          name: form.name,
          description: form.description || null,
          categoryId: form.categoryId || undefined,
          price: Number(form.price),
          oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
          stock: Number(form.stock),
          badge: form.badge || null,
          isActive: form.isActive,
          isFeatured: form.isFeatured,
        })
      ).data,
    onSuccess: () => {
      toast.success("Producto actualizado.");
      queryClient.invalidateQueries({ queryKey: ["admin-list-products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-product-stats"] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  // Bloque 196: sin ninguna validación extra más allá de save.isPending —
  // "Guardar y salir" siempre está disponible acá.
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: () => save.mutateAsync() });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
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
            {/* Bloque 65: ya no es elegible por producto — la moneda es una
                sola para toda la tienda, se fuerza server-side de todos modos. */}
            <div>
              <span className="mb-1 block text-label-md text-on-surface-variant">Moneda</span>
              <div className="flex h-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container px-2 text-[13px] font-semibold text-on-surface-variant">
                {product.vendor?.currency ?? "CUP"}
              </div>
            </div>
          </div>
          {!(product.sizes?.length > 0) && (
            <Input label="Stock" type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          )}
          <Select label="Etiqueta" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })}>
            <option value="">Sin etiqueta</option>
            <option value="Nuevo">Nuevo</option>
            {(siteSettings?.availableProductBadges ?? []).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </Select>

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

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={dirtyModal.handleSaveAndClose}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </div>
  );
}


// Bloque 241 (pedido explícito — "la sección de productos no se ve bien
// cuando hay muchos... mejor organicémoslos de otra forma, con filtros de más
// vendidos y estadística real por producto"): la lista ahora pagina en el
// servidor y vive en la URL (filtros, orden y página sobreviven a una
// recarga). Los 7 contadores de arriba son a la vez filtros por estado.
const LIST_DEFAULTS = { q: "", status: "all", category: "", sort: "recent", dir: "desc", page: 1, pageSize: 25 };

// Un solo selector para el celular (donde no hay cabeceras de columna): cada
// opción lleva su orden y su dirección.
const SORT_OPTIONS = [
  { value: "recent:desc", label: "Más recientes" },
  { value: "sales:desc", label: "Más vendidos" },
  { value: "views:desc", label: "Más vistos" },
  { value: "clicks:desc", label: "Más clics" },
  { value: "rating:desc", label: "Mejor valorados" },
  { value: "stock:asc", label: "Menos stock" },
  { value: "price:desc", label: "Mayor precio" },
  { value: "price:asc", label: "Menor precio" },
];

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,3fr)_84px_60px_64px_64px_72px_92px_96px] md:items-center md:gap-3";

function fmtNumber(n) {
  return Number(n ?? 0).toLocaleString("es-CU");
}

function fmtDuration(seconds) {
  if (seconds == null) return "Sin datos";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" }) : "Sin actividad";
}

function stockOf(p) {
  if (p.unlimitedStock) return { text: "Siempre", tone: "text-on-surface-variant" };
  if (p.stock === 0) return { text: "0", tone: "font-bold text-error" };
  if (p.stock <= 3) return { text: String(p.stock), tone: "font-bold text-secondary" };
  return { text: fmtNumber(p.stock), tone: "text-on-surface" };
}

function StatLine({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-outline">{label}</div>
      <div className="truncate text-[14px] font-bold text-on-surface">{value}</div>
      {sub && <div className="truncate text-[11px] text-outline">{sub}</div>}
    </div>
  );
}

// Detalle de un producto: se pide solo al abrir la fila (no para las 25 de la
// página). Todo dato sale de columnas o de pedidos entregados reales.
function ProductDetail({ product, onTogglePause, onEdit, onDelete }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-list-product-stats", product.id],
    queryFn: async () => (await api.get(`/admin/products/${product.id}/stats`)).data.stats,
  });

  return (
    <div className="border-t border-surface-container bg-surface-container/40 px-4 py-4">
      {isLoading && <p className="text-[13px] text-on-surface-variant">Cargando estadísticas...</p>}
      {isError && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-error">
          No se pudieron cargar las estadísticas.
          <button type="button" onClick={() => refetch()} className="h-11 rounded-xl border border-error/40 px-4 font-semibold md:h-9">
            Reintentar
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4">
            <StatLine label="Unidades vendidas (30 días)" value={fmtNumber(data.units30)} sub="Pedidos entregados" />
            <StatLine label="Ingresos (30 días)" value={formatPrice(data.revenue30, data.currency)} />
            <StatLine label="Ventas totales" value={fmtNumber(data.salesCount)} sub="Unidades confirmadas" />
            <StatLine label="Vistas de la ficha" value={fmtNumber(data.viewCount)} />
            <StatLine label="Clics en listados" value={fmtNumber(data.clickCount)} sub={`${fmtNumber(data.searchClickCount)} desde búsquedas`} />
            <StatLine label="Tiempo medio en la ficha" value={fmtDuration(data.avgDwellSeconds)} />
            <StatLine
              label="Valoración"
              value={data.reviewCount > 0 ? `${data.rating.toFixed(1)} de 5` : "Sin reseñas"}
              sub={data.reviewCount > 0 ? `${fmtNumber(data.reviewCount)} reseña${data.reviewCount === 1 ? "" : "s"}` : undefined}
            />
            <StatLine label="Favoritos" value={fmtNumber(data.favoriteCount)} sub={data.requestCount > 0 ? `${fmtNumber(data.requestCount)} solicitudes` : undefined} />
            <div className="min-w-0">
              <div className="text-[11px] text-outline">Calidad de la ficha</div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                  <div className="h-full rounded-full bg-tertiary-accent" style={{ width: `${data.completeness}%` }} />
                </div>
                <span className="text-[13px] font-bold text-on-surface">{data.completeness}/100</span>
              </div>
            </div>
            <StatLine label="Última actividad" value={fmtDate(data.lastActivityAt)} />
            <StatLine label="Publicado" value={fmtDate(data.createdAt)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={`/producto/${data.vendor.slug}/${data.slug}`}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container md:h-9"
            >
              <ExternalLink className="h-4 w-4" /> Ver en la tienda
            </Link>
            <button
              type="button"
              onClick={onTogglePause}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container md:hidden"
            >
              {product.isActive ? "Pausar" : "Activar"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-tertiary-accent hover:bg-surface-container md:h-9"
            >
              <Pencil className="h-4 w-4" /> Editar
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex h-11 items-center gap-1.5 rounded-xl border border-error/30 px-4 text-[13px] font-semibold text-error hover:bg-error/5 md:h-9"
            >
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProductRow({ p, open, onToggleOpen, onTogglePause, onEdit, onDelete }) {
  const stock = stockOf(p);
  return (
    <div className="border-b border-surface-container last:border-b-0">
      <div className={`px-4 py-3 ${ROW_GRID}`}>
        {/* Nombre: toda esta zona abre el detalle */}
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-3 text-left"
        >
          <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-md bg-surface-container">
            {p.images?.[0] ? <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-on-surface">
              <span className="truncate">{p.name}</span>
              {/* Desde md; en celular van en la línea de datos de abajo para
                  que el nombre, la etiqueta de estado y la flecha quepan. */}
              <span className="hidden items-center gap-1.5 md:flex">
                {p.sizes?.length > 0 && (
                  <span
                    title={`Tallas: ${p.sizes.join(", ")}`}
                    className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent"
                  >
                    <Ruler className="h-2.5 w-2.5" /> {p.sizes.length}
                  </span>
                )}
                {p.isFeatured && (
                  <span className="flex-shrink-0 rounded-full bg-secondary/10 px-1.5 py-0.5 text-[9.5px] font-bold text-secondary">Destacado</span>
                )}
              </span>
            </div>
            <div className="truncate text-[11.5px] text-outline">
              {p.vendor?.companyName} · {p.category?.name ?? "Sin categoría"}
            </div>
          </div>
          {/* Celular: el estado es solo una etiqueta (pausar/activar vive en
              el detalle, donde el botón tiene 44px) — así la fila no gasta
              una línea entera en un botón. */}
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold md:hidden ${
              p.isActive ? "bg-verified/10 text-verified-dark" : "bg-surface-container-high text-on-surface-variant"
            }`}
          >
            {p.isActive ? "Activo" : "Pausado"}
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-outline transition-transform md:hidden ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Celular: la misma información, en una segunda línea compacta */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-on-surface-variant md:hidden">
          <span className="font-bold text-on-surface">{formatPrice(p.price, p.currency)}</span>
          <span>
            Stock <span className={stock.tone}>{stock.text}</span>
          </span>
          <span>{fmtNumber(p.salesCount)} vendidas</span>
          <span>{fmtNumber(p.viewCount)} vistas</span>
          {p.reviewCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(p.rating).toFixed(1)}
            </span>
          )}
          {p.isFeatured && <span className="rounded-full bg-secondary/10 px-1.5 py-0.5 text-[9.5px] font-bold text-secondary">Destacado</span>}
          {p.sizes?.length > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-tertiary-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold text-tertiary-accent">
              <Ruler className="h-2.5 w-2.5" /> {p.sizes.length} tallas
            </span>
          )}
        </div>

        {/* Escritorio: una celda por dato */}
        <div className="hidden text-right text-[13px] font-semibold text-on-surface md:block">{formatPrice(p.price, p.currency)}</div>
        <div className={`hidden text-right text-[13px] md:block ${stock.tone}`}>{stock.text}</div>
        <div className="hidden text-right text-[13px] text-on-surface md:block">{fmtNumber(p.salesCount)}</div>
        <div className="hidden text-right text-[13px] text-on-surface-variant md:block">{fmtNumber(p.viewCount)}</div>
        <div className="hidden text-right text-[13px] text-on-surface-variant md:block">
          {p.reviewCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-secondary-container text-secondary-container" /> {Number(p.rating).toFixed(1)}
            </span>
          ) : (
            "—"
          )}
        </div>

        <div className="hidden items-center gap-1.5 md:flex md:justify-center">
          <button
            type="button"
            onClick={onTogglePause}
            className="h-8 rounded-full px-3 text-[11px] font-bold"
            style={p.isActive ? { background: "rgba(12,174,83,0.12)", color: "#0A8F42" } : { background: "rgba(117,119,124,0.12)", color: "#5c5e63" }}
            aria-label={p.isActive ? "Pausar producto" : "Activar producto"}
          >
            {p.isActive ? "Activo" : "Pausado"}
          </button>
        </div>
        <div className="hidden items-center justify-end gap-0.5 md:flex">
          <button type="button" onClick={onEdit} aria-label="Editar producto" className="flex h-9 w-9 items-center justify-center rounded-lg text-tertiary-accent hover:bg-surface-container">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} aria-label="Eliminar producto" className="flex h-9 w-9 items-center justify-center rounded-lg text-error hover:bg-error/5">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && <ProductDetail product={p} onTogglePause={onTogglePause} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

export default function AdminProducts() {
  const queryClient = useQueryClient();
  const [params, setParams] = useListParams(LIST_DEFAULTS);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [openId, setOpenId] = useState(null);

  const commitSearch = useCallback((q) => setParams({ q }), [setParams]);
  const [searchText, setSearchText] = useDebouncedSearch(params.q, commitSearch);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-list-products", params],
    queryFn: async () =>
      (
        await api.get("/admin/products", {
          params: {
            q: params.q || undefined,
            status: params.status,
            categoryId: params.category || undefined,
            sort: params.sort,
            dir: params.dir,
            page: params.page,
            pageSize: params.pageSize,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get("/categories")).data.categories,
  });

  const toggleActive = useMutation({
    mutationFn: async (p) => (await api.patch(`/admin/products/${p.id}`, { isActive: !p.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-list-products"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      toast.success("Producto eliminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-list-products"] });
      setDeleteTarget(null);
      setOpenId(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  // Si al borrar o filtrar la página actual queda más allá del final, vuelve
  // a la última que existe en vez de mostrar una lista vacía.
  useEffect(() => {
    if (data && data.products.length === 0 && params.page > 1) setParams({ page: data.pageCount });
  }, [data, params.page, setParams]);

  const kpis = data?.kpis;
  const hasFilters = params.q || params.status !== "all" || params.category;
  const sortValue = `${params.sort}:${params.dir}`;
  const tiles = [
    { key: "all", label: "Todos", value: kpis?.all },
    { key: "active", label: "Activos", value: kpis?.active },
    { key: "paused", label: "Pausados", value: kpis?.paused },
    { key: "out", label: "Sin stock", value: kpis?.out, tone: "danger" },
    { key: "low", label: "Stock bajo", value: kpis?.low, tone: "warn", hint: "3 o menos" },
    { key: "noimage", label: "Sin foto", value: kpis?.noimage, tone: "warn" },
    { key: "featured", label: "Destacados", value: kpis?.featured },
  ];

  return (
    <div className="max-w-[1180px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Package} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Productos</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Todo lo que cargan los vendedores. Toca un producto para ver sus estadísticas reales, o usa los contadores para filtrar por estado.
      </p>

      <StatStrip>
        {tiles.map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            value={t.value}
            hint={t.hint}
            tone={t.tone}
            active={params.status === t.key}
            onClick={() => setParams({ status: t.key })}
          />
        ))}
      </StatStrip>

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SearchField value={searchText} onChange={setSearchText} placeholder="Buscar por producto o tienda" className="sm:col-span-2 lg:col-span-1" />
        <select
          value={params.category}
          onChange={(e) => setParams({ category: e.target.value })}
          aria-label="Filtrar por categoría"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          <option value="">Todas las categorías</option>
          {categories?.flatMap((c) => [c, ...(c.children ?? [])]).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={sortValue}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            setParams({ sort, dir });
          }}
          aria-label="Ordenar productos"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!SORT_OPTIONS.some((o) => o.value === sortValue) && <option value={sortValue}>Orden personalizado</option>}
        </select>
      </div>

      <div className={`${CARD} overflow-hidden transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
        <div className={`hidden border-b border-surface-container bg-surface-container/50 px-4 py-2 ${ROW_GRID}`}>
          <SortHeader label="Producto" sortKey="recent" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} />
          <SortHeader label="Precio" sortKey="price" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} align="right" />
          <SortHeader label="Stock" sortKey="stock" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} align="right" />
          <SortHeader label="Ventas" sortKey="sales" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} align="right" />
          <SortHeader label="Vistas" sortKey="views" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} align="right" />
          <SortHeader label="Nota" sortKey="rating" sort={params.sort} dir={params.dir} onSort={(sort, dir) => setParams({ sort, dir })} align="right" />
          <span className="text-center text-[11px] font-bold uppercase tracking-wide text-outline">Estado</span>
          <span />
        </div>

        {isLoading && <RowSkeletons />}

        {isError && !data && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-body-md text-error">No se pudo cargar la lista de productos.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {data?.products.map((p) => (
          <ProductRow
            key={p.id}
            p={p}
            open={openId === p.id}
            onToggleOpen={() => setOpenId(openId === p.id ? null : p.id)}
            onTogglePause={() => toggleActive.mutate(p)}
            onEdit={() => setEditTarget(p)}
            onDelete={() => setDeleteTarget(p)}
          />
        ))}

        {data && data.products.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <PackageSearch className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">
              {hasFilters ? "Ningún producto coincide con estos filtros." : "Todavía no hay productos cargados."}
            </p>
            {hasFilters && (
              <Button variant="outline" onClick={() => setParams({ q: "", status: "all", category: "" })}>
                Limpiar filtros
              </Button>
            )}
          </div>
        )}
      </div>

      {data && (
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.pageSize}
          onPage={(page) => setParams({ page })}
          onPageSize={(pageSize) => setParams({ pageSize })}
          noun="productos"
        />
      )}

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
