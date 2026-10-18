import { MapPin, Package, UserRound } from "lucide-react";
import { imgUrl } from "../../lib/imgUrl.js";

// Contenido del aviso en vivo de un pedido (pedido nuevo para la tienda, pedido recibido para el cliente), dentro del aviso de
// Sileo: número y total arriba, los productos, y abajo quién recibe y dónde. Los datos los arma el servidor
// (lib/orderSummary.js → orderNoticeDetail), los mismos que el aviso del teléfono y los correos.
export function OrderNoticeCard({ d }) {
  return (
    <div className="mt-1 w-full min-w-0 text-left">
      <div className="flex items-center gap-3">
        {d.image ? (
          <img src={imgUrl(d.image)} alt="" className="h-11 w-11 flex-shrink-0 rounded-xl bg-white object-cover" />
        ) : (
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10">
            <Package className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold tracking-[0.04em]">{d.code}</p>
          <p className="truncate text-[12px] opacity-75">
            {d.units} {d.units === 1 ? "producto" : "productos"}
            {d.audience === "vendor" && d.buyer ? ` · ${d.buyer}` : d.store ? ` · ${d.store}` : ""}
          </p>
        </div>
        <p className="flex-shrink-0 text-[15px] font-extrabold">{d.total}</p>
      </div>
      <ul className="mt-2 space-y-0.5 text-[12.5px] leading-[17px] opacity-90">
        {d.items.map((i, idx) => (
          <li key={`${i.name}-${idx}`} className="truncate">
            {i.quantity}× {i.name}
            {i.size ? ` (${i.size})` : ""}
          </li>
        ))}
        {d.more > 0 && <li className="opacity-70">y {d.more} más</li>}
      </ul>
      {(d.recipient || d.place) && (
        <div className="mt-2 space-y-0.5 border-t border-white/15 pt-2 text-[12px] leading-[17px] opacity-80">
          {d.recipient && (
            <p className="flex items-center gap-1.5 truncate">
              <UserRound className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" /> Recibe {d.recipient.name}
            </p>
          )}
          {d.place && (
            <p className="flex items-center gap-1.5 truncate">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" /> {d.place}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
