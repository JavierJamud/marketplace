import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Copy, Globe2, History, MapPin, Monitor, Package, ShieldCheck, Smartphone, Tablet, User, X } from "lucide-react";
import { api } from "../../lib/api.js";
import toast from "../../lib/toast.jsx";
import { formatPrice } from "../../lib/format.js";
import { exactDateTime, timeAgo } from "../../lib/relativeTime.js";
import { orderTotalLabel, orderShippingText, orderLineShippingText } from "../../lib/shipping.js";
import { channelLabel } from "../../lib/catalog.js";
import { EVENT_LABEL } from "../vendor/OrderDetailModal.jsx";
import { orderStatusOf } from "./VendorOrdersPanel.jsx";
import { Button } from "../ui/Button.jsx";

// Ficha de un pedido para el admin: todo lo que mandó el cliente, cómo terminó y, aparte, la conexión y el dispositivo desde
// donde se hizo (IP, navegador, sistema), que la tienda no ve. Se abre como panel lateral (pantalla completa en el celular).

const METHOD_LABEL = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" };
const EMAIL_STATUS = { SENT: "Enviado", FAILED: "Falló" };

function copy(text, what) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error("No se pudo copiar.")
  );
}

function Block({ icon: Icon, title, note, children }) {
  return (
    <section className="border-t border-surface-container-high px-4 py-4 sm:px-6">
      <h3 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold text-on-surface">
        <Icon className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> {title}
        {note && <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10.5px] font-bold text-on-surface-variant">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

// Filas etiqueta / valor. En el celular, la etiqueta va arriba del valor.
function Rows({ rows }) {
  const shown = rows.filter(([, v]) => v != null && v !== "" && v !== false);
  return (
    <dl className="divide-y divide-surface-container">
      {shown.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-3">
          <dt className="text-[12px] text-outline">{k}</dt>
          <dd className="min-w-0 break-words text-[13px] text-on-surface">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const optionsText = (opts) =>
  opts && typeof opts === "object"
    ? Object.entries(opts)
        .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" · ")
    : "";

function CopyButton({ text, what }) {
  return (
    <button type="button" onClick={() => copy(text, what)} aria-label={`Copiar ${what.toLowerCase()}`} className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full align-middle text-outline hover:bg-surface-container hover:text-on-surface">
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function deviceLine(r) {
  const os = [r.os, r.osVersion].filter(Boolean).join(" ");
  return [r.device, r.model, os].filter(Boolean).join(" · ");
}

function ConnectionBlock({ request, order, sameIpOrders, onFilterIp }) {
  if (order.pos) {
    return (
      <Block icon={ShieldCheck} title="Conexión y dispositivo" note="Solo admin">
        <p className="text-[13px] text-on-surface-variant">Es una venta de caja: la registró la tienda en su local, no hubo una conexión del cliente.</p>
      </Block>
    );
  }
  if (!request) {
    return (
      <Block icon={ShieldCheck} title="Conexión y dispositivo" note="Solo admin">
        <p className="text-[13px] text-on-surface-variant">Este pedido se hizo antes de que Baznova guardara la IP y el dispositivo de cada pedido.</p>
      </Block>
    );
  }
  const DeviceIcon = request.device === "Celular" ? Smartphone : request.device === "Tablet" ? Tablet : Monitor;
  const openedFrom = request.source === "PARTNER_API" ? null : request.inApp ? `Dentro de ${request.inApp}` : request.standalone ? "App instalada de Baznova" : "Navegador";
  return (
    <Block icon={ShieldCheck} title="Conexión y dispositivo" note="Solo admin">
      <p className="mb-2 text-[12px] text-on-surface-variant">La tienda no ve estos datos.</p>
      <Rows
        rows={[
          ["Origen", request.source === "PARTNER_API" ? `API de un socio${order.partner ? ` (${order.partner.name})` : ""}. La IP es la de su servidor.` : "Tienda en línea de Baznova"],
          [
            "Dirección IP",
            request.ip ? (
              <>
                <span className="font-mono font-semibold">{request.ip}</span>
                <CopyButton text={request.ip} what="IP" />
                {sameIpOrders > 0 && (
                  <button type="button" onClick={() => onFilterIp(request.ip)} className="ml-1 text-[12.5px] font-bold text-tertiary-accent underline">
                    {sameIpOrders === 1 ? "1 pedido más desde esta IP" : `${sameIpOrders} pedidos más desde esta IP`}
                  </button>
                )}
              </>
            ) : null,
          ],
          [
            "Dispositivo",
            deviceLine(request) ? (
              <span className="inline-flex items-center gap-1.5">
                <DeviceIcon className="h-4 w-4 text-outline" aria-hidden="true" /> {deviceLine(request)}
              </span>
            ) : null,
          ],
          ["Navegador", request.browser ? [request.browser, request.browserVersion].filter(Boolean).join(" ") : null],
          ["Abierto desde", openedFrom],
          ["Idioma", request.language],
          ["Zona horaria", request.timezone],
          ["Pantalla", request.screen],
          ["Llegó desde", request.referer],
        ]}
      />
      {request.userAgent && (
        <details className="mt-2 text-[12px]">
          <summary className="min-h-9 cursor-pointer py-2 font-semibold text-tertiary-accent">Ver el identificador completo del navegador</summary>
          <p className="break-all rounded-lg bg-surface-container p-2.5 font-mono text-[11.5px] text-on-surface-variant">{request.userAgent}</p>
        </details>
      )}
      <p className="mt-2 text-[11.5px] text-outline">Idioma, zona horaria, pantalla y app instalada los informa el propio navegador: sirven de pista, no de prueba.</p>
    </Block>
  );
}

export function AdminOrderDetail({ orderId, onClose, onFilterIp }) {
  const panelRef = useRef(null);
  const [lastFocus] = useState(() => document.activeElement);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-order", orderId],
    queryFn: async () => (await api.get(`/admin/orders/${orderId}`)).data,
  });

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      lastFocus?.focus?.();
    };
  }, [onClose, lastFocus]);

  const o = data?.order;
  const st = o ? orderStatusOf(o) : null;
  const currency = o?.items?.find((i) => i.currency)?.currency ?? o?.vendor?.currency ?? "CUP";
  // El país solo se nombra si no es Cuba (casi todos los pedidos lo son).
  const place = o ? [o.municipalityName, o.provinceName, o.countryName && !/^cuba$/i.test(o.countryName) ? o.countryName : null].filter(Boolean).join(", ") : "";
  const events = o ? [...(o.events.some((e) => e.type === "CREATED") ? [] : [{ id: "created", type: "CREATED", createdAt: o.createdAt }]), ...o.events] : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-inverse-surface/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={o ? `Pedido ${o.code}` : "Pedido"} className="flex h-full w-full max-w-[640px] flex-col bg-surface-container-lowest shadow-xl outline-none">
        <header className="flex items-start justify-between gap-3 border-b border-surface-container-high px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-[18px] font-extrabold text-on-surface">
              {o ? (
                <>
                  <span className="font-mono">{o.code}</span>
                  <CopyButton text={o.code} what="Código" />
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${st.tone}`}>{st.label}</span>
                </>
              ) : (
                "Pedido"
              )}
            </h2>
            {o && (
              <p className="text-[12.5px] text-on-surface-variant">
                {exactDateTime(o.createdAt)} ({timeAgo(o.createdAt).toLowerCase()}) · {o.pos ? `Caja ${o.pos.code}` : channelLabel(o.channel)} · {o.vendor.companyName}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container hover:text-on-surface">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-6">
          {isLoading && (
            <div className="space-y-3 p-6" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-container" />
              ))}
            </div>
          )}
          {isError && (
            <div className="flex flex-col items-start gap-3 p-6">
              <p className="text-body-md text-error">No se pudo cargar el pedido.</p>
              <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
            </div>
          )}

          {o && (
            <>
              {o.status === "CANCELLED" && (o.cancelReason || o.autoCancelledAt) && (
                <p className="mx-4 mt-3 rounded-xl bg-error/5 px-3 py-2 text-[13px] text-error sm:mx-6">
                  {o.cancelReason ? <>Motivo de la anulación: {o.cancelReason}</> : <>Lo cerró el sistema el {exactDateTime(o.autoCancelledAt)} porque la tienda no lo confirmó a tiempo.</>}
                </p>
              )}

              <Block icon={User} title="Cliente">
                <Rows
                  rows={[
                    ["Nombre", o.customerName],
                    [
                      "Teléfono",
                      o.customerPhone ? (
                        <>
                          <a href={`https://wa.me/${o.customerPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="font-semibold text-tertiary-accent underline">{o.customerPhone}</a>
                          <CopyButton text={o.customerPhone} what="Teléfono" />
                        </>
                      ) : null,
                    ],
                    [
                      "Correo",
                      o.customerEmail ? (
                        <>
                          <a href={`mailto:${o.customerEmail}`} className="text-tertiary-accent underline">{o.customerEmail}</a>
                          <CopyButton text={o.customerEmail} what="Correo" />
                        </>
                      ) : null,
                    ],
                    [
                      "Cuenta",
                      o.pos ? null : o.customer ? (
                        <>
                          Tiene cuenta desde el {exactDateTime(o.customer.createdAt)}
                          {o.customer.lastLoginAt ? `, entró por última vez ${timeAgo(o.customer.lastLoginAt).toLowerCase()}` : ""}
                          {o.customer.isSuspended && <span className="font-bold text-error"> · Suspendida</span>}
                          {o.customer.email !== o.customerEmail && <span className="block text-[12px] text-on-surface-variant">Correo de la cuenta: {o.customer.email}</span>}
                          <Link to={`/admin/clientes?q=${encodeURIComponent(o.customer.email)}`} className="block text-[12.5px] font-bold text-tertiary-accent">Ver en Clientes</Link>
                        </>
                      ) : (
                        "Compró sin cuenta"
                      ),
                    ],
                    [
                      "Sus pedidos",
                      o.pos
                        ? null
                        : `${data.customerHistory.atThisStore} en esta tienda · ${data.customerHistory.totalOrders} en todo Baznova${data.customerHistory.otherStores ? ` (en ${data.customerHistory.otherStores} ${data.customerHistory.otherStores === 1 ? "tienda más" : "tiendas más"})` : ""}`,
                    ],
                  ]}
                />
              </Block>

              {!o.pos && (
                <Block icon={MapPin} title="Entrega">
                  <Rows
                    rows={[
                      ["Recibe", o.recipientName ? `${o.recipientName}${o.recipientPhone ? ` · ${o.recipientPhone}` : ""}` : "La misma persona que compra"],
                      [o.recipientIdLabel ?? "Documento", o.recipientIdNumber],
                      ["Lugar", place],
                      ["Dirección", o.shippingAddress],
                      ["Mesa", o.tableNumber],
                      ["Envío", o.shippingSource ? orderShippingText(o) : null],
                      ["Zona de envío", o.shippingZone === "LOCAL" ? "Dentro de la provincia de la tienda" : o.shippingZone === "OTHER" ? "Fuera de la provincia de la tienda" : null],
                    ]}
                  />
                </Block>
              )}

              <Block icon={Package} title="Productos y pago">
                <ul className="flex flex-col gap-2">
                  {o.items.map((it) => (
                    <li key={it.id} className="flex items-start gap-3 rounded-xl border border-surface-container-high p-2.5">
                      {it.product?.images?.[0] ? (
                        <img src={it.product.images[0]} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="h-12 w-12 flex-shrink-0 rounded-lg bg-surface-container" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 text-[13px]">
                        <span className="block font-semibold text-on-surface">
                          {it.quantity} × {it.name}
                          {it.size && ` (${it.size})`}
                        </span>
                        <span className="block text-[12px] text-on-surface-variant">{formatPrice(it.price, it.currency)} cada uno</span>
                        {optionsText(it.selectedOptions) && <span className="block text-[12px] text-on-surface-variant">{optionsText(it.selectedOptions)}</span>}
                        {orderLineShippingText(it) && <span className="block text-[11.5px] text-outline">{orderLineShippingText(it)}</span>}
                        {!it.product && <span className="block text-[11.5px] text-outline">La tienda ya borró este producto.</span>}
                      </span>
                      <span className="flex-shrink-0 text-[13px] font-bold text-on-surface">{formatPrice(Number(it.price) * it.quantity, it.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Rows
                    rows={[
                      ["Forma de pago", o.pos ? `Caja · ${METHOD_LABEL[o.pos.paymentMethod] ?? o.pos.paymentMethod ?? "sin dato"}` : channelLabel(o.channel)],
                      ["Recibido y vuelto", o.pos?.paymentMethod === "CASH" ? `${formatPrice(o.pos.cashReceived ?? 0, currency)} / ${formatPrice(o.pos.changeGiven ?? 0, currency)}` : null],
                      ["Atendió", o.pos?.cashier],
                      ["Descuento", o.discountAmount > 0 ? `-${formatPrice(o.discountAmount, currency)}${o.discountCode ? ` (código ${o.discountCode.code})` : ""}` : null],
                      ["Puntos usados", o.loyaltyPointsRedeemed > 0 ? `${o.loyaltyPointsRedeemed} puntos (-${formatPrice(o.loyaltyDiscount, currency)})` : null],
                      ["Puntos ganados", o.loyaltyPointsEarned > 0 ? `${o.loyaltyPointsEarned} puntos` : null],
                      ["Aviso a la tienda", o.notificationChannel === "BOTH" ? "Panel y WhatsApp" : o.notificationChannel === "PANEL" ? "Panel" : o.notificationChannel],
                    ]}
                  />
                  {o.shippingCoordinate && <p className="mt-1 text-[12px] text-outline">Hay envío a coordinar con el cliente: no está en el total.</p>}
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-surface-container-high pt-2">
                    <span className="text-[13px] font-semibold text-on-surface-variant">Total</span>
                    <span className="text-right text-[18px] font-extrabold text-primary">{orderTotalLabel(o)}</span>
                  </div>
                </div>
              </Block>

              <ConnectionBlock request={data.request} order={o} sameIpOrders={data.sameIpOrders} onFilterIp={onFilterIp} />

              <Block icon={History} title="Historial">
                <ul className="flex flex-col gap-1.5">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                      <span className="text-on-surface">
                        <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                        {e.detail && <span className="text-on-surface-variant"> · {e.detail}</span>}
                      </span>
                      <span className="flex-shrink-0 text-outline">{exactDateTime(e.createdAt)}</span>
                    </li>
                  ))}
                </ul>
                {o.emailLogs.length > 0 && (
                  <>
                    <h4 className="mb-1.5 mt-4 flex items-center gap-1.5 text-[12px] font-bold text-on-surface-variant">
                      <Globe2 className="h-3.5 w-3.5" aria-hidden="true" /> Correos de este pedido
                    </h4>
                    <ul className="flex flex-col gap-1.5">
                      {o.emailLogs.map((m) => (
                        <li key={m.id} className="text-[12.5px]">
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0 text-on-surface">
                              {m.subject} <span className="text-on-surface-variant">· a {m.to}</span>
                            </span>
                            <span className={`flex-shrink-0 font-semibold ${m.status === "SENT" ? "text-verified-dark" : "text-error"}`}>{EMAIL_STATUS[m.status] ?? m.status}</span>
                          </span>
                          <span className="block text-[11.5px] text-outline">
                            {exactDateTime(m.createdAt)}
                            {m.error ? ` · ${m.error}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Block>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
