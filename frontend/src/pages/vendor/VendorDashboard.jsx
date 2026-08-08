import { Link, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, PackageX, TrendingUp, Users } from "lucide-react";
import { api } from "../../lib/api.js";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const STATUS_LABEL = {
  NEW: "Nuevo",
  PREPARING: "Preparando",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
  RECEIVED: "Recibido",
};
const STATUS_COLOR = {
  NEW: "#337475",
  PREPARING: "#8A5100",
  READY: "#0A8F42",
  DELIVERED: "#0CAE53",
  CANCELLED: "#ba1a1a",
  RECEIVED: "#75777c",
};
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };

export default function VendorDashboard() {
  const { vendor } = useOutletContext();

  const { data } = useQuery({
    queryKey: ["vendor-dashboard"],
    queryFn: async () => (await api.get("/vendors/me/dashboard")).data,
  });

  const metrics = data
    ? [
        { label: "Ventas (semana)", value: fmtCUP(data.salesThisWeek) },
        { label: "Pedidos nuevos", value: String(data.newOrdersCount) },
        { label: "Productos activos", value: `${data.activeProducts}`, delta: data.maxProducts ? `de ${data.maxProducts} (Regular)` : "Business · ilimitado" },
        { label: "Calificación", value: `${data.rating.toFixed(1)} ★`, delta: `${data.reviewCount} reseñas` },
      ]
    : [];

  return (
    <div>
      <div className="mb-[26px] flex items-center justify-between">
        <div>
          <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Resumen</h1>
          <p className="text-[13.5px] text-outline">Hola {vendor?.companyName}, así va tu tienda esta semana.</p>
        </div>
        <Link to="/vendedor/productos" className="rounded-md bg-secondary-container px-[18px] py-2.5 text-[13.5px] font-bold text-on-secondary-container">
          + Nuevo producto
        </Link>
      </div>

      <div className="mb-[26px] grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-2 text-[12.5px] text-outline">{m.label}</div>
            <div className="font-display text-2xl font-extrabold text-on-surface">{m.value}</div>
            {m.delta && <div className="mt-1 text-[11.5px] font-semibold text-verified-dark">{m.delta}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[15px] font-bold text-on-surface">Pedidos recientes</div>
            <Link to="/vendedor/pedidos" className="text-[12.5px] font-semibold text-tertiary-accent">Ver todos →</Link>
          </div>
          <div className="flex flex-col">
            {data?.recentOrders?.length ? (
              data.recentOrders.map((o) => (
                <div key={o.id} className="flex items-center gap-3.5 border-b border-surface-container py-3 last:border-b-0">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold text-on-surface">{o.id} · {o.customer}</div>
                    <div className="text-[12px] text-outline">{new Date(o.date).toLocaleString("es-CU")} · {CHANNEL_LABEL[o.channel] ?? o.channel}</div>
                  </div>
                  <div className="text-[13.5px] font-bold text-on-surface">{fmtCUP(o.total)}</div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                    style={{ background: `${STATUS_COLOR[o.status] ?? "#75777c"}1f`, color: STATUS_COLOR[o.status] ?? "#75777c" }}
                  >
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-4 text-body-md text-on-surface-variant">Todavía no hay pedidos.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {data?.isVerified ? (
            <div className="rounded-lg bg-gradient-to-br from-verified to-verified-dark p-[22px] text-white">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-[14px] font-bold">Tienda verificada</span>
              </div>
              <p className="text-[12.5px] leading-[18px] text-white/85">
                Tu badge está activo. Apareces destacada en la home de tu provincia.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-gradient-to-br from-primary to-primary-container p-[22px] text-white">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-[14px] font-bold">Todavía no estás verificada</span>
              </div>
              <p className="mb-3 text-[12.5px] leading-[18px] text-white/80">
                Verificate para obtener el badge y desbloquear el Plan Business.
              </p>
              <Link to="/vendedor/verificacion" className="text-[12.5px] font-bold text-secondary-container">Verificar ahora →</Link>
            </div>
          )}
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
            <div className="mb-1.5 text-[14px] font-bold text-on-surface">Plan {data?.planType === "BUSINESS" ? "Business" : "Regular"}</div>
            <p className="mb-3 text-[12.5px] text-outline">
              {data?.planType === "BUSINESS" ? "2 500 CUP/mes · badge activo" : "Gratis · hasta 20 productos, solo WhatsApp"}
            </p>
            <Link to="/vendedor/verificacion" className="block rounded border border-outline-variant py-2.5 text-center text-[13px] font-semibold text-on-surface-variant">
              Gestionar plan
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#8A5100]" />
            <div className="text-[15px] font-bold text-on-surface">Productos por agotarse</div>
          </div>
          <div className="flex flex-col">
            {data?.lowStockProducts?.length ? (
              data.lowStockProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded bg-surface-container">
                    {p.images?.[0] && <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex-1 text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <span className="rounded-full bg-[#8A5100]/10 px-2.5 py-1 text-[11px] font-bold text-[#8A5100]">
                    {p.stock} {p.stock === 1 ? "unidad" : "unidades"}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Ningún producto está por agotarse.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 flex items-center gap-2">
            <PackageX className="h-4 w-4 text-[#ba1a1a]" />
            <div className="text-[15px] font-bold text-on-surface">Productos agotados</div>
          </div>
          <div className="flex flex-col">
            {data?.outOfStockProducts?.length ? (
              data.outOfStockProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded bg-surface-container">
                    {p.images?.[0] && <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex-1 text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <span className="rounded-full bg-[#ba1a1a]/10 px-2.5 py-1 text-[11px] font-bold text-[#ba1a1a]">Sin stock</span>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Ningún producto está agotado.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-verified-dark" />
            <div className="text-[15px] font-bold text-on-surface">Productos de alta demanda</div>
          </div>
          <div className="flex flex-col">
            {data?.topProducts?.length ? (
              data.topProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded bg-surface-container">
                    {p.images?.[0] && <img src={imgUrl(p.images[0])} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex-1 text-[13px] font-semibold text-on-surface">{p.name}</div>
                  <span className="rounded-full bg-verified/10 px-2.5 py-1 text-[11px] font-bold text-verified-dark">
                    {p.soldCount} {p.soldCount === 1 ? "vendido" : "vendidos"}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Todavía no hay ventas suficientes en los últimos 30 días.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px]">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-tertiary-accent" />
            <div className="text-[15px] font-bold text-on-surface">Clientes potenciales</div>
          </div>
          <p className="mb-3 text-[11.5px] text-outline">Visitaron tu tienda o agregaron algo al carrito en los últimos 30 días, sin completar un pedido.</p>
          <div className="flex flex-col">
            {data?.potentialCustomers?.length ? (
              data.potentialCustomers.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-b border-surface-container py-2.5 last:border-b-0">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[12px] font-bold text-on-surface-variant">
                    {(c.fullName ?? c.email)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-on-surface">{c.fullName ?? "Cliente"}</div>
                    <div className="text-[11.5px] text-outline">{c.phone ?? c.email}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">No hay clientes potenciales por ahora.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
