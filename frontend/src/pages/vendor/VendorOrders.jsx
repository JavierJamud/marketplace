import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, Mail, CheckCircle2, XCircle, Pencil, Trash2, FileText, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { waLink } from "../../lib/whatsapp.js";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { EditOrderModal } from "../../components/EditOrderModal.jsx";
import { StockRiskModal } from "../../components/StockRiskModal.jsx";
import { DocumentModal } from "../../components/DocumentModal.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 29: NEW pasa a mostrarse como "Pendiente" (todavía no se descontó
// stock real, ver orders.controller.js) y PREPARING como "Vendido" (recién
// ahí se confirmó la venta y se descontó stock de verdad) — READY/DELIVERED
// siguen siendo pasos de logística POSTERIORES a la venta ya confirmada.
const STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Rechazado" };
const STATUS_COLOR = { NEW: "#8A5100", PREPARING: "#0A8F42", READY: "#337475", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };
const CHANNEL_COLOR = { CASH: "#128C7E", COD: "#337475", ONLINE: "#003435", TABLE: "#8A5100" };
// Distinto del método de pago (CHANNEL_LABEL de arriba): esto es a dónde le
// llegó el AVISO del pedido al vendedor, según su preferencia en Configuración.
const NOTIFICATION_LABEL = { WHATSAPP: "Aviso por WhatsApp", PANEL: "Aviso por Panel" };
// Bloque 29: NEW ya no está acá — la única forma de pasar de Pendiente a
// Vendido es la acción dedicada "Confirmar venta" (descuenta stock real),
// nunca este loop genérico de transiciones (ver botones dedicados más abajo).
const ORDER_TRANSITIONS = { PREPARING: ["READY", "DELIVERED", "CANCELLED"], READY: ["DELIVERED"], DELIVERED: [], CANCELLED: [] };
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
  if (o.isTable) return o.status === "RECEIVED" ? "NEW" : "SOLD";
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
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
              placeholder="Escribí el mensaje para tu cliente..."
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
    </div>
  );
}

export default function VendorOrders() {
  const queryClient = useQueryClient();
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailTarget, setEmailTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [docTarget, setDocTarget] = useState(null);
  const [stockRisk, setStockRisk] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: async () => (await api.get("/orders/me")).data,
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

  const invalidateOrders = () => queryClient.invalidateQueries({ queryKey: ["my-orders"] });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/orders/${id}/status`, { status })).data,
    onSuccess: invalidateOrders,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
  });

  const updateKitchen = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/tables/orders/${id}/status`, { status })).data,
    onSuccess: invalidateOrders,
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el pedido."),
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
      toast.success("Venta confirmada — stock actualizado.");
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

  function handleNotifyFromRisk(riskOrder) {
    const productNames = riskOrder.items.map((i) => i.name).join(", ");
    setStockRisk(null);
    setEmailTarget({
      rawId: riskOrder.orderId,
      id: riskOrder.code,
      customer: riskOrder.customerName ?? "Cliente",
      customerEmail: riskOrder.customerEmail,
      defaultSubject: `Sobre tu pedido ${riskOrder.code}`,
      defaultMessage: `Hola${riskOrder.customerName ? ` ${riskOrder.customerName}` : ""}, te escribimos porque ${productNames} se agotó y por ahora no podemos completar tu pedido ${riskOrder.code}. Te avisamos apenas repongamos stock — si preferís, contanos y vemos una alternativa.`,
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
      rawId: o.id,
      raw: o,
    })),
    ...(data?.tableOrders ?? []).map((t) => ({
      key: `table-${t.id}`,
      id: `Mesa ${t.table.tableNumber}`,
      customer: `Mesa ${t.table.tableNumber}`,
      date: t.createdAt,
      channel: "TABLE",
      total: t.total,
      isTable: true,
      status: t.kitchenStatus,
      clearedAt: t.clearedAt,
      rawId: t.id,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const filtered = merged
    .filter((o) => channelFilter === "all" || o.channel === channelFilter)
    .filter((o) => statusFilter === "all" || statusBucket(o) === statusFilter);
  const atEmailLimit = emailUsage && !emailUsage.unlimited && emailUsage.used >= emailUsage.limit;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Pedidos</h1>
          <p className="text-[13.5px] text-outline">Gestioná pedidos de WhatsApp, contra entrega y de mesa (cocina).</p>
        </div>
        {emailUsage && (
          <div
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold"
            style={
              emailUsage.unlimited
                ? { background: "rgba(12,174,83,0.1)", color: "#0A8F42" }
                : atEmailLimit
                ? { background: "rgba(186,26,26,0.1)", color: "#ba1a1a" }
                : { background: "rgba(51,116,117,0.1)", color: "#337475" }
            }
          >
            {emailUsage.unlimited ? "✉️ Emails manuales: ilimitado (Business)" : `✉️ Emails manuales: ${emailUsage.used}/${emailUsage.limit} usados este mes`}
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
          return (
            <div key={o.key} className="flex flex-wrap items-center gap-[18px] rounded-md border border-surface-container-high bg-surface-container-lowest px-5 py-4">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold text-on-surface">{o.id}</span>
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
                </div>
              </div>
              <div className="text-[15px] font-bold text-on-surface">{fmtCUP(o.total)}</div>

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
                  href={waLink(o.customerPhone, `Hola ${o.customer}, te escribo por tu pedido ${o.id} en ZeuDin.`)}
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

              {o.isTable ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {KITCHEN_STEPS.map((step, i) => {
                    const isCurrent = i === kIndex;
                    const isNext = i === kIndex + 1;
                    return (
                      <button
                        key={step}
                        disabled={!isNext}
                        onClick={() => updateKitchen.mutate({ id: o.rawId, status: step })}
                        className={`rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-bold ${
                          isCurrent ? "bg-primary text-white" : isNext ? "bg-surface-container text-on-surface-variant hover:bg-secondary-container hover:text-on-secondary-container" : "cursor-not-allowed bg-surface-container text-outline/50"
                        }`}
                      >
                        {KITCHEN_LABEL[step]}
                      </button>
                    );
                  })}
                  {o.status === "READY" && !o.clearedAt && (
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
                </div>
              ) : o.status === "NEW" ? (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => confirmSale.mutate(o.rawId)}
                    disabled={confirmSale.isPending}
                    className="flex items-center gap-1.5 rounded-[7px] bg-[#0A8F42]/10 px-2.5 py-1.5 text-[11.5px] font-bold text-[#0A8F42] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar venta
                  </button>
                  <button
                    onClick={() => updateStatus.mutate({ id: o.rawId, status: "CANCELLED" })}
                    disabled={updateStatus.isPending}
                    className="flex items-center gap-1.5 rounded-[7px] bg-error/10 px-2.5 py-1.5 text-[11.5px] font-bold text-error disabled:opacity-50"
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
    </div>
  );
}
