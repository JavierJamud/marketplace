import { X } from "lucide-react";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

const STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };

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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-title-lg font-bold text-on-surface">Pedido {o.code}</h3>
            <p className="text-[12.5px] text-outline">
              {STATUS_LABEL[o.status] ?? o.status} · {CHANNEL_LABEL[o.channel] ?? o.channel} · {new Date(o.createdAt).toLocaleString("es-CU")}
            </p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>

        {(o.customerName || o.customerPhone || o.customerEmail) && (
          <div className="mb-3 rounded-md bg-surface-container p-3 text-[12.5px] text-on-surface-variant">
            {o.customerName && <div><span className="font-semibold text-on-surface">Cliente:</span> {o.customerName}</div>}
            {o.customerPhone && <div><span className="font-semibold text-on-surface">Teléfono:</span> {o.customerPhone}</div>}
            {o.customerEmail && <div><span className="font-semibold text-on-surface">Email:</span> {o.customerEmail}</div>}
            {o.shippingAddress && <div><span className="font-semibold text-on-surface">Dirección:</span> {o.shippingAddress}</div>}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {o.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-md border border-surface-container-high p-2.5 text-[13px]">
              <span className="text-on-surface">
                {it.quantity} × {it.name}
                {it.size && ` (${it.size})`}
              </span>
              <span className="font-semibold text-on-surface-variant">{fmtCUP(it.price * it.quantity)}</span>
            </div>
          ))}
        </div>

        {o.discountAmount > 0 && (
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-on-surface-variant">
            <span>Descuento aplicado</span>
            <span>-{fmtCUP(o.discountAmount)}</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-surface-container-high pt-3">
          <span className="text-[13px] font-semibold text-on-surface-variant">Total</span>
          <span className="text-[18px] font-bold text-primary">{fmtCUP(o.total)}</span>
        </div>
      </div>
    </div>
  );
}
