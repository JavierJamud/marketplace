import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { MessageCircle, Mail, CheckCircle2, XCircle, Pencil, Trash2, FileText, ShieldCheck, Eye, ShoppingCart } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { formatElapsed } from "../../lib/duration.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { waLink } from "../../lib/whatsapp.js";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { UnsavedChangesModal } from "../../components/UnsavedChangesModal.jsx";
import { useDirtyModal } from "../../lib/useDirtyModal.js";
import { EditOrderModal } from "../../components/EditOrderModal.jsx";
import { EditTableOrderModal } from "../../components/EditTableOrderModal.jsx";
import { StockRiskModal } from "../../components/StockRiskModal.jsx";
import { DocumentModal } from "../../components/DocumentModal.jsx";
import { TableOrderDetailModal } from "../../components/vendor/TableOrderDetailModal.jsx";
import { OrderDetailModal } from "../../components/vendor/OrderDetailModal.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 29: NEW pasa a mostrarse como "Pendiente" (todavía no se descontó
// stock real, ver orders.controller.js) y PREPARING como "Vendido" (recién
// ahí se confirmó la venta y se descontó stock de verdad) — READY/DELIVERED
// siguen siendo pasos de logística POSTERIORES a la venta ya confirmada.
const STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };
const STATUS_COLOR = { NEW: "#8A5100", PREPARING: "#0A8F42", READY: "#337475", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };
const CHANNEL_COLOR = { CASH: "#128C7E", COD: "#337475", ONLINE: "#003435", TABLE: "#8A5100" };
// Distinto del método de pago (CHANNEL_LABEL de arriba): esto es a dónde le
// llegó el AVISO del pedido al vendedor, según su preferencia en Configuración.
const NOTIFICATION_LABEL = { WHATSAPP: "Aviso por WhatsApp", PANEL: "Aviso por Panel" };
// Bloque 29: NEW ya no está acá — la única forma de pasar de Pendiente a
// Vendido es la acción dedicada "Confirmar pedido" (Bloque 231, antes decía
// "Confirmar venta" — descuenta stock real), nunca este loop genérico de
// transiciones (ver botones dedicados más abajo).
// Bloque 197: "CANCELLED" ya NO sale de acá — ahora tiene su propio botón
// dedicado ("Anular pedido", más abajo) que exige un motivo antes de
// mandarlo; dejarlo acá disparaba updateStatus sin motivo, que el backend
// ahora rechaza (ver updateOrderStatus, orders.controller.js).
const ORDER_TRANSITIONS = { PREPARING: ["READY", "DELIVERED"], READY: ["DELIVERED"], DELIVERED: [], CANCELLED: [] };
const KITCHEN_STEPS = ["RECEIVED", "PREPARING", "READY"];
const KITCHEN_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo" };

const CHANNEL_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "TABLE", label: "Mesa" },
  { id: "CASH", label: "Efectivo" },
  { id: "COD", label: "Contra entrega" },
  { id: "ONLINE", label: "En línea" },
];

// Bloque 29: "Vendidos" agrupa PREPARING/READY/DELIVERED (cualquier estado
// donde el stock YA se descontó de verdad) — separado del filtro por canal
// de arriba, que es otra dimensión (cómo paga, no en qué etapa está).
const STATUS_FILTERS = [
  { id: "all", label: "Todos los estados" },
  { id: "NEW", label: "Pendientes" },
  { id: "SOLD", label: "Vendidos" },
  { id: "CANCELLED", label: "Rechazados" },
];
function statusBucket(o) {
  // Bloque 167: un pedido de mesa cancelado se queda en kitchenStatus
  // RECEIVED para siempre (nunca avanzó) — sin este chequeo primero,
  // bucketeaba como "Pendientes" en vez de "Rechazados".
  if (o.isTable) return o.cancelledAt ? "CANCELLED" : o.status === "RECEIVED" ? "NEW" : "SOLD";
  if (o.status === "NEW") return "NEW";
  if (o.status === "CANCELLED") return "CANCELLED";
  return "SOLD";
}

// Cambia de estado automáticamente por email cada vez que el vendedor mueve
// el pedido (ver backend) — este modal es solo para el envío manual, con
// límite mensual en Plan Regular (ilimitado en Business). Bloque 29: acepta
// defaultSubject/defaultMessage precargados desde el aviso de "sin stock"
// (ver StockRiskModal) — sin eso, cae al asunto/mensaje en blanco de siempre.
function EmailModal({ order, onClose, onSent }) {
  const [subject, setSubject] = useState(order.defaultSubject ?? `Sobre tu pedido ${order.id}`);
  const [message, setMessage] = useState(order.defaultMessage ?? "");

  const send = useMutation({
    mutationFn: async () => (await api.post(`/orders/${order.rawId}/email`, { subject, message })).data,
    onSuccess: () => {
      toast.success(`Email enviado a ${order.customerEmail}`);
      onSent();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el correo."),
  });

  // Bloque 196: snapshot del borrador (asunto/mensaje) con el que se abrió
  // este modal.
  const initialFormSnapshot = useRef(JSON.stringify({ subject, message }));
  const isDirty = JSON.stringify({ subject, message }) !== initialFormSnapshot.current;
  const canSaveNow = !!subject.trim() && !!message.trim();
  const dirtyModal = useDirtyModal({ isDirty, onClose, onSave: canSaveNow ? () => send.mutateAsync() : undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={dirtyModal.handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-lg bg-surface-container-lowest p-6">
        <h3 className="mb-1 text-title-lg text-on-surface">Enviar email al cliente</h3>
        <p className="mb-4 text-[12.5px] text-outline">Para {order.customer} · {order.customerEmail} · pedido {order.id}</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-label-sm text-on-surface-variant">Asunto</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-label-sm text-on-surface-variant">Mensaje</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe el mensaje para tu cliente..."
              className="min-h-[110px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={send.isPending || !subject.trim() || !message.trim()} onClick={() => send.mutate()}>
            {send.isPending ? "Enviando..." : "Enviar"}
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

export default function VendorOrders() {
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailTarget, setEmailTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editTableTarget, setEditTableTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Bloque 197 (pedido explícito — "quiero poder agregar una función para
  // eliminar pedido, eso [en realidad] no elimina el pedido, lo marca como
  // tachado... esto se puede hacer para pedidos erróneos"): un solo estado
  // para las 2 formas de "anular con motivo" (Rechazar un pedido normal
  // todavía NEW, y Anular cualquier pedido ya vendido/de mesa) — reemplaza
  // el viejo rejectTarget, que nunca pedía motivo.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [docTarget, setDocTarget] = useState(null);
  const [stockRisk, setStockRisk] = useState(null);
  const [viewTarget, setViewTarget] = useState(null);
  // Bloque 164 (pedido explícito — "debe mostrar... qué tiempo lleva el
  // cliente en mesa"): fuerza un re-render cada 30s para que el texto de
  // tiempo transcurrido de los pedidos de mesa siga corriendo solo.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders/me")).data,
    // Bloque 168: mismo criterio que VendorTables.jsx — estados en tiempo
    // real sin depender de que este vendedor haga una acción propia para
    // refrescar.
    refetchInterval: 8000,
  });

  // Solo se usa para precargar warrantyDefaultDays en DocumentModal — mismo
  // queryKey que VendorSettings.jsx así React Query comparte el cache.
  const { data: vendor } = useQuery({
    queryKey: ["my-vendor-settings"],
    queryFn: async () => (await api.get("/vendors/me")).data.vendor,
  });

  const { data: emailUsage } = useQuery({
    queryKey: ["email-usage"],
    queryFn: async () => (await api.get("/orders/me/email-usage")).data,
  });

  // Bloque 180 (bug real reportado en vivo — "cuando hago clic en ver
  // pedido luego de entregado no me sale el botón de cobrar... no se
  // actualizó en tiempo real y me permitía seguir agregando productos"):
  // antes esto solo invalidaba "my-orders" (la lista de acá) — el modal
  // "Ver pedido" (TableOrderDetailModal) lee su propio
  // ["table-order-status", orderId], que NUNCA se invalidaba desde estos
  // botones inline (Listo/Entregado/Cobrar). Resultado: el modal servía
  // datos viejos de React Query (cacheados de una apertura anterior) hasta
  // que su propio polling de 5s lo corregía solo — mientras tanto, el
  // vendedor veía un pedido "Preparando" que en realidad ya estaba Listo,
  // sin el botón correcto, o seguía dejando agregar consumo a una cuenta
  // que ya se había cobrado y liberado. Sin el id exacto acá (esta lista
  // actúa sobre CUALQUIER pedido), se invalida la key SIN el segundo
  // elemento — React Query invalida por prefijo, así que esto alcanza a
  // TODOS los ["table-order-status", <cualquier id>] de una sola vez.
  const invalidateOrders = () => {
    queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-status"] });
    queryClient.invalidateQueries({ queryKey: ["table-order-activity"] });
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }) => (await api.patch(`/orders/${id}/status`, { status, reason })).data,
    onSuccess: invalidateOrders,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
  });

  // Bloque 197: mismo criterio que cancelTableOrder en NewOrderPopup.jsx —
  // PATCH con motivo obligatorio, nunca un DELETE. Cubre las 2 formas de
  // "anular" (regular: updateStatus con status CANCELLED; mesa: endpoint
  // propio) bajo una sola mutación, ya que el modal de abajo es compartido.
  const voidOrder = useMutation({
    mutationFn: async ({ isTable, id, reason }) =>
      isTable
        ? (await api.patch(`/tables/orders/${id}/cancel`, { reason })).data
        : (await api.patch(`/orders/${id}/status`, { status: "CANCELLED", reason })).data,
    onSuccess: () => {
      toast.success("Pedido anulado — no cuenta como venta ni descuenta inventario.");
      setCancelTarget(null);
      setCancelReason("");
      invalidateOrders();
      // Por si la anulación liberó una mesa (cuenta no cleared todavía).
      queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo anular el pedido."),
  });

  const updateKitchen = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/tables/orders/${id}/status`, { status })).data,
    onSuccess: invalidateOrders,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
  });

  // Bloque 163 (pedido explícito): momento DISTINTO de "liberar mesa" (más
  // abajo) — este es el que de verdad desbloquea la mesa para pedidos
  // nuevos de otro dispositivo (ver createTableOrder/getTableByToken,
  // backend). "Liberar mesa" sigue siendo un paso aparte, más adelante
  // (cliente ya pagó y se fue).
  const markDelivered = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/delivered`)).data,
    onSuccess: invalidateOrders,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo marcar como entregado."),
  });

  // El cliente ya pagó y se retiró — recién acá se libera la mesa de
  // verdad en VendorTables.jsx (antes se liberaba sola al llegar a Listo).
  // Invalida también "my-tables", no solo "my-orders" — es la query que
  // usa esa otra página.
  const clearTable = useMutation({
    mutationFn: async (id) => (await api.patch(`/tables/orders/${id}/clear`)).data,
    onSuccess: () => {
      invalidateOrders();
      queryClient.invalidateQueries({ queryKey: ["my-tables"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo liberar la mesa."),
  });

  // Bloque 29: única forma de pasar un pedido de Pendiente a Vendido — acá,
  // y no en updateStatus, se descuenta el stock real. Si el backend detecta
  // que otro pedido Pendiente del mismo producto quedó sin alcance, lo
  // devuelve en atRiskOrders y se abre el aviso para decidir qué hacer.
  const confirmSale = useMutation({
    mutationFn: async (id) => (await api.post(`/orders/${id}/confirm`)).data,
    onSuccess: (data) => {
      toast.success("Pedido confirmado, stock actualizado.");
      invalidateOrders();
      if (data.atRiskOrders?.length > 0) setStockRisk(data.atRiskOrders);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo confirmar la venta."),
  });

  const deleteOrder = useMutation({
    mutationFn: async (id) => api.delete(`/orders/${id}`),
    onSuccess: () => {
      toast.success("Pedido eliminado.");
      setDeleteTarget(null);
      invalidateOrders();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el pedido.");
      setDeleteTarget(null);
    },
  });

  // Bloque 175 (pedido explícito — barra de búsqueda global): un resultado
  // de pedido en VendorSearchBar.jsx navega para acá con
  // ?ver=<id>&tipo=orden|mesa — apenas la lista de pedidos está cargada,
  // esto abre el mismo modal "Ver pedido" que un click manual, y limpia la
  // URL para que un F5/volver atrás no lo vuelva a abrir solo.
  useEffect(() => {
    const ver = searchParams.get("ver");
    const tipo = searchParams.get("tipo");
    if (!ver || !data) return;
    if (tipo === "mesa") {
      const t = data.tableOrders?.find((x) => x.id === ver);
      if (t) setViewTarget({ isTable: true, rawId: t.id, tableLabel: t.table.label || `Mesa ${t.table.tableNumber}` });
    } else {
      const o = data.orders?.find((x) => x.id === ver);
      if (o) setViewTarget({ isTable: false, raw: o });
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("ver");
      next.delete("tipo");
      return next;
    }, { replace: true });
  }, [data, searchParams, setSearchParams]);

  function handleNotifyFromRisk(riskOrder) {
    const productNames = riskOrder.items.map((i) => i.name).join(", ");
    setStockRisk(null);
    setEmailTarget({
      rawId: riskOrder.orderId,
      id: riskOrder.code,
      customer: riskOrder.customerName ?? "Cliente",
      customerEmail: riskOrder.customerEmail,
      defaultSubject: `Sobre tu pedido ${riskOrder.code}`,
      defaultMessage: `Hola${riskOrder.customerName ? ` ${riskOrder.customerName}` : ""}, te escribimos porque ${productNames} se agotó y por ahora no podemos completar tu pedido ${riskOrder.code}. Te avisamos apenas repongamos stock — si prefieres, cuéntanos y vemos una alternativa.`,
    });
  }

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando pedidos...</p>;

  const merged = [
    ...(data?.orders ?? []).map((o) => ({
      key: `order-${o.id}`,
      id: o.code,
      customer: o.customerName ?? "Cliente",
      customerPhone: o.customerPhone,
      customerEmail: o.customerEmail,
      date: o.createdAt,
      channel: o.channel,
      notificationChannel: o.notificationChannel,
      total: o.total,
      isTable: false,
      status: o.status,
      cancelReason: o.cancelReason,
      rawId: o.id,
      raw: o,
    })),
    ...(data?.tableOrders ?? []).map((t) => ({
      key: `table-${t.id}`,
      id: t.table.label || `Mesa ${t.table.tableNumber}`,
      // Bloque 175 (pedido explícito — "cada pedido debe decir mesa y el
      // número de la mesa al lado del pedido, y el número de pedido único
      // para cada pedido — con ese número podremos buscar los pedidos"):
      // orderNumber (TableOrder.orderNumber, autoincrement global) ya
      // existía en el backend pero nunca se traía hasta acá.
      orderNumber: t.orderNumber,
      tableLabel: t.table.label || `Mesa ${t.table.tableNumber}`,
      // Bloque 141: antes mostraba solo "Mesa N" acá — ahora suma el
      // nombre real que dejó el cliente (customerName, nuevo) para que el
      // vendedor sepa a quién buscar/verificarle el pedido en la mesa.
      customer: t.customerName ? `${t.table.label || `Mesa ${t.table.tableNumber}`} · ${t.customerName}` : t.table.label || `Mesa ${t.table.tableNumber}`,
      date: t.createdAt,
      channel: "TABLE",
      total: t.total,
      isTable: true,
      status: t.kitchenStatus,
      clearedAt: t.clearedAt,
      deliveredAt: t.deliveredAt,
      cancelledAt: t.cancelledAt,
      cancelReason: t.cancelReason,
      rawId: t.id,
      raw: t,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const filtered = merged
    .filter((o) => channelFilter === "all" || o.channel === channelFilter)
    .filter((o) => statusFilter === "all" || statusBucket(o) === statusFilter);
  const atEmailLimit = emailUsage && !emailUsage.unlimited && emailUsage.used >= emailUsage.limit;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconCircle icon={ShoppingCart} tone="green" />
          <div>
            <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-tight text-on-surface">Pedidos</h1>
            <p className="text-[13.5px] text-outline">Gestiona pedidos de WhatsApp, contra entrega y de mesa (cocina).</p>
          </div>
        </div>
        {/* Bloque 224 (pedido explícito, con captura — "eso de Emails
            manuales: ilimitado (Business) está por gusto ahí"): con Plan
            Business no hay ningún límite que vigilar, así que un badge fijo
            que siempre dice "ilimitado" no le sirve a nadie — se saca por
            completo. Con Plan Regular sí hay un cupo real que se puede
            agotar, ahí el badge se queda (incluida la alerta roja al llegar
            al límite). */}
        {emailUsage && !emailUsage.unlimited && (
          <div
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold"
            style={
              atEmailLimit
                ? { background: "rgba(186,26,26,0.1)", color: "#ba1a1a" }
                : { background: "rgba(51,116,117,0.1)", color: "#337475" }
            }
          >
            {`✉️ Emails manuales: ${emailUsage.used}/${emailUsage.limit} usados este mes`}
          </div>
        )}
      </div>

      <div className="mb-2.5 flex flex-wrap gap-2">
        {CHANNEL_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setChannelFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              channelFilter === f.id ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              statusFilter === f.id ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && <p className="text-body-md text-on-surface-variant">No hay pedidos en este filtro.</p>}
        {filtered.map((o) => {
          const kIndex = o.isTable ? KITCHEN_STEPS.indexOf(o.status) : -1;
          const isSold = !o.isTable && o.status !== "NEW" && o.status !== "CANCELLED";
          // Bloque 197 (pedido explícito — "una función para eliminar
          // pedido... lo marca como tachado"): un solo booleano para las 2
          // formas de "anulado" que existen (TableOrder.cancelledAt vs
          // Order.status === CANCELLED) — controla el tachado del título y
          // el precio más abajo.
          const isVoided = o.isTable ? !!o.cancelledAt : o.status === "CANCELLED";
          return (
            <div key={o.key} className="flex flex-wrap items-center gap-[18px] rounded-md border border-surface-container-high bg-surface-container-lowest px-5 py-4">
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Bloque 175 (pedido explícito): "Mesa" + su número quedan
                      siempre visibles, con el número de pedido único al
                      lado — el mismo con el que se busca en la barra de
                      búsqueda del panel. */}
                  {o.isTable ? (
                    <>
                      <span className={`text-[14px] font-bold text-on-surface ${isVoided ? "line-through opacity-60" : ""}`}>{o.tableLabel}</span>
                      <span className="text-[12.5px] font-semibold text-outline">· Pedido #{o.orderNumber}</span>
                    </>
                  ) : (
                    <span className={`text-[14px] font-bold text-on-surface ${isVoided ? "line-through opacity-60" : ""}`}>{o.id}</span>
                  )}
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
                    style={{ background: `${CHANNEL_COLOR[o.channel]}1a`, color: CHANNEL_COLOR[o.channel] }}
                  >
                    {CHANNEL_LABEL[o.channel]}
                  </span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-outline">
                  {o.customer} · {new Date(o.date).toLocaleString("es-CU")}
                  {!o.isTable && o.notificationChannel && ` · ${NOTIFICATION_LABEL[o.notificationChannel]}`}
                  {/* Bloque 164 (pedido explícito): cuánto tiempo lleva el
                      cliente en la mesa desde que hizo el pedido — sigue
                      corriendo mientras la mesa no se libere; una vez
                      liberada (clearedAt), muestra cuánto duró en total en
                      vez de seguir contando. */}
                  {o.isTable && ` · ${o.clearedAt ? `Duró ${formatElapsed(o.date, o.clearedAt)}` : `En mesa hace ${formatElapsed(o.date)}`}`}
                </div>
              </div>
              <div className={`text-[15px] font-bold text-on-surface ${isVoided ? "line-through opacity-60" : ""}`}>{fmtCUP(o.total)}</div>

              {/* Bloque 175 (pedido explícito — "habrá un botón en cada
                  pedido para ver pedido y ver los detalles de cada pedido
                  y registro en ese pedido en esa mesa"): mismo modal que
                  usa VendorTables.jsx para un pedido de mesa (garantiza
                  información idéntica entre las 2 secciones); para un
                  pedido normal, un modal propio con lo mismo que ya
                  carga esta lista (o.raw ya trae items). */}
              <button
                onClick={() => setViewTarget(o)}
                className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant hover:bg-surface-container-high"
              >
                <Eye className="h-3.5 w-3.5" /> Ver pedido
              </button>

              {!o.isTable && (
                <span
                  className="rounded-full px-3 py-1.5 text-[11.5px] font-bold"
                  style={{ background: `${STATUS_COLOR[o.status]}1f`, color: STATUS_COLOR[o.status] }}
                >
                  {STATUS_LABEL[o.status]}
                </span>
              )}

              {!o.isTable && o.customerPhone && (
                <a
                  href={waLink(o.customerPhone, `Hola ${o.customer}, te escribo por tu pedido ${o.id} en ${siteName}.`)}
                  target="_blank"
                  rel="noreferrer"
                  title="Contactar cliente por WhatsApp"
                  className="flex items-center gap-1.5 rounded-[7px] bg-[#25D366]/10 px-2.5 py-1.5 text-[11.5px] font-bold text-[#128C7E]"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Contactar cliente
                </a>
              )}

              {!o.isTable && o.customerEmail && (
                <button
                  onClick={() => (atEmailLimit ? toast.error("Alcanzaste el límite de emails manuales del Plan Regular este mes.") : setEmailTarget(o))}
                  title="Enviar email al cliente"
                  className="flex items-center gap-1.5 rounded-[7px] bg-tertiary-accent/10 px-2.5 py-1.5 text-[11.5px] font-bold text-tertiary-accent"
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
              )}

              {/* Bloque 167 (pedido explícito — "no se debe borrar del
                  todo, siempre los movimientos deben quedar
                  registrados... quedará registrado en el panel del
                  vendedor"): un pedido cancelado ya no tiene ningún botón
                  de acción — solo el aviso con el motivo, tal cual quedó
                  guardado al cancelarlo. */}
              {o.isTable && o.cancelledAt ? (
                <div className="flex max-w-[280px] flex-col gap-0.5 rounded-[7px] bg-error/10 px-2.5 py-1.5">
                  <span className="text-[11.5px] font-bold text-error">Cancelado</span>
                  {o.cancelReason && <span className="text-[11px] text-error/80">{o.cancelReason}</span>}
                </div>
              ) : o.isTable ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {KITCHEN_STEPS.map((step, i) => {
                    const isCurrent = i === kIndex;
                    const isNext = i === kIndex + 1;
                    // Bloque 141 (pedido explícito — "antes de preparar el
                    // pedido, que vayan y verifiquen en la mesa que el
                    // cliente sí quiere ese pedido"): RECEIVED->PREPARING
                    // es literalmente ese momento de confirmación — el
                    // tooltip lo deja explícito en vez de ser un botón más
                    // sin contexto.
                    const isConfirmStep = isNext && step === "PREPARING" && o.status === "RECEIVED";
                    return (
                      <button
                        key={step}
                        disabled={!isNext}
                        onClick={() => updateKitchen.mutate({ id: o.rawId, status: step })}
                        title={isConfirmStep ? "Verificá con el cliente en la mesa que el pedido es correcto antes de aceptarlo" : undefined}
                        className={`rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-bold ${
                          isCurrent ? "bg-primary text-white" : isNext ? "bg-surface-container text-on-surface-variant hover:bg-secondary-container hover:text-on-secondary-container" : "cursor-not-allowed bg-surface-container text-outline/50"
                        }`}
                      >
                        {isConfirmStep ? "Verificar y aceptar" : KITCHEN_LABEL[step]}
                      </button>
                    );
                  })}
                  {/* Bloque 158 (pedido explícito): mismo criterio que
                      "Modificar" de un pedido normal — solo mientras sigue
                      Recibido (updateTableOrderItems, backend, rechaza esto
                      pasado ese punto: ya se descontó stock real). */}
                  {o.status === "RECEIVED" && (
                    <button
                      onClick={() => setEditTableTarget(o.raw)}
                      className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Modificar
                    </button>
                  )}
                  {/* Bloque 163 (pedido explícito): paso propio, ANTES de
                      liberar la mesa — este es el que de verdad desbloquea
                      la mesa para que otra persona del mismo grupo pida
                      algo más (ver createTableOrder/getTableByToken). */}
                  {o.status === "READY" && !o.deliveredAt && (
                    <button
                      onClick={() => markDelivered.mutate(o.rawId)}
                      disabled={markDelivered.isPending}
                      title="El pedido ya le llegó a la mesa — desbloquea la mesa para pedidos nuevos"
                      className="rounded-[7px] bg-primary-container/10 px-2.5 py-1.5 text-[11.5px] font-bold text-primary-container disabled:opacity-50"
                    >
                      Marcar como entregado
                    </button>
                  )}
                  {o.deliveredAt && !o.clearedAt && (
                    <button
                      onClick={() => clearTable.mutate(o.rawId)}
                      disabled={clearTable.isPending}
                      title="El cliente ya pagó y se retiró — libera la mesa"
                      className="rounded-[7px] bg-verified/10 px-2.5 py-1.5 text-[11.5px] font-bold text-verified-dark disabled:opacity-50"
                    >
                      Marcar pagado y liberar mesa
                    </button>
                  )}
                  {o.clearedAt && (
                    <span className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-outline">Mesa liberada</span>
                  )}
                  {/* Bloque 197 (pedido explícito — "una función para
                      eliminar pedido... esto se puede hacer para pedidos
                      erróneos"): disponible en cualquier punto ANTES de
                      cobrada/liberada (clearedAt) — a diferencia del resto
                      de los botones de acá, no depende del kitchenStatus
                      actual, porque un pedido erróneo puede notarse recién
                      después de marcarlo Listo o Entregado. */}
                  {!o.clearedAt && (
                    <button
                      onClick={() => setCancelTarget(o)}
                      title="Anula el pedido — no cuenta como venta ni descuenta inventario, y libera la mesa"
                      className="flex items-center gap-1.5 rounded-[7px] bg-error/10 px-2.5 py-1.5 text-[11.5px] font-bold text-error"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Anular pedido
                    </button>
                  )}
                </div>
              ) : o.status === "NEW" ? (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => confirmSale.mutate(o.rawId)}
                    disabled={confirmSale.isPending}
                    className="flex items-center gap-1.5 rounded-[7px] bg-[#0A8F42]/10 px-2.5 py-1.5 text-[11.5px] font-bold text-[#0A8F42] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar pedido
                  </button>
                  <button
                    onClick={() => setCancelTarget(o)}
                    className="flex items-center gap-1.5 rounded-[7px] bg-error/10 px-2.5 py-1.5 text-[11.5px] font-bold text-error"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Rechazar
                  </button>
                  <button
                    onClick={() => setEditTarget(o.raw)}
                    className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Modificar
                  </button>
                  <button
                    onClick={() => setDeleteTarget(o)}
                    className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </div>
              ) : o.status === "CANCELLED" ? (
                // Bloque 197: mismo tratamiento que un pedido de mesa
                // cancelado (arriba) — solo el aviso con el motivo, sin
                // ningún botón de acción (es un estado terminal).
                <div className="flex max-w-[280px] flex-col gap-0.5 rounded-[7px] bg-error/10 px-2.5 py-1.5">
                  <span className="text-[11.5px] font-bold text-error">Anulado</span>
                  {o.cancelReason && <span className="text-[11px] text-error/80">{o.cancelReason}</span>}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {isSold && (
                    <>
                      <button
                        onClick={() => setDocTarget({ kind: "invoice", order: o.raw })}
                        className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
                      >
                        <FileText className="h-3.5 w-3.5" /> Factura
                      </button>
                      <button
                        onClick={() => setDocTarget({ kind: "warranty", order: o.raw })}
                        className="flex items-center gap-1.5 rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Garantía
                      </button>
                    </>
                  )}
                  {ORDER_TRANSITIONS[o.status]?.map((next) => (
                    <button
                      key={next}
                      onClick={() => updateStatus.mutate({ id: o.rawId, status: next })}
                      className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[11.5px] font-bold text-on-surface-variant hover:bg-secondary-container hover:text-on-secondary-container"
                    >
                      {STATUS_LABEL[next]}
                    </button>
                  ))}
                  {/* Bloque 197 (pedido explícito — "esto se puede hacer
                      para pedidos erróneos"): disponible para cualquier
                      pedido ya vendido (Vendido/Listo/Entregado) — antes
                      DELIVERED/READY eran terminales sin forma de corregir
                      un error notado tarde. */}
                  <button
                    onClick={() => setCancelTarget(o)}
                    title="Anula el pedido — no cuenta como venta ni descuenta inventario"
                    className="flex items-center gap-1.5 rounded-[7px] bg-error/10 px-2.5 py-1.5 text-[11.5px] font-bold text-error"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Anular pedido
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {emailTarget && (
        <EmailModal
          order={emailTarget}
          onClose={() => setEmailTarget(null)}
          onSent={() => {
            setEmailTarget(null);
            queryClient.invalidateQueries({ queryKey: ["email-usage"] });
          }}
        />
      )}

      {editTarget && (
        <EditOrderModal
          order={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            invalidateOrders();
          }}
        />
      )}

      {editTableTarget && (
        <EditTableOrderModal
          order={editTableTarget}
          onClose={() => setEditTableTarget(null)}
          onSaved={() => {
            setEditTableTarget(null);
            invalidateOrders();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar pedido ${deleteTarget.id}?`}
          description="El pedido todavía no fue confirmado, así que no hay stock que restituir."
          pending={deleteOrder.isPending}
          onConfirm={() => deleteOrder.mutate(deleteTarget.rawId)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {docTarget && (
        <DocumentModal kind={docTarget.kind} order={docTarget.order} vendor={vendor} onClose={() => setDocTarget(null)} />
      )}

      {stockRisk && <StockRiskModal atRiskOrders={stockRisk} onNotify={handleNotifyFromRisk} onClose={() => setStockRisk(null)} />}

      {viewTarget?.isTable && (
        <TableOrderDetailModal orderId={viewTarget.rawId} tableLabel={viewTarget.tableLabel} onClose={() => setViewTarget(null)} />
      )}
      {viewTarget && !viewTarget.isTable && <OrderDetailModal order={viewTarget} onClose={() => setViewTarget(null)} />}

      {/* Bloque 197 (pedido explícito — "quiero poder agregar una función
          para eliminar pedido, eso [en realidad] no elimina el pedido, lo
          marca como tachado... no marcará diferencia de ventas ni
          inventario... y si lo había hecho lo libera nuevamente, esto se
          puede hacer para pedidos erróneos"): un solo modal para las 3
          entradas (Rechazar un pedido NEW, Anular un pedido normal ya
          vendido, Anular un pedido de mesa en cualquier estado) — el motivo
          es SIEMPRE obligatorio, el backend lo exige igual. */}
      {cancelTarget && (
        <ConfirmModal
          open={!!cancelTarget}
          title={
            cancelTarget.isTable
              ? `¿Anular el pedido #${cancelTarget.orderNumber}?`
              : cancelTarget.status === "NEW"
              ? `¿Rechazar el pedido ${cancelTarget.id}?`
              : `¿Anular el pedido ${cancelTarget.id}?`
          }
          message={
            cancelTarget.isTable
              ? `Queda anulado y visible en tu historial de Pedidos — no cuenta como venta ni descuenta inventario, y libera la mesa. El cliente también va a ver este motivo.`
              : cancelTarget.status === "NEW"
              ? "El pedido pasa a Rechazado. Esta acción no se puede deshacer."
              : "Queda anulado y visible en tu historial de Pedidos — no cuenta como venta ni descuenta inventario. Esta acción no se puede deshacer."
          }
          confirmLabel={
            voidOrder.isPending
              ? "Anulando..."
              : !cancelTarget.isTable && cancelTarget.status === "NEW"
              ? "Sí, rechazar"
              : "Sí, anular"
          }
          danger
          confirmDisabled={cancelReason.trim().length < 3}
          onConfirm={() => voidOrder.mutate({ isTable: cancelTarget.isTable, id: cancelTarget.rawId, reason: cancelReason.trim() })}
          onCancel={() => {
            setCancelTarget(null);
            setCancelReason("");
          }}
        >
          {/* Bloque 231 (pedido explícito — "los bordes del motivo de
              anular pedido son muy redondeados... todo eso debe mantener
              los mismos estilos entre todas las secciones y paneles"):
              tenía rounded-full en un <textarea> de varias filas — mismo
              radio (rounded-lg) que usa este mismo motivo de cancelación en
              NewOrderPopup.jsx/ConfirmDeleteModal.jsx en el resto del sitio. */}
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Motivo (obligatorio) — ej. pedido duplicado, agotados, error al cargarlo..."
            rows={3}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] outline-none focus:border-primary-container"
          />
        </ConfirmModal>
      )}
    </div>
  );
}
