import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Flag, Users } from "lucide-react";
import { IconCircle, CARD } from "../../components/dashboard/DashboardCard.jsx";
import { useListParams, useDebouncedSearch } from "../../lib/useListParams.js";
import { timeAgo, exactDate } from "../../lib/relativeTime.js";
import { StatTile, StatStrip, SortHeader, SearchField, RowSkeletons, Pagination, ActionMenu } from "../../components/admin/ListControls.jsx";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";

const PALETTE = ["#337475", "#8A5100", "#003435", "#643900", "#232F3E", "#2c5b2e"];
function colorFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function EditCustomerModal({ customer, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ fullName: customer.fullName ?? "", email: customer.email, phone: customer.phone ?? "" });

  // Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
  // mostrado como ventana o popup en el panel debe cerrarse automáticamente,
  // y si necesita que guarden datos debe preguntar si desea guardar o
  // descartar antes de cerrar"): mismo patrón de snapshot-en-ref que
  // ProductModal (VendorProducts.jsx).
  const initialFormSnapshot = useRef(JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== initialFormSnapshot.current;
  const dirtyModal = useDirtyModal({ isDirty, onClose: onCancel, onSave: () => onSave(form) });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">Editar cliente</h2>
        <div className="flex flex-col gap-3.5">
          <Input label="Nombre completo" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input label="Correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="mt-5 flex gap-2.5">
          <button onClick={onCancel} disabled={saving} className="flex-1 rounded-full border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant">
            Cancelar
          </button>
          <Button className="flex-1" onClick={() => onSave(form)} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
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


// Bloque 242 (pedido explícito — "organizar mejor esta sección, mostrar la
// tabla de clientes más moderna y que ocupe menos espacio, ya que se puede
// hacer extensa cuando sean miles"): pagina, busca, filtra y ordena en el
// servidor, y cada fila mide ~52px en escritorio (antes ~70px con tres
// botones de texto por fila). Las acciones pasan a un menú "⋮".
const LIST_DEFAULTS = { q: "", status: "all", province: "", sort: "recent", dir: "desc", page: 1, pageSize: 25 };

const SORT_OPTIONS = [
  { value: "recent:desc", label: "Más recientes" },
  { value: "orders:desc", label: "Más pedidos" },
  { value: "lastLogin:desc", label: "Último acceso" },
  { value: "name:asc", label: "Nombre (A a Z)" },
];

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2.6fr)_minmax(0,1.2fr)_72px_104px_104px_96px_44px] md:items-center md:gap-3";

function CustomerRow({ c, onEdit, onSuspend, onReactivate, onDelete }) {
  const place = c.province ?? c.country ?? null;
  const menu = (
    <ActionMenu
      label={`Acciones de ${c.fullName ?? c.email}`}
      items={[
        { label: "Editar", onClick: onEdit },
        { label: c.isSuspended ? "Reactivar" : "Suspender", onClick: c.isSuspended ? onReactivate : onSuspend },
        { label: "Eliminar", onClick: onDelete, danger: true },
      ]}
    />
  );
  return (
    <div className={`border-b border-surface-container px-4 py-2 last:border-b-0 ${ROW_GRID} ${c.isSuspended ? "bg-error/[0.04]" : ""}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
          style={{ background: colorFor(c.id) }}
          aria-hidden="true"
        >
          {c.fullName?.[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-on-surface">{c.fullName ?? "Sin nombre"}</span>
            {c.reportsMadeCount > 0 && (
              <span
                title="Reportes de fraude que hizo este cliente"
                className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error"
              >
                <Flag className="h-2.5 w-2.5" /> {c.reportsMadeCount}
              </span>
            )}
            {c.isSuspended && (
              <span className="flex-shrink-0 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error md:hidden">Suspendido</span>
            )}
          </div>
          <div className="truncate text-[11.5px] text-outline">{c.email}</div>
        </div>
        <div className="md:hidden">{menu}</div>
      </div>

      {/* Celular: una línea de datos bajo el nombre */}
      <div className="mt-1 pl-12 text-[12px] text-on-surface-variant md:hidden">
        {[
          place,
          `${c.orderCount} ${c.orderCount === 1 ? "pedido" : "pedidos"}`,
          c.lastLoginAt ? `Entró ${timeAgo(c.lastLoginAt).toLowerCase()}` : "Nunca entró",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>

      <div className="hidden truncate text-[13px] text-on-surface-variant md:block">{place ?? "—"}</div>
      <div className="hidden text-right text-[13px] text-on-surface md:block" title={c.lastOrderAt ? `Último pedido: ${exactDate(c.lastOrderAt)}` : "Sin pedidos"}>
        {c.orderCount}
      </div>
      <div className="hidden text-[13px] text-on-surface-variant md:block" title={exactDate(c.lastLoginAt)}>
        {timeAgo(c.lastLoginAt)}
      </div>
      <div className="hidden text-[13px] text-on-surface-variant md:block">{exactDate(c.createdAt)}</div>
      <div className="hidden md:block">
        <span
          className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
          style={c.isSuspended ? { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
        >
          {c.isSuspended ? "Suspendido" : "Activo"}
        </span>
      </div>
      <div className="hidden justify-end md:flex">{menu}</div>
    </div>
  );
}

export default function AdminCustomers() {
  const queryClient = useQueryClient();
  const [params, setParams] = useListParams(LIST_DEFAULTS);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [suspending, setSuspending] = useState(null); // cliente a suspender, para el modal de confirmación

  const commitSearch = useCallback((q) => setParams({ q }), [setParams]);
  const [searchText, setSearchText] = useDebouncedSearch(params.q, commitSearch);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-list-customers", params],
    queryFn: async () =>
      (
        await api.get("/admin/customers", {
          params: {
            q: params.q || undefined,
            status: params.status,
            provinceId: params.province || undefined,
            sort: params.sort,
            dir: params.dir,
            page: params.page,
            pageSize: params.pageSize,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const { data: provinces } = useQuery({
    queryKey: ["locations-provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isSuspended }) => (await api.patch(`/admin/customers/${id}`, { isSuspended })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list-customers"] });
      setSuspending(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo actualizar el cliente.");
      setSuspending(null);
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/admin/customers/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list-customers"] });
      setEditing(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el cliente."),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/admin/customers/${id}`),
    onSuccess: () => {
      toast.success("Cliente eliminado.");
      queryClient.invalidateQueries({ queryKey: ["admin-list-customers"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar el cliente."),
  });

  // Si al borrar o filtrar la página actual queda más allá del final, vuelve
  // a la última que existe.
  useEffect(() => {
    if (data && data.customers.length === 0 && params.page > 1) setParams({ page: data.pageCount });
  }, [data, params.page, setParams]);

  const kpis = data?.kpis;
  const hasFilters = params.q || params.status !== "all" || params.province;
  const sortValue = `${params.sort}:${params.dir}`;
  const tiles = [
    { key: "all", label: "Todos", value: kpis?.all },
    { key: "new", label: "Nuevos", value: kpis?.new, hint: "Últimos 30 días" },
    { key: "recent", label: "Con acceso", value: kpis?.recent, hint: "Últimos 30 días" },
    { key: "buyers", label: "Con pedidos", value: kpis?.buyers },
    { key: "nobuyers", label: "Sin pedidos", value: kpis?.nobuyers },
    { key: "reporters", label: "Con reportes", value: kpis?.reporters, tone: "warn" },
    { key: "suspended", label: "Suspendidos", value: kpis?.suspended, tone: "danger" },
  ];
  const onSort = (sort, dir) => setParams({ sort, dir });

  return (
    <div className="max-w-[1180px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Users} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Clientes</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">Compradores registrados. Usa los contadores para filtrar; en cada fila puedes editar, suspender o eliminar la cuenta.</p>

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
        <SearchField value={searchText} onChange={setSearchText} placeholder="Buscar por nombre, correo o teléfono" className="sm:col-span-2 lg:col-span-1" />
        <select
          value={params.province}
          onChange={(e) => setParams({ province: e.target.value })}
          aria-label="Filtrar por provincia"
          className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] md:h-10"
        >
          <option value="">Todas las provincias</option>
          {provinces?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={sortValue}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":");
            setParams({ sort, dir });
          }}
          aria-label="Ordenar clientes"
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

      <div className={`${CARD} transition-opacity ${isFetching && !isLoading ? "opacity-70" : ""}`}>
        <div className={`hidden rounded-t-2xl border-b border-surface-container bg-surface-container/50 px-4 py-2 ${ROW_GRID}`}>
          <SortHeader label="Cliente" sortKey="name" sort={params.sort} dir={params.dir} onSort={(s, d) => onSort(s, s === "name" && d === "desc" ? "asc" : d)} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-outline">Provincia</span>
          <SortHeader label="Pedidos" sortKey="orders" sort={params.sort} dir={params.dir} onSort={onSort} align="right" />
          <SortHeader label="Acceso" sortKey="lastLogin" sort={params.sort} dir={params.dir} onSort={onSort} />
          <SortHeader label="Registro" sortKey="recent" sort={params.sort} dir={params.dir} onSort={onSort} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-outline">Estado</span>
          <span />
        </div>

        {isLoading && <RowSkeletons />}

        {isError && !data && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-body-md text-error">No se pudo cargar la lista de clientes.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {data?.customers.map((c) => (
          <CustomerRow
            key={c.id}
            c={c}
            onEdit={() => setEditing(c)}
            onSuspend={() => setSuspending(c)}
            onReactivate={() => toggle.mutate({ id: c.id, isSuspended: false })}
            onDelete={() => setDeleting(c)}
          />
        ))}

        {data && data.customers.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Users className="h-6 w-6 text-outline" />
            <p className="text-body-md text-on-surface-variant">{hasFilters ? "Ningún cliente coincide con estos filtros." : "Todavía no hay clientes registrados."}</p>
            {hasFilters && (
              <Button variant="outline" onClick={() => setParams({ q: "", status: "all", province: "" })}>
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
          noun="clientes"
        />
      )}

      {editing && (
        <EditCustomerModal
          customer={editing}
          saving={update.isPending}
          onCancel={() => setEditing(null)}
          // Bloque 196: mutateAsync (misma mutación `update`, solo la
          // variante que devuelve una promesa) — hace falta para que
          // useDirtyModal (dentro de EditCustomerModal) pueda esperar a que
          // el guardado realmente termine antes de cerrar el modal.
          onSave={(form) => update.mutateAsync({ id: editing.id, payload: form })}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`¿Eliminar a "${deleting.fullName ?? deleting.email}"?`}
          description="La cuenta no podrá volver a iniciar sesión. Sus pedidos históricos se conservan íntegros en los reportes."
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      )}

      <ConfirmModal
        open={!!suspending}
        title={`¿Suspender a "${suspending?.fullName ?? suspending?.email}"?`}
        message="La cuenta no va a poder iniciar sesión hasta que la reactives."
        confirmLabel={toggle.isPending ? "Suspendiendo..." : "Sí, suspender"}
        danger
        onConfirm={() => toggle.mutate({ id: suspending.id, isSuspended: true })}
        onCancel={() => setSuspending(null)}
      />
    </div>
  );
}
