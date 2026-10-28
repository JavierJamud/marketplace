import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { cardColor, earnRuleText, fmtAmount, fmtPoints, pointsValue, valueRuleText } from "../lib/loyalty.js";

// Aviso del programa de puntos en la página de la tienda: cómo se ganan, cuánto valen y, si el cliente ya tiene, su saldo
// con lo que le falta para poder usarlos. Lleva el color de la tienda, como una tarjeta de cliente. No se muestra si la
// tienda no tiene programa encendido.
export function StoreLoyaltyBanner({ vendorId, vendorName, vendorColor }) {
  const { user } = useAuth();
  const isCustomer = user?.role === "CUSTOMER";
  const { data } = useQuery({
    queryKey: ["loyalty-checkout", vendorId, isCustomer ? user.id : "guest"],
    queryFn: async () => (await api.get(isCustomer ? `/loyalty/vendors/${vendorId}/me` : `/loyalty/vendors/${vendorId}/program`)).data,
    enabled: !!vendorId,
    staleTime: 30 * 1000,
  });
  const program = data?.program;
  if (!program) return null;
  const balance = data.balance ?? 0;
  const ready = balance >= program.minRedeemPoints;
  const progress = Math.min(100, Math.round((balance / program.minRedeemPoints) * 100));

  return (
    <div className="container-app pt-6">
      <div className="relative overflow-hidden rounded-2xl px-4 py-4 text-white sm:px-5" style={{ background: cardColor(vendorColor) }}>
        <span className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
              <Award className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-[13px] leading-[19px]">
              <p className="text-[15px] font-extrabold">{vendorName} te premia por comprar</p>
              <p className="text-white/90">
                Ganas {earnRuleText(program, program.currency)}. Después, {valueRuleText(program, program.currency)} de descuento aquí.
              </p>
              {!user && (
                <p className="mt-1">
                  <Link to="/cuenta" className="font-bold underline underline-offset-2">Entra o crea tu cuenta</Link> para empezar a sumar.
                </p>
              )}
            </div>
          </div>
          {isCustomer && (
            <div className="flex-shrink-0 rounded-xl bg-white/15 px-3 py-2 sm:min-w-[200px]">
              <p className="text-[11.5px] font-semibold text-white/80">Tus puntos aquí</p>
              <p className="text-[18px] font-extrabold leading-6">
                {fmtPoints(balance)} <span className="text-[12.5px] font-semibold text-white/85">· {fmtAmount(pointsValue(program, balance), program.currency)}</span>
              </p>
              {ready ? (
                <p className="text-[12px] font-semibold">Ya puedes usarlos al pagar.</p>
              ) : (
                <>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuemin={0} aria-valuemax={program.minRedeemPoints} aria-valuenow={balance} aria-label="Puntos para poder usarlos">
                    <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-white/90">Te faltan {fmtPoints(program.minRedeemPoints - balance)} para usarlos.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
