import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { api } from "../../lib/api.js";
import { resolveUnitPrice } from "../../lib/pricing.js";
import { fmtAmount, fmtPoints, maxRedeemablePoints, pointsForAmount, pointsValue } from "../../lib/loyalty.js";

// Puntos de la tienda en el checkout: cuántos tiene el cliente, cuántos puede usar en este pedido y cuántos ganará al recibirlo.
// El navegador solo manda "quiero usar N puntos"; el servidor recalcula todo al confirmar (ver loyalty.service.js).
export function useCheckoutLoyalty({ vendorId, items, discountAmount, user }) {
  const isCustomer = user?.role === "CUSTOMER";
  const { data } = useQuery({
    queryKey: ["loyalty-checkout", vendorId, isCustomer ? user.id : "guest"],
    queryFn: async () => (await api.get(isCustomer ? `/loyalty/vendors/${vendorId}/me` : `/loyalty/vendors/${vendorId}/program`)).data,
    enabled: !!vendorId,
    staleTime: 30 * 1000,
  });
  const program = data?.program ?? null;
  const balance = data?.balance ?? 0;
  const [use, setUse] = useState(false);
  const [points, setPoints] = useState(0);

  // Solo cuenta un pedido entero en la moneda de la tienda (igual que en el servidor).
  const sameCurrency = !!program && items.length > 0 && items.every((i) => (i.currency ?? "CUP") === program.currency);
  const subtotal = useMemo(() => items.reduce((s, i) => s + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0), [items]);
  const payable = Math.max(0, subtotal - (discountAmount ?? 0));
  const max = sameCurrency && isCustomer ? maxRedeemablePoints(program, balance, payable) : 0;

  // Si cambia el carrito o el descuento y el tope baja, los puntos elegidos bajan con él.
  useEffect(() => {
    if (!max) setUse(false);
    setPoints((p) => (p > max || p === 0 ? max : p));
  }, [max]);

  const used = use && max ? Math.min(Math.max(points, program.minRedeemPoints), max) : 0;
  const discount = used ? Math.min(payable, pointsValue(program, used)) : 0;
  const earn = sameCurrency ? pointsForAmount(program, payable - discount) : 0;

  return { program, balance, isCustomer, sameCurrency, max, use, setUse, points: used || points, setPoints, used, discount, earn, total: payable - discount };
}

export function LoyaltyBox({ loyalty, vendorName }) {
  const { program, balance, isCustomer, sameCurrency, max, use, setUse, points, setPoints, used, discount, earn } = loyalty;
  if (!program || !sameCurrency) return null;
  const currency = program.currency;

  if (!isCustomer) {
    return (
      <div className="mb-3 flex gap-2.5 rounded-lg bg-tertiary-accent/[0.07] px-3 py-2.5 text-[12.5px] leading-[18px] text-on-surface">
        <Award className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
        <span>
          {vendorName} tiene programa de fidelidad: con este pedido ganarías {fmtPoints(earn)}.{" "}
          <Link to="/cuenta" className="font-bold text-tertiary-accent underline">Entra o crea tu cuenta</Link> para ganarlos.
        </span>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-surface-container-high px-3 py-2.5 text-[12.5px] leading-[18px] text-on-surface">
      <div className="flex items-start gap-2.5">
        <Award className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p>
            Tienes <strong>{fmtPoints(balance)}</strong> en {vendorName}
            {balance > 0 && ` (valen ${fmtAmount(pointsValue(program, balance), currency)})`}.
          </p>
          {max > 0 ? (
            <label className="mt-1.5 flex min-h-10 cursor-pointer items-center gap-2 font-semibold">
              <input type="checkbox" checked={use} onChange={(e) => setUse(e.target.checked)} className="h-4 w-4 accent-tertiary-accent" />
              Usar puntos en este pedido
            </label>
          ) : (
            balance > 0 && (
              <p className="mt-1 text-outline">
                {balance < program.minRedeemPoints ? `Puedes usarlos desde ${fmtPoints(program.minRedeemPoints)}.` : "En este pedido no se pueden usar (es muy pequeño para el tope de la tienda)."}
              </p>
            )
          )}
          {use && max > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                aria-label="Puntos a usar"
                min={program.minRedeemPoints}
                max={max}
                value={points}
                onChange={(e) => setPoints(Math.trunc(Number(e.target.value) || 0))}
                className="h-10 w-28 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
              />
              <span className="text-outline">de {max.toLocaleString("es-CU")} posibles · -{fmtAmount(discount, currency)}</span>
              {used !== points && <span className="w-full text-[11.5px] text-outline">Se usarán {fmtPoints(used)} (entre {program.minRedeemPoints} y {max}).</span>}
            </div>
          )}
          {earn > 0 && <p className="mt-1 text-verified-dark">Al recibir este pedido ganas {fmtPoints(earn)}.</p>}
        </div>
      </div>
    </div>
  );
}
