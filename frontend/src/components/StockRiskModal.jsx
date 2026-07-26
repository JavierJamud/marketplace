import { AlertTriangle, Mail } from "lucide-react";
import { Button } from "./ui/Button.jsx";

// Bloque 29: aparece después de confirmar una venta si el stock que quedó ya
// no alcanza para otro(s) pedido(s) Pendiente(s) del mismo producto — el
// vendedor decide acá mismo si avisarle al cliente afectado o dejarlo tal
// cual; ese otro pedido nunca se toca ni se cancela solo.
export function StockRiskModal({ atRiskOrders, onNotify, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-tertiary-accent" />
          <h3 className="text-title-lg text-on-surface">Otros pedidos se quedaron sin stock</h3>
        </div>
        <p className="mb-4 text-[12.5px] text-outline">
          Al confirmar esa venta, el stock restante ya no alcanza para estos pedidos Pendientes del mismo producto. Puedes avisarle al
          cliente o dejarlo tal cual — no se tocan solos, tú decides qué hacer con cada uno.
        </p>

        <div className="flex flex-col gap-2.5">
          {atRiskOrders.map((o) => (
            <div key={o.orderId} className="rounded-md border border-outline-variant p-3.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[13.5px] font-bold text-on-surface">{o.code}</span>
                <span className="text-[12px] text-outline">{o.customerName ?? "Cliente"}</span>
              </div>
              {o.items.map((it, i) => (
                <p key={i} className="text-[12.5px] text-outline">
                  {it.name}: pidió {it.requested}, disponible {it.available}
                </p>
              ))}
              <div className="mt-2.5">
                {o.customerEmail ? (
                  <button
                    onClick={() => onNotify(o)}
                    className="flex items-center gap-1.5 rounded-[7px] bg-tertiary-accent/10 px-2.5 py-1.5 text-[11.5px] font-bold text-tertiary-accent"
                  >
                    <Mail className="h-3.5 w-3.5" /> Notificar cliente
                  </button>
                ) : (
                  <span className="text-[11.5px] text-outline">Este pedido no tiene email de cliente registrado.</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cerrar sin notificar
          </Button>
        </div>
      </div>
    </div>
  );
}
