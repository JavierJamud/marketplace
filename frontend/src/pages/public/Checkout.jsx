import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, MessageCircle, Lock } from "lucide-react";
import { api } from "../../lib/api.js";
import { waLink } from "../../lib/whatsapp.js";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 14: 3 opciones (antes whatsapp/cod/transfer, ver schema.prisma y
// orders.controller.js para el mapeo/migración de pedidos históricos). Todas
// se coordinan por WhatsApp con el vendedor — ninguna pasa por ZeuDin.
const PAY_OPTIONS = [
  { id: "cod", title: "Pago contra entrega", sub: "Coordinado por WhatsApp con el vendedor" },
  { id: "online", title: "Pago en línea con el vendedor", sub: "Transferencia, Zelle, etc. — arreglan método y monto directo por WhatsApp" },
  { id: "cash", title: "Efectivo", sub: "Coordinás el lugar y momento por WhatsApp" },
];

export default function Checkout() {
  const { items, total, vendorId, vendorName, vendorSlug, vendorColor, clearCart, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  // Se captura antes de clearCart() (que vacía vendorName) para poder
  // mostrarlo en la pantalla de confirmación.
  const [confirmedInfo, setConfirmedInfo] = useState(null);
  const [pay, setPay] = useState("cod");
  const [form, setForm] = useState({
    customerName: user?.fullName ?? "",
    customerPhone: user?.phone ?? "",
    customerEmail: user?.email ?? "",
    provinceId: "",
    municipalityName: "",
    address: "",
  });
  // Todos los campos son obligatorios (Bloque 6): la tienda necesita poder
  // contactar al cliente sí o sí, sin excepción.
  const allFieldsFilled =
    form.customerName.trim() && form.customerPhone.trim() && form.customerEmail.trim() && form.provinceId && form.municipalityName.trim() && form.address.trim();

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Fresco (no cacheado en el carrito): necesitamos el canal de aviso que el
  // vendedor tiene configurado AHORA para decidir la pantalla de confirmación.
  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug,
  });
  const wantsWhatsApp = (vendor?.orderDestination ?? "WHATSAPP") === "WHATSAPP";

  const placeOrder = useMutation({
    mutationFn: async () =>
      (
        await api.post("/orders", {
          vendorId,
          channel: pay,
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          customerEmail: form.customerEmail,
          shippingProvinceId: form.provinceId || undefined,
          shippingAddress: [form.municipalityName, form.address].filter(Boolean).join(" — ") || undefined,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, selectedOptions: i.selectedOptions })),
        })
      ).data,
    onSuccess: ({ order }) => {
      setConfirmedInfo({
        vendorName,
        provinceName: provinces?.find((p) => p.id === form.provinceId)?.name ?? "tu provincia",
        wantsWhatsApp,
        vendorWhatsapp: vendor?.whatsapp,
        orderCode: order.code,
      });
      clearCart();
      setDone(true);
      window.scrollTo(0, 0);
    },
    onError: (err) => {
      // 409 = el stock cambió entre agregar al carrito y confirmar (otro
      // cliente compró primero). Se ajusta el carrito al máximo real en vez
      // de solo mostrar un error genérico, para que el cliente pueda
      // reintentar sin perder el resto del pedido.
      const insufficientStock = err.response?.data?.details?.insufficientStock;
      if (err.response?.status === 409 && insufficientStock?.length) {
        for (const item of insufficientStock) {
          if (item.available > 0) updateQuantity(item.productId, item.available);
          else removeItem(item.productId);
        }
        toast.error(
          insufficientStock.length === 1
            ? `"${insufficientStock[0].name}" ya no tiene suficiente stock. Ajustamos tu carrito a ${insufficientStock[0].available} disponibles.`
            : "Algunos productos ya no tienen suficiente stock. Ajustamos tu carrito a lo disponible."
        );
      }
    },
  });

  if (done) {
    return (
      <div className="container-app max-w-[1080px] py-9">
        <div className="mx-auto max-w-[520px] rounded-xl border border-surface-container-high bg-surface-container-lowest p-11 text-center">
          <div className="mx-auto mb-[18px] flex h-[60px] w-[60px] items-center justify-center rounded-full bg-verified/10">
            <CheckCircle2 className="h-8 w-8 text-verified" strokeWidth={2.5} />
          </div>
          <h2 className="mb-2.5 font-display text-title-lg text-on-surface">¡Pedido enviado!</h2>
          <p className="mb-6 text-body-md leading-[21px] text-on-surface-variant">
            {confirmedInfo?.wantsWhatsApp ? (
              <>
                Le enviamos tu pedido a <strong>{confirmedInfo?.vendorName}</strong>. Te contactará por WhatsApp para coordinar pago y
                entrega en {confirmedInfo?.provinceName}.
              </>
            ) : (
              <>
                Tu pedido quedó registrado en el panel de <strong>{confirmedInfo?.vendorName}</strong>. Te van a contactar para
                coordinar pago y entrega en {confirmedInfo?.provinceName}.
              </>
            )}
          </p>
          {confirmedInfo?.wantsWhatsApp && confirmedInfo?.vendorWhatsapp && (
            <a
              href={waLink(
                confirmedInfo.vendorWhatsapp,
                `Hola ${confirmedInfo.vendorName}, acabo de hacer el pedido ${confirmedInfo.orderCode} en ZeuDin. ¿Podemos coordinar?`
              )}
              target="_blank"
              rel="noreferrer"
              className="mb-3 flex h-12 items-center justify-center gap-2 rounded bg-[#25D366] text-label-md font-bold text-white"
            >
              <MessageCircle className="h-[18px] w-[18px]" /> Continuar por WhatsApp
            </a>
          )}
          <Link to="/" className="inline-block rounded bg-secondary-container px-6 py-3 text-label-md font-bold text-on-secondary-container">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container-app max-w-[1080px] py-9 text-center">
        <p className="text-body-md text-on-surface-variant">Tu carrito está vacío.</p>
        <Link to="/catalogo" className="mt-3 inline-block text-label-md font-semibold text-tertiary-accent">Ir al catálogo →</Link>
      </div>
    );
  }

  return (
    <div className="container-app max-w-[1080px] py-9">
      <h1 className="mb-1.5 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Finalizar pedido</h1>
      <p className="mb-7 text-[13.5px] text-outline">En Cuba el pago se coordina con el vendedor. ZeuDin no cobra comisión por la venta.</p>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
            <div className="mb-4 text-title-lg font-bold text-on-surface">Datos de contacto y entrega</div>
            <div className="mb-3">
              <input
                placeholder="Nombre y apellidos"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
              />
            </div>
            <div className="mb-3">
              <PhoneInput value={form.customerPhone} onChange={(customerPhone) => setForm({ ...form, customerPhone })} />
            </div>
            <div className="mb-3">
              <input
                type="email"
                placeholder="Correo electrónico"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
              />
              <p className="mt-1 text-[11.5px] text-outline">Te mandamos la confirmación del pedido acá.</p>
            </div>
            {/* Bloque 18: único país de entrega por ahora — el admin puede
                cargar más países/provincias desde AdminLocations.jsx, pero
                el checkout de compra recién los ofrece cuando ZeuDin
                realmente habilite entregas fuera de Cuba. */}
            <div className="mb-3">
              <div className="flex h-11 items-center gap-2 rounded border border-outline-variant bg-surface-container px-3.5 text-body-md text-on-surface-variant">
                <Lock className="h-3.5 w-3.5 flex-shrink-0 text-outline" />
                🇨🇺 Cuba
                <span className="ml-auto text-[11.5px] text-outline">Único país de entrega por ahora</span>
              </div>
            </div>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={form.provinceId}
                onChange={(e) => setForm({ ...form, provinceId: e.target.value })}
                className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-body-md outline-none"
              >
                <option value="">Provincia</option>
                {provinces?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input
                placeholder="Municipio"
                value={form.municipalityName}
                onChange={(e) => setForm({ ...form, municipalityName: e.target.value })}
                className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none"
              />
            </div>
            <textarea
              placeholder="Dirección y referencias"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="min-h-[74px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none"
            />
          </div>

          <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
            <div className="mb-1.5 text-title-lg font-bold text-on-surface">Cómo vas a coordinar el pago</div>
            <p className="mb-4 text-[12.5px] text-outline">
              No se cobra nada acá — se arregla directo con la tienda. ZeuDin nunca procesa ni recibe pagos.
            </p>
            <div className="flex flex-col gap-3">
              {PAY_OPTIONS.map((pm) => (
                <label
                  key={pm.id}
                  onClick={() => setPay(pm.id)}
                  className={`flex cursor-pointer items-center gap-3 rounded-md p-4 ${
                    pay === pm.id ? "border-2 border-secondary-container" : "border border-surface-container-high"
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 ${
                      pay === pm.id ? "border-secondary-container" : "border-outline-variant"
                    }`}
                  >
                    {pay === pm.id && <span className="h-2 w-2 rounded-full bg-secondary-container" />}
                  </span>
                  <div>
                    <div className="text-[13.5px] font-bold text-on-surface">{pm.title}</div>
                    <div className="text-[12px] text-outline">{pm.sub}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* RESUMEN */}
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px] lg:sticky lg:top-6">
          <div className="mb-3.5 font-display text-title-lg text-on-surface">Tu pedido</div>
          <div className="mb-3.5 flex items-center gap-2.5 border-b border-surface-container-high pb-3.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-label-sm font-bold text-white"
              style={{ background: vendorColor ?? "#232F3E" }}
            >
              {vendorName?.[0]}
            </span>
            <span className="text-[13.5px] font-bold text-on-surface">{vendorName}</span>
          </div>
          <div className="mb-3.5 flex flex-col gap-2">
            {items.map((it) => (
              <div key={it.productId} className="flex justify-between text-[13px] text-on-surface-variant">
                <span>{it.quantity}× {it.name}</span>
                <span>{fmtCUP(it.price * it.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="mb-[18px] flex justify-between border-t border-surface-container-high pt-3 text-title-lg font-bold text-on-surface">
            <span>Total</span>
            <span>{fmtCUP(total)}</span>
          </div>
          <button
            onClick={() => placeOrder.mutate()}
            disabled={placeOrder.isPending || !allFieldsFilled}
            className="h-12 w-full rounded bg-secondary-container text-label-md font-bold text-on-secondary-container disabled:opacity-50"
          >
            {placeOrder.isPending ? "Enviando..." : "Confirmar pedido"}
          </button>
          {!allFieldsFilled && (
            <p className="mt-2 text-label-sm text-outline">Completá todos los campos de contacto y entrega para confirmar.</p>
          )}
          {placeOrder.isError && !placeOrder.error?.response?.data?.details?.insufficientStock && (
            <p className="mt-2 text-label-sm text-error">
              {placeOrder.error?.response?.data?.error ?? "No se pudo confirmar el pedido."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
