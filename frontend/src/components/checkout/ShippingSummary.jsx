import { Truck } from "lucide-react";
import { combineTotalsLabel, shippingRowText } from "../../lib/shipping.js";

// Filas finales del resumen: Productos, Envío y Total, con el envío separado del precio de los productos (pedido
// explícito). `productTotals` ya trae descuentos o puntos aplicados; `shipping` viene del servidor.
export function ShippingSummary({ productTotals, productsLabel, shipping, loading, isError, totalLabel = "Total" }) {
  const fees = shipping?.fees ?? [];
  const rowText = isError ? "No se pudo calcular" : loading && !shipping ? "Calculando..." : shippingRowText(shipping ?? {});
  const free = shipping && !shipping.pending && !fees.length && !shipping.coordinate;
  return (
    <div className="mb-4 flex flex-col gap-1.5 border-t border-surface-container-high pt-4 text-[13.5px]">
      <div className="flex justify-between gap-3 text-on-surface-variant">
        <span>Productos</span>
        <span className="text-right font-semibold text-on-surface">{productsLabel}</span>
      </div>
      <div className="flex justify-between gap-3 text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" aria-hidden="true" /> Envío
          {shipping?.source === "STORE" && fees.length > 0 && <span className="text-[11.5px] text-outline">(por pedido)</span>}
        </span>
        <span className={`text-right font-semibold ${free ? "text-tertiary-accent" : "text-on-surface"}`}>{rowText}</span>
      </div>
      {shipping?.coordinate && (
        <p className="rounded-lg bg-surface-container px-3 py-2 text-[12px] text-on-surface-variant">
          {fees.length ? "Parte del envío" : "El envío"} se acuerda con la tienda según dónde lo recibas. No está incluido en el total: no se te cobra ahora.
        </p>
      )}
      <div className="mt-1.5 flex justify-between gap-3 border-t border-surface-container-high pt-3 text-title-md font-bold text-on-surface">
        <span>{totalLabel}</span>
        <span className="text-right text-title-lg font-extrabold text-tertiary-accent">{combineTotalsLabel(productTotals, shipping?.pending ? [] : fees)}</span>
      </div>
      {shipping?.pending && <p className="text-[12px] text-outline">El total no incluye el envío hasta que elijas la provincia de entrega.</p>}
    </div>
  );
}
