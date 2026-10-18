import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { earnRuleText, fmtAmount, fmtPoints, pointsValue, valueRuleText } from "../lib/loyalty.js";

// Aviso del programa de puntos en la página de la tienda: cómo se ganan y, si el cliente ya tiene, cuántos y cuánto valen.
// No se muestra si la tienda no tiene programa encendido.
export function StoreLoyaltyBanner({ vendorId, vendorName }) {
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

  return (
    <div className="container-app pt-6">
      <div className="flex items-start gap-3 rounded-2xl border border-tertiary-accent/25 bg-tertiary-accent/[0.06] px-4 py-3">
        <Award className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
        <div className="min-w-0 text-[13px] leading-[19px] text-on-surface">
          <p className="font-bold">{vendorName} te da puntos por tus compras</p>
          <p className="text-on-surface-variant">
            {earnRuleText(program, program.currency)}. Al canjearlos, {valueRuleText(program, program.currency)} en tu próxima compra aquí.
          </p>
          {isCustomer && balance > 0 && (
            <p className="mt-0.5 font-semibold text-verified-dark">
              Tienes {fmtPoints(balance)} ({fmtAmount(pointsValue(program, balance), program.currency)}).
            </p>
          )}
          {!user && (
            <p className="mt-0.5">
              <Link to="/cuenta" className="font-bold text-tertiary-accent underline">Entra o crea tu cuenta</Link> para ganarlos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
