import { X } from "lucide-react";
import { orderTotalLabel, orderShippingText, orderLineShippingText } from "../../lib/shipping.js";
import { channelLabel } from "../../lib/catalog.js";

function fmtCUP(n, currency = "CUP") {
  return `${Number(n).toLocaleString("es-CU")} ${currency}`;
}

// Mismos nombres que usa el servidor para el registro del pedido (lib/orderEvents.js).
export const EVENT_LABEL = {
  CREATED: "Pedido recibido",
  CONFIRMED: "Venta confirmada",
  PREPARING: "En preparación",
  READY: "Listo para entregar",
  DELIVERED: "Entregado al cliente",
  CANCELLED: "Pedido cancelado",
  REMINDER_SENT: "Recordatorio a la tienda: pedido sin respuesta",
  CANCEL_WARNING_SENT: "Aviso a la tienda: se cerrará si no lo responde",
  AUTO_CANCELLED: "Cerrado por el sistema: no se confirmó a tiempo",
  REACTIVATED: "Reactivado por la tienda",
  EDITED_BY_CUSTOMER: "Productos modificados por el cliente",
  INVOICE_SENT: "Factura enviada al cliente",
  INVOICE_DOWNLOADED: "Factura generada",
  WARRANTY_SENT: "Garantía enviada al cliente",
  WARRANTY_DOWNLOADED: "Garantía generada",
  DELAY_NOTICE: "Aviso de retraso a la tienda y al cliente",
};

const STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };
const POS_STATUS_LABEL = { PREPARING: "Preparando", READY: "Listo para recoger", DELIVERED: "Recogido", CANCELLED: "Anulado" };
const METHOD_LABEL = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" };
const waLink = (phone) => `https://wa.me/${String(phone).replace(/\D/g, "")}`;
// Opciones elegidas en un producto (selectedOptions: { "Punto": "Tres cuartos", "Extras": ["Queso", "Bacon"] }).
const optionsText = (opts) =>
  opts && typeof opts === "object"
    ? Object.entries(opts)
        .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" · ")
    : "";
const timeOf = (d) => (d ? new Date(d).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" }) : null);

// Bloque 175 (pedido explícito — "habrá un botón en cada pedido para ver
// pedido y ver los detalles de cada pedido"): equivalente de
// TableOrderDetailModal pero para un pedido NORMAL (no de mesa) — usa lo
// que ya trae la lista de VendorOrders.jsx (o.raw ya incluye items), sin
// necesitar una consulta propia.
export function OrderDetailModal({ order, onClose }) {
  const o = order.raw;

  return (
    // Bloque 196: solo lectura, sin ningún borrador — cierra directo al
    // hacer clic afuera.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-panel-6 w-full max-w-lg rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-title-lg font-bold text-on-surface">Pedido {o.code}</h3>
            <p className="text-[12.5px] text-outline">
              {(o.pos ? POS_STATUS_LABEL[o.status] : null) ?? (o.status === "CANCELLED" && o.autoCancelledAt ? "Cerrado sin respuesta" : null) ?? STATUS_LABEL[o.status] ?? o.status} · {o.pos ? `Caja ${o.pos.code}` : channelLabel(o.channel)} · {new Date(o.createdAt).toLocaleString("es-CU")}
            </p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        {o.status === "CANCELLED" && o.cancelReason && (
          <p className="mb-3 rounded-md bg-error/5 px-3 py-2 text-[12.5px] text-error">
            <span className="font-semibold">Motivo de la anulación:</span> {o.cancelReason}
          </p>
        )}

        {/* Todo lo que el cliente escribió al hacer el pedido. La IP y el dispositivo no: eso solo lo ve el equipo de Baznova. */}
        {(o.customerName || o.customerPhone || o.customerEmail) && (
          <div className="mb-3 rounded-md bg-surface-container p-3 text-[12.5px] text-on-surface-variant">
            {o.customerName && (
              <div>
                <span className="font-semibold text-on-surface">Cliente:</span> {o.customerName}{" "}
                {!o.pos && <span className="text-outline">({o.customerId ? "tiene cuenta en Baznova" : "compró sin cuenta"})</span>}
              </div>
            )}
            {o.customerPhone && (
              <div>
                <span className="font-semibold text-on-surface">Teléfono:</span>{" "}
                <a href={waLink(o.customerPhone)} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent underline">{o.customerPhone}</a>{" "}
                <a href={`tel:${o.customerPhone}`} className="text-outline underline">llamar</a>
              </div>
            )}
            {o.customerEmail && (
              <div>
                <span className="font-semibold text-on-surface">Correo:</span>{" "}
                <a href={`mailto:${o.customerEmail}`} className="break-all text-tertiary-accent underline">{o.customerEmail}</a>
              </div>
            )}
            {o.recipientName && (
              <div className="mt-1.5 border-t border-outline-variant/40 pt-1.5">
                <span className="font-semibold text-on-surface">Recibe:</span> {o.recipientName}
                {o.recipientPhone && <> · <a href={waLink(o.recipientPhone)} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent underline">{o.recipientPhone}</a></>}
                {o.recipientIdNumber && (
                  <div>
                    <span className="font-semibold text-on-surface">{o.recipientIdType === "CU_ID" ? "Carné de identidad" : "Documento"}:</span> {o.recipientIdNumber}{" "}
                    <span className="text-outline">(compruébalo al entregar)</span>
                  </div>
                )}
              </div>
            )}
            {(o.provinceName || o.municipalityName) && (
              <div className="mt-1.5 border-t border-outline-variant/40 pt-1.5">
                <span className="font-semibold text-on-surface">Entrega en:</span> {[o.municipalityName, o.provinceName, o.countryName && !/^cuba$/i.test(o.countryName) ? o.countryName : null].filter(Boolean).join(", ")}
              </div>
            )}
            {o.shippingAddress && <div><span className="font-semibold text-on-surface">Dirección:</span> {o.shippingAddress}</div>}
            {o.tableNumber && <div><span className="font-semibold text-on-surface">Mesa:</span> {o.tableNumber}</div>}
          </div>
        )}

        {o.pos && (
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-surface-container p-3 text-[12.5px]">
            <div>
              <dt className="text-outline">Número de caja</dt>
              <dd className="font-bold tracking-[0.08em] text-on-surface">{o.pos.code}</dd>
            </div>
            <div>
              <dt className="text-outline">Pago</dt>
              <dd className="font-bold text-on-surface">{METHOD_LABEL[o.pos.paymentMethod] ?? "—"}</dd>
            </div>
            {o.pos.paymentMethod === "CASH" && (
              <div>
                <dt className="text-outline">Recibido / vuelto</dt>
                <dd className="font-bold text-on-surface">
                  {fmtCUP(o.pos.cashReceived ?? 0, o.items[0]?.currency)} / {fmtCUP(o.pos.change ?? 0, o.items[0]?.currency)}
                </dd>
              </div>
            )}
            {o.pos.cashier && (
              <div>
                <dt className="text-outline">Atendió</dt>
                <dd className="truncate font-bold text-on-surface">{o.pos.cashier}</dd>
              </div>
            )}
            {[["Cobrado", o.pos.paidAt], ["Listo", o.pos.readyAt], ["Recogido", o.pos.pickedUpAt]].filter(([, t]) => t).map(([label, t]) => (
              <div key={label}>
                <dt className="text-outline">{label}</dt>
                <dd className="font-bold text-on-surface">{timeOf(t)}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex flex-col gap-2">
          {o.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-md border border-surface-container-high p-2.5 text-[13px]">
              <span className="text-on-surface">
                {it.quantity} × {it.name}
                {it.size && ` (${it.size})`}
                {optionsText(it.selectedOptions) && <span className="block text-[11.5px] text-on-surface-variant">{optionsText(it.selectedOptions)}</span>}
                {orderLineShippingText(it) && <span className="block text-[11.5px] text-outline">{orderLineShippingText(it)}</span>}
              </span>
              <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity, it.currency)}</span>
            </div>
          ))}
        </div>

        {o.discountAmount > 0 && (
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-on-surface-variant">
            <span>Descuento aplicado{o.discountCode?.code ? ` (código ${o.discountCode.code})` : ""}</span>
            <span>-{fmtCUP(o.discountAmount)}</span>
          </div>
        )}
        {o.loyaltyPointsRedeemed > 0 && (
          <div className="mt-1.5 flex items-center justify-between text-[12.5px] text-on-surface-variant">
            <span>Pagado con {o.loyaltyPointsRedeemed} puntos</span>
            <span>-{fmtCUP(o.loyaltyDiscount, o.items[0]?.currency)}</span>
          </div>
        )}
        {o.loyaltyPointsEarned > 0 && <p className="mt-1.5 text-[12px] text-verified-dark">El cliente ganó {o.loyaltyPointsEarned} puntos con este pedido.</p>}

        {/* Envío aparte de los productos (ver lib/shipping.js); el total ya lo incluye si es fijo. */}
        {o.shippingSource && (
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[12.5px] text-on-surface-variant">
            <span>Envío{o.shippingSource === "STORE" && o.shippingFees?.length ? " (por pedido)" : ""}</span>
            <span className="text-right font-semibold text-on-surface">{orderShippingText(o)}</span>
          </div>
        )}
        {o.shippingCoordinate && <p className="mt-1 text-[12px] text-outline">Hay envío a coordinar con el cliente: no está incluido en el total.</p>}

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-surface-container-high pt-3">
          <span className="text-[13px] font-semibold text-on-surface-variant">Total</span>
          <span className="text-right text-[18px] font-bold text-primary">{orderTotalLabel(o)}</span>
        </div>

        {/* Historial con fecha y hora: lo que le pasó al pedido y los documentos que se enviaron al cliente. */}
        <div className="mt-4 border-t border-surface-container-high pt-3">
          <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-outline">Historial del pedido</h4>
          <ul className="flex flex-col gap-1.5">
            {[...(o.events?.some((e) => e.type === "CREATED") ? [] : [{ id: "created", type: "CREATED", createdAt: o.createdAt }]), ...(o.events ?? [])].map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                <span className="text-on-surface">
                  <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                  {e.detail && <span className="text-outline"> · {e.detail}</span>}
                </span>
                <span className="flex-shrink-0 text-outline">{new Date(e.createdAt).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
