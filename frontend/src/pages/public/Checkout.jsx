import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { CheckCircle2, MessageCircle, Globe2, MapPin, Store, Tag, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { waLink } from "../../lib/whatsapp.js";
import { resolveUnitPrice } from "../../lib/pricing.js";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { CHECKOUT_PAY_CHOICES } from "../../lib/checkoutPayment.js";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { ComboSelect } from "../../components/ui/ComboSelect.jsx";
import { LoyaltyBox, useCheckoutLoyalty } from "../../components/checkout/LoyaltyBox.jsx";

// Bloque 231: "Fecha y hora" del ticket de confirmación — mismo formato
// corto que ya usa fmtDate en VendorOffers.jsx, con hora agregada.
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Bloque 232: mismo criterio que Cart.jsx — un código de descuento en CUP
// solo tiene sentido honesto si TODOS los ítems están en la misma moneda
// (el carrito ya es de un solo vendedor, pero el vendedor puede cargar
// productos en distintas monedas).
function singleCurrencySubtotal(items) {
  const currencies = new Set(items.map((i) => i.currency ?? "CUP"));
  if (currencies.size > 1) return null;
  return items.reduce((sum, i) => sum + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0);
}

const PAY_OPTIONS = CHECKOUT_PAY_CHOICES;

// Bloque 68 (pedido explícito): mensaje de WhatsApp del pedido YA
// confirmado (con datos reales del cliente, siempre completados en el
// formulario de arriba) — organizado por secciones con líneas separadoras
// (guiones repetidos, no una tabla de ancho fijo) para que se lea bien en
// cualquier ancho de pantalla dentro de WhatsApp. Reemplaza los mensajes
// sueltos que antes armaba cada atajo que saltaba el formulario (ya
// eliminados de Product.jsx/Cart.jsx/CartDrawer.jsx).
const WA_SEPARATOR = "──────────────────";

function buildOrderWhatsAppText(info) {
  const lines = [
    `🛍️ *Pedido ${info.orderCode}* — ${info.vendorName}`,
    WA_SEPARATOR,
    "📦 *Productos*",
    ...info.items.map(
      (it) => `• ${it.quantity}× ${it.name}${it.size ? ` (talla ${it.size})` : ""} — ${formatPrice(it.unitPrice, it.currency)} c/u`
    ),
    WA_SEPARATOR,
  ];
  if (info.discount) {
    lines.push(`🏷️ Descuento (${info.discount.code}): -${formatPrice(info.discount.amount)}`);
  }
  if (info.loyaltyPoints) {
    lines.push(`⭐ Puntos usados (${info.loyaltyPoints}): -${formatPrice(info.loyaltyDiscount, info.loyaltyCurrency)}`);
  }
  lines.push(`💰 *Total:* ${info.totalLabel}`, WA_SEPARATOR, "👤 *Datos del cliente*", `Nombre: ${info.customerName}`, `Teléfono: ${info.customerPhone}`);
  if (info.recipient) lines.push(`Recibe: ${info.recipient.name} (${info.recipient.phone})`);
  lines.push(`Entrega: ${info.address}`, WA_SEPARATOR, `💳 Pago: ${info.payTitle}`);
  return lines.join("\n");
}

export default function Checkout() {
  const { siteName } = usePlatformSettings();
  const { items, vendorId, vendorName, vendorSlug, vendorColor, clearCart, updateQuantity, removeItem, discount, setDiscount, clearDiscount } = useCart();
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const [confirmedInfo, setConfirmedInfo] = useState(null);
  const [pay, setPay] = useState("cod");
  const [selectedCountryId, setSelectedCountryId] = useState("");
  // Bloque 232 (pedido explícito — "si la tienda tiene códigos de ofertas
  // generados debe aparecer al cliente completar el pedido un input para
  // introducir el código de su oferta si tiene uno"): antes el único lugar
  // donde el cliente podía escribir un código era Cart.jsx (la página de
  // carrito completo) — el mini-carrito y Checkout nunca lo ofrecían, así
  // que un cliente que llegaba directo a /checkout (desde "Completar
  // pedido" del carrito lateral) no tenía forma de aplicar uno. Mismo
  // patrón exacto que ya usa Cart.jsx (POST /discount-codes/validate).
  const [codeInput, setCodeInput] = useState("");
  const queryClient = useQueryClient();
  const loyalty = useCheckoutLoyalty({ vendorId, items, discountAmount: discount?.amount ?? 0, user });
  const [form, setForm] = useState({
    customerName: user?.fullName ?? "",
    customerPhone: user?.phone ?? "",
    customerEmail: user?.email ?? "",
    provinceId: "",
    // Bloque 231 (pedido explícito, con captura — "la parte donde se
    // muestran o se filtran las provincias... está bien, pero la que le
    // sigue de municipio deben filtrarse los municipios... si selecciona
    // una provincia de Cuba son municipios y si selecciona un estado de
    // otro país ya no son municipios, serían ciudad"): antes un solo campo
    // de texto libre ("Municipio *") servía para los dos casos — ahora
    // `municipalityId` es el municipio REAL (FK, mismo catálogo filtrado
    // por provincia que ya usa Account.jsx para la ubicación del cliente/
    // tienda) cuando la provincia elegida es cubana, y `cityOther` es texto
    // libre ("Ciudad") cuando lo elegido es un STATE de otro país — nunca
    // los dos a la vez, mutuamente excluyentes según `isStateSelected` de
    // abajo, igual que el propio backend ya distingue (Order.shippingMunicipalityId
    // vs. el resto de shippingAddress en texto libre).
    municipalityId: "",
    cityOther: "",
    address: "",
    // Quien recibe, si no es quien compra (por ejemplo, alguien fuera de Cuba que compra para su familia).
    forSomeoneElse: false,
    recipientName: "",
    recipientPhone: "",
  });

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Mismo endpoint/patrón que Account.jsx (municipalitiesForPersonProvince) —
  // catálogo real, filtrado por la provincia elegida, nunca se pide sin una
  // provincia cubana ya seleccionada.
  const { data: municipalitiesForProvince = [] } = useQuery({
    queryKey: ["municipalities-for-province", form.provinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${form.provinceId}/municipalities`)).data.municipalities,
    enabled: !!form.provinceId,
  });

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug,
  });

  // Bloque 68: 3 valores reales ahora (WHATSAPP | PANEL | BOTH) — el pedido
  // SIEMPRE se crea acá (con el formulario completo, siempre obligatorio),
  // esto solo decide qué le ofrecemos al cliente en la confirmación. Se
  // captura en `confirmedInfo` en el momento del éxito (ver onSuccess) — la
  // pantalla de confirmación NUNCA debe releer esta variable en vivo,
  // porque `clearCart()` resetea el vendedor del contexto (`vendorSlug`
  // queda null), lo que apagaría esta query y volvería `orderDestination`
  // al default silenciosamente.
  const orderDestination = vendor?.orderDestination ?? "WHATSAPP";

  // Solo las formas de pago que la tienda dejó activas (por defecto, las tres).
  const payOptions = useMemo(() => {
    const allowed = vendor?.checkoutPaymentOptions?.length ? vendor.checkoutPaymentOptions : PAY_OPTIONS.map((p) => p.id);
    const list = PAY_OPTIONS.filter((p) => allowed.includes(p.id));
    return list.length ? list : PAY_OPTIONS;
  }, [vendor]);
  useEffect(() => {
    if (!payOptions.some((p) => p.id === pay)) setPay(payOptions[0].id);
  }, [payOptions, pay]);

  // Derive vendor's delivery countries
  const vendorCountries = useMemo(() => {
    if (!vendor) return [];
    const map = new Map();
    (vendor.locations ?? []).forEach((l) => {
      if (l.province?.country) {
        map.set(l.province.country.id, l.province.country);
      }
    });
    (vendor.deliveryCountries ?? []).forEach((dc) => {
      if (dc.country) {
        map.set(dc.country.id, dc.country);
      }
    });
    return Array.from(map.values());
  }, [vendor]);

  // Default to first country
  useEffect(() => {
    if (vendorCountries.length > 0 && !selectedCountryId) {
      setSelectedCountryId(vendorCountries[0].id);
    }
  }, [vendorCountries, selectedCountryId]);

  // Derive vendor's provinces/states for selected country
  //
  // Auditoría 2026-08-06 (Crítico #2 de AUDITORIA.md): con `selectedCountryId`
  // sin resolver (típicamente porque el vendedor no tiene `locations`/
  // `deliveryCountries` con un país válido — ver `vendorCountries` arriba,
  // o porque a una provincia le falta `countryId` en la base) este memo
  // cortaba acá mismo y el checkout quedaba sin ninguna provincia para
  // elegir, aun cuando el selector de país (más abajo, rama `vendorCountries
  // .length <= 1`) ya le muestra "Cuba" al cliente como si todo estuviera
  // resuelto. Se saca el `return []` temprano por `!selectedCountryId` y se
  // vuelven opcionales los filtros por país (`!selectedCountryId || ...`):
  // con país resuelto, el comportamiento es idéntico a antes (mismo filtro
  // por país); sin país resuelto, cae directo al fallback de "todas las
  // provincias activas" en vez de no ofrecer ninguna.
  const vendorProvincesForCountry = useMemo(() => {
    if (!vendor) return [];
    const provMap = new Map();
    (vendor.locations ?? []).forEach((l) => {
      if (l.province && (!selectedCountryId || l.province.countryId === selectedCountryId || l.province.country?.id === selectedCountryId)) {
        provMap.set(l.province.id, l.province);
      }
    });
    // Fallback: si el vendedor no tiene provincias propias para el país
    // resuelto (o no hay país resuelto en absoluto), ofrecer todas las
    // provincias activas — filtradas por país solo cuando hay uno real.
    if (provMap.size === 0 && provinces) {
      provinces
        .filter((p) => !selectedCountryId || p.countryId === selectedCountryId || p.country?.id === selectedCountryId)
        .forEach((p) => provMap.set(p.id, p));
    }
    return Array.from(provMap.values());
  }, [vendor, selectedCountryId, provinces]);

  const discountSubtotal = singleCurrencySubtotal(items);
  const applyDiscount = useMutation({
    mutationFn: async () => (await api.post("/discount-codes/validate", { vendorId, code: codeInput.trim(), subtotal: discountSubtotal })).data,
    onSuccess: ({ discount: applied }) => {
      setDiscount(applied);
      setCodeInput("");
      toast.success(`Código "${applied.code}" aplicado — descuento de ${formatPrice(applied.amount)}.`);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo aplicar el código."),
  });

  // Si la tienda entrega solo en algunos municipios de esa provincia, el cliente solo ve esos.
  const deliverableMunicipalities = useMemo(() => {
    const allowedIds = new Set(
      (vendor?.locations ?? []).filter((l) => l.provinceId === form.provinceId && l.municipalityId).map((l) => l.municipalityId)
    );
    return allowedIds.size ? municipalitiesForProvince.filter((m) => allowedIds.has(m.id)) : municipalitiesForProvince;
  }, [vendor, form.provinceId, municipalitiesForProvince]);

  const selectedProvince = useMemo(() => {
    if (!form.provinceId) return null;
    return provinces?.find((p) => p.id === form.provinceId) ?? vendorProvincesForCountry.find((p) => p.id === form.provinceId) ?? null;
  }, [form.provinceId, provinces, vendorProvincesForCountry]);

  const isStateSelected = selectedProvince?.type === "STATE";
  // La tienda limitó esa provincia o estado a algunos municipios o ciudades: solo se puede elegir de esa lista.
  const citiesRestricted = useMemo(
    () => (vendor?.locations ?? []).some((l) => l.provinceId === form.provinceId && l.municipalityId),
    [vendor, form.provinceId]
  );
  // En un estado se puede escribir la ciudad si no está en la lista (o si el estado no tiene ninguna cargada); en una provincia
  // de Cuba el municipio siempre sale de la lista.
  const [cityIsOther, setCityIsOther] = useState(false);
  const canWriteCity = isStateSelected && !citiesRestricted;
  const writingCity = canWriteCity && (cityIsOther || deliverableMunicipalities.length === 0);

  const selectedMunicipalityName = useMemo(() => {
    if (!form.municipalityId) return null;
    return municipalitiesForProvince.find((m) => m.id === form.municipalityId)?.name ?? null;
  }, [form.municipalityId, municipalitiesForProvince]);

  const allFieldsFilled =
    form.customerName.trim() &&
    form.customerPhone.trim() &&
    form.customerEmail.trim() &&
    form.provinceId &&
    (form.municipalityId || (writingCity && form.cityOther.trim())) &&
    form.address.trim() &&
    (!form.forSomeoneElse || (form.recipientName.trim().length >= 2 && /^\+\d{7,15}$/.test(form.recipientPhone)));

  const placeOrder = useMutation({
    mutationFn: async () =>
      (
        await api.post("/orders", {
          vendorId,
          channel: pay,
          customerName: form.customerName,
          // El teléfono de una cuenta puede estar guardado sin el "+" del código de país: el servidor lo exige.
          customerPhone: /^\+/.test(form.customerPhone.trim()) ? form.customerPhone.trim() : `+${form.customerPhone.replace(/\D/g, "")}`,
          customerEmail: form.customerEmail,
          recipientName: form.forSomeoneElse ? form.recipientName.trim() : undefined,
          recipientPhone: form.forSomeoneElse ? form.recipientPhone : undefined,
          shippingProvinceId: form.provinceId || undefined,
          shippingMunicipalityId: form.municipalityId || undefined,
          shippingAddress: [form.municipalityId ? selectedMunicipalityName : form.cityOther, form.address].filter(Boolean).join(" — ") || undefined,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, selectedOptions: i.selectedOptions, size: i.size ?? undefined })),
          discountCode: discount?.code ?? undefined,
          loyaltyPoints: loyalty.used || undefined,
        })
      ).data,
    onSuccess: ({ order }) => {
      // Bloque 68: se captura todo lo necesario para armar el mensaje de
      // WhatsApp bien formateado (con los datos reales que el cliente
      // ACABA de completar en el formulario) sin tener que reconsultar nada.
      const totalLabel = loyalty.used
        ? formatPrice(Number(order.total), loyalty.program.currency)
        : discount
        ? formatPrice(
            Math.max(0, items.reduce((s, i) => s + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0) - discount.amount)
          )
        : formatMixedTotal(items);
      setConfirmedInfo({
        vendorName,
        // Bug real preexistente (encontrado de paso): `vendorSlug` del
        // contexto queda `undefined` apenas se llama `clearCart()` más
        // abajo (resetea el vendedor del carrito) — el link "Volver a la
        // tienda" de la pantalla de confirmación quedaba armando
        // `/v/undefined` (y ese prefijo tampoco es una ruta real — la
        // tienda vive en `/tienda/:slug`, ver App.jsx). Se captura acá,
        // antes de limpiar el carrito.
        vendorSlug,
        provinceName: selectedProvince?.name ?? "tu provincia/estado",
        orderDestination,
        vendorWhatsapp: vendor?.whatsapp,
        orderCode: order.code,
        createdAt: order.createdAt,
        items: items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          size: i.size,
          unitPrice: resolveUnitPrice(i.price, i.priceTiers, i.quantity),
          currency: i.currency,
        })),
        totalLabel,
        discount,
        loyaltyPoints: loyalty.used,
        loyaltyDiscount: loyalty.discount,
        loyaltyCurrency: loyalty.program?.currency,
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        recipient: form.forSomeoneElse ? { name: form.recipientName.trim(), phone: form.recipientPhone } : null,
        address: [form.municipalityId ? selectedMunicipalityName : form.cityOther, form.address].filter(Boolean).join(" — "),
        payTitle: PAY_OPTIONS.find((p) => p.id === pay)?.title ?? pay,
      });
      clearCart();
      setDone(true);
      window.scrollTo(0, 0);
    },
    onError: (err) => {
      const insufficientStock = err.response?.data?.details?.insufficientStock;
      if (err.response?.status === 409 && insufficientStock?.length) {
        for (const item of insufficientStock) {
          if (item.available > 0) updateQuantity(item.productId, item.available, item.size ?? null);
          else removeItem(item.productId, item.size ?? null);
        }
        toast.error(
          insufficientStock.length === 1
            ? `"${insufficientStock[0].name}" ya no tiene suficiente stock. Ajustamos tu carrito a ${insufficientStock[0].available} disponibles.`
            : "Algunos productos ya no tienen suficiente stock. Ajustamos tu carrito a lo disponible."
        );
      } else {
        // Si el saldo de puntos o las reglas de la tienda cambiaron, se vuelven a pedir para mostrar lo correcto.
        if (/puntos/i.test(err.response?.data?.error ?? "")) queryClient.invalidateQueries({ queryKey: ["loyalty-checkout"] });
        toast.error(err.response?.data?.error ?? "No se pudo realizar el pedido.");
      }
    },
  });

  if (done && confirmedInfo) {
    const showWhatsappCta = confirmedInfo.orderDestination !== "PANEL";
    const href = showWhatsappCta ? waLink(confirmedInfo.vendorWhatsapp, buildOrderWhatsAppText(confirmedInfo)) : null;

    return (
      <div className="mx-auto max-w-md px-4 py-14">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-verified/10 text-verified">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="text-center text-display-sm font-extrabold text-on-surface">¡Pedido enviado con éxito!</h1>
        <p className="mt-1.5 text-center text-body-md text-on-surface-variant">{confirmedInfo.vendorName} ya recibió tu pedido. Gracias por tu compra.</p>

        {/* Bloque 231 (pedido explícito, con imagen de referencia — "vamos a
            mejorar esa ventana, debe mostrarse más moderno, usaremos este
            estilo... que tiene el código de barras, solo que en mi página
            no hará falta el código de barras así que lo cambiaremos por el
            número del pedido"): tarjeta tipo "ticket" con 2 mitades y una
            línea punteada con muescas circulares entre ellas — mismo truco
            que la referencia (2 círculos del color de la página, `bg-background`,
            mordiendo el borde de la tarjeta blanca `bg-surface-container-lowest`).
            Donde la referencia tenía un código de barras (no aplica acá,
            esto no es una entrada física), va el número de pedido en
            grande, en vez de repetir el mismo dato ya mostrado arriba. */}
        <div className="relative mx-auto mt-7 max-w-sm">
          <div className="rounded-t-[28px] bg-surface-container-lowest px-6 pb-6 pt-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_40px_-16px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-outline">Código de pedido</div>
                <div className="mt-0.5 font-mono text-[14.5px] font-extrabold text-on-surface">{confirmedInfo.orderCode}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wide text-outline">Total</div>
                <div className="mt-0.5 text-[14.5px] font-extrabold text-on-surface">{confirmedInfo.totalLabel}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-outline">Fecha y hora</div>
              <div className="mt-0.5 text-[13px] font-semibold text-on-surface">{fmtDateTime(confirmedInfo.createdAt)}</div>
            </div>
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-wide text-outline">
                Detalle: {confirmedInfo.items.length} {confirmedInfo.items.length === 1 ? "producto" : "productos"}, {confirmedInfo.items.reduce((s, i) => s + i.quantity, 0)} {confirmedInfo.items.reduce((s, i) => s + i.quantity, 0) === 1 ? "unidad" : "unidades"}
              </div>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {confirmedInfo.items.map((it, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-3 text-[12.5px] text-on-surface">
                    <span className="min-w-0">
                      <span className="font-semibold">{it.quantity} × {it.name}</span>
                      {it.size && <span className="text-outline"> · talla {it.size}</span>}
                      <span className="block text-[11px] text-outline">{formatPrice(it.unitPrice, it.currency)} c/u</span>
                    </span>
                    <span className="flex-shrink-0 font-semibold">{formatPrice(it.unitPrice * it.quantity, it.currency)}</span>
                  </li>
                ))}
              </ul>
              {confirmedInfo.discount && (
                <div className="mt-1.5 flex justify-between text-[12px] text-verified-dark">
                  <span>Descuento ({confirmedInfo.discount.code})</span>
                  <span>-{formatPrice(confirmedInfo.discount.amount)}</span>
                </div>
              )}
              {confirmedInfo.loyaltyPoints > 0 && (
                <div className="mt-1.5 flex justify-between text-[12px] text-verified-dark">
                  <span>Puntos usados ({confirmedInfo.loyaltyPoints})</span>
                  <span>-{formatPrice(confirmedInfo.loyaltyDiscount, confirmedInfo.loyaltyCurrency)}</span>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-[12.5px] text-on-surface sm:grid-cols-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-outline">Entrega en</div>
                <div className="mt-0.5 font-semibold">{confirmedInfo.address || confirmedInfo.provinceName}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-outline">Forma de pago</div>
                <div className="mt-0.5 font-semibold">{confirmedInfo.payTitle}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-surface-container/60 p-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
                <Store className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-bold text-on-surface">{confirmedInfo.vendorName}</div>
                <div className="text-[11px] text-outline">Recibe y confirma tu pedido</div>
              </div>
            </div>
          </div>

          {/* Muesca: 2 círculos del color de la página mordiendo el borde
              izquierdo/derecho de la tarjeta, sobre una línea punteada. */}
          <div className="relative">
            <span className="absolute -left-3.5 top-0 h-7 w-7 -translate-y-1/2 rounded-full bg-background" />
            <span className="absolute -right-3.5 top-0 h-7 w-7 -translate-y-1/2 rounded-full bg-background" />
            <div className="border-t-2 border-dashed border-surface-container-high" />
          </div>

          <div className="rounded-b-[28px] bg-surface-container-lowest px-6 pb-7 pt-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_40px_-16px_rgba(15,23,42,0.18)]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-outline">Tu número de pedido</div>
            <div className="mt-1.5 font-mono text-[22px] font-extrabold tracking-[0.3em] text-on-surface">{confirmedInfo.orderCode}</div>
          </div>
        </div>

        {/* Bloque 68: los 2 bloques de abajo ya no son mutuamente
            excluyentes — con orderDestination:"BOTH" se muestran los dos
            (WhatsApp + panel), con "WHATSAPP"/"PANEL" solo el que corresponde.
            Bloque 231: mismo radio (rounded-2xl) que la tarjeta de arriba —
            antes era rounded-lg, un nivel distinto sin motivo. */}
        {showWhatsappCta && (
          <div className="mt-6 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 text-left">
            <p className="text-body-md text-on-surface-variant">
              Envíale tu pedido a <span className="font-semibold text-on-surface">{confirmedInfo.vendorName}</span> por WhatsApp para
              ultimar la entrega en {confirmedInfo.provinceName}.
            </p>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-label-lg font-bold text-white shadow hover:opacity-90"
              >
                <MessageCircle className="h-5 w-5" /> Enviar pedido por WhatsApp
              </a>
            ) : (
              <p className="mt-3 text-body-sm text-outline">
                (La tienda todavía no configuró su número de WhatsApp en el perfil.)
              </p>
            )}
          </div>
        )}
        <div className="mt-6 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 text-left">
          <h2 className="text-title-md font-bold text-on-surface">¿Qué sigue?</h2>
          <ul className="mt-2 flex flex-col gap-2 text-body-md text-on-surface-variant">
            <li>
              Un empleado de <span className="font-semibold text-on-surface">{confirmedInfo.vendorName}</span> revisará tu pedido y te contactará
              por WhatsApp o por teléfono al <span className="font-semibold text-on-surface">{confirmedInfo.customerPhone}</span>.
            </li>
            <li>La tienda atiende los pedidos en el orden en que van llegando. Te pedimos paciencia: te van a contactar.</li>
          </ul>
        </div>

        <div className="mt-8 text-center">
          <Link to={`/tienda/${confirmedInfo.vendorSlug}`} className="text-label-lg font-bold text-tertiary-accent hover:underline">
            Volver a la tienda
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-display-sm font-extrabold text-on-surface">El carrito está vacío</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">Agrega productos antes de realizar un pedido.</p>
        <div className="mt-6">
          {/* Bug real preexistente (encontrado de paso): "/stores" no es una
              ruta real — la lista de tiendas vive en "/tiendas" (ver App.jsx). */}
          <Link to="/tiendas" className="text-label-lg font-bold text-tertiary-accent hover:underline">
            Ver tiendas disponibles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-display-sm font-extrabold text-on-surface">Finalizar compra</h1>
          <p className="text-body-md text-on-surface-variant">
            Comprando en{" "}
            <Link to={`/tienda/${vendorSlug}`} className="font-bold text-on-surface hover:underline">
              {vendorName}
            </Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <div className="md:col-span-7 flex flex-col gap-6">
          {/* Customer Info Form */}
          <div className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-6">
            <h2 className="mb-1 text-title-lg font-bold text-on-surface">Datos de contacto y entrega</h2>
            <p className="mb-4 text-[12.5px] text-outline">
              Puedes comprar desde cualquier país. La entrega se hace donde la tienda reparte.
            </p>
            <div className="mb-3 flex flex-col gap-3">
              <input
                data-guard="name"
                autoComplete="name"
                placeholder="Nombre y apellido completo *"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
              />
              <PhoneInput
                anyCountry
                label="Tu teléfono (de cualquier país)"
                value={form.customerPhone}
                onChange={(val) => setForm((f) => ({ ...f, customerPhone: val }))}
              />
              <input
                type="email"
                placeholder="Correo electrónico *"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
              />
            </div>

            {/* Quién recibe: por defecto la misma persona; si es otra, su nombre y teléfono para que la tienda coordine la entrega. */}
            <fieldset className="mb-4 rounded-xl border border-surface-container-high p-3">
              <legend className="px-1 text-[13px] font-bold text-on-surface">¿Quién recibe el pedido?</legend>
              <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  [false, "Lo recibo yo"],
                  [true, "Otra persona"],
                ].map(([value, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={form.forSomeoneElse === value}
                    onClick={() => setForm((f) => ({ ...f, forSomeoneElse: value }))}
                    className={`min-h-11 rounded-lg border-2 px-3 text-left text-[13.5px] font-semibold ${form.forSomeoneElse === value ? "border-primary bg-primary/[0.04] text-on-surface" : "border-outline-variant text-on-surface-variant"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {form.forSomeoneElse && (
                <div className="mt-3 flex flex-col gap-3">
                  <input
                    data-guard="name"
                    placeholder="Nombre y apellido de quien recibe *"
                    value={form.recipientName}
                    onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                    className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
                  />
                  <PhoneInput anyCountry label="Teléfono de quien recibe" value={form.recipientPhone} onChange={(val) => setForm((f) => ({ ...f, recipientPhone: val }))} />
                </div>
              )}
            </fieldset>

            {/* Dónde se entrega: solo los lugares donde reparte la tienda (tu contacto puede ser de cualquier país). */}
            <p className="mb-2 text-[13px] font-bold text-on-surface">Dónde se entrega</p>
            <p className="mb-2 text-[12px] text-outline">Solo aparecen los lugares donde {vendorName || "la tienda"} hace entregas.</p>
            <div className="mb-3 flex flex-col gap-3">
              {/* Country Selector */}
              {vendorCountries.length > 1 ? (
                <div>
                  <label className="mb-1 block text-label-sm text-outline">País de entrega</label>
                  <select
                    value={selectedCountryId}
                    onChange={(e) => {
                      setSelectedCountryId(e.target.value);
                      setForm({ ...form, provinceId: "", municipalityId: "", cityOther: "" });
                    }}
                    className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
                  >
                    <option value="">Seleccionar País</option>
                    {vendorCountries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex h-11 items-center gap-2 rounded border border-outline-variant bg-surface-container px-3.5 text-body-md text-on-surface-variant">
                  <Globe2 className="h-4 w-4 text-tertiary-accent" />
                  {vendorCountries[0]?.name ?? "Cuba"}
                  <span className="ml-auto text-[11.5px] text-outline">País de entrega</span>
                </div>
              )}

              {/* State / Province & Municipality inputs */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select
                  value={form.provinceId}
                  onChange={(e) => {
                    setCityIsOther(false);
                    setForm({ ...form, provinceId: e.target.value, municipalityId: "", cityOther: "" });
                  }}
                  className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-body-md outline-none focus:border-tertiary-accent"
                >
                  <option value="">Provincia / Estado *</option>
                  {vendorProvincesForCountry.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.type === "STATE" ? "(Estado)" : "(Provincia)"}
                    </option>
                  ))}
                </select>

                {/* Provincia de Cuba: municipio de la lista. Estado de otro país: ciudad de la lista o, si no aparece (y la tienda no
                    limitó sus ciudades), escrita. Las listas largas se buscan escribiendo. */}
                {form.provinceId && !writingCity && deliverableMunicipalities.length >= 15 && (
                  <ComboSelect
                    value={form.municipalityId}
                    onChange={(v) => setForm({ ...form, municipalityId: v, cityOther: "" })}
                    options={deliverableMunicipalities.map((m) => ({ value: m.id, label: m.name }))}
                    maxShown={80}
                    placeholder={isStateSelected ? "Ciudad * (escribe para buscar)" : "Municipio * (escribe para buscar)"}
                    emptyText={isStateSelected ? "Ninguna ciudad coincide." : "Ningún municipio coincide."}
                  />
                )}
                {form.provinceId && !writingCity && deliverableMunicipalities.length > 0 && deliverableMunicipalities.length < 15 && (
                  <select
                    value={form.municipalityId}
                    onChange={(e) => setForm({ ...form, municipalityId: e.target.value, cityOther: "" })}
                    aria-label={isStateSelected ? "Ciudad" : "Municipio"}
                    className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-body-md outline-none focus:border-tertiary-accent"
                  >
                    <option value="">{isStateSelected ? "Ciudad *" : "Municipio *"}</option>
                    {deliverableMunicipalities.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
                {form.provinceId && writingCity && (
                  <input
                    placeholder="Ciudad *"
                    aria-label="Ciudad"
                    value={form.cityOther}
                    onChange={(e) => setForm({ ...form, cityOther: e.target.value, municipalityId: "" })}
                    className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
                  />
                )}
                {form.provinceId && canWriteCity && deliverableMunicipalities.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCityIsOther((v) => !v);
                      setForm({ ...form, municipalityId: "", cityOther: "" });
                    }}
                    className="min-h-9 justify-self-start text-label-sm font-semibold text-tertiary-accent hover:underline sm:col-span-2"
                  >
                    {cityIsOther ? "Elegir la ciudad de la lista" : "Mi ciudad no aparece"}
                  </button>
                )}
              </div>

              <textarea
                placeholder="Dirección exacta de entrega y referencias *"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="min-h-[74px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none focus:border-tertiary-accent"
              />
            </div>
          </div>

          {/* Payment Coordination */}
          <div className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-6">
            <div className="mb-1.5 text-title-lg font-bold text-on-surface">Cómo vas a coordinar el pago</div>
            <p className="mb-4 text-[12.5px] text-outline">
              No se cobra nada aquí: se arregla directo con la tienda. {siteName} nunca procesa ni recibe pagos.
            </p>
            <div className="flex flex-col gap-3">
              {payOptions.map((pm) => (
                <label
                  key={pm.id}
                  onClick={() => setPay(pm.id)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg p-4 transition-all ${
                    pay === pm.id
                      ? "border-2 border-secondary-container bg-secondary-container/5"
                      : "border border-surface-container-high hover:border-outline-variant"
                  }`}
                >
                  <input type="radio" name="pay" checked={pay === pm.id} onChange={() => setPay(pm.id)} className="h-4 w-4 accent-tertiary-accent" />
                  <div>
                    <div className="text-body-md font-bold text-on-surface">{pm.title}</div>
                    <div className="text-body-sm text-outline">{pm.sub}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Order Summary Right Pane */}
        <div className="md:col-span-5">
          <div className="sticky top-20 rounded-xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
            <h2 className="mb-4 text-title-lg font-bold text-on-surface">Resumen del pedido</h2>
            <div className="mb-4 flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
              {items.map((item) => {
                const unitPrice = resolveUnitPrice(item.price, item.priceTiers, item.quantity);
                return (
                  <div key={`${item.productId}-${item.size ?? ""}`} className="flex justify-between gap-3 text-body-md border-b border-surface-container-high pb-2.5 last:border-b-0">
                    <div>
                      <div className="font-semibold text-on-surface">
                        {item.name}
                        {item.size && <span className="ml-1.5 text-body-sm text-outline">(talla {item.size})</span>}
                      </div>
                      <div className="text-body-sm text-outline">
                        {item.quantity} x {formatPrice(unitPrice, item.currency)}
                      </div>
                    </div>
                    <div className="font-bold text-on-surface">{formatPrice(unitPrice * item.quantity, item.currency)}</div>
                  </div>
                );
              })}
            </div>
            {/* Bloque 232: mismo input que Cart.jsx, reusado acá para que un
                cliente que llega directo a /checkout también pueda aplicar
                un código sin tener que volver a la página del carrito. */}
            {discountSubtotal != null &&
              (discount ? (
                <div className="mb-3 flex items-center justify-between rounded-md bg-verified/10 px-3 py-2 text-[12.5px] font-semibold text-verified-dark">
                  <span className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5" /> {discount.code} aplicado (-{formatPrice(discount.amount)})
                  </span>
                  <button onClick={clearDiscount} className="rounded-full p-1 hover:bg-verified/15" title="Quitar código">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="mb-3 flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (codeInput.trim()) applyDiscount.mutate();
                      }
                    }}
                    placeholder="¿Tienes un código de oferta?"
                    className="h-10 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
                  />
                  <button
                    onClick={() => applyDiscount.mutate()}
                    disabled={!codeInput.trim() || applyDiscount.isPending}
                    className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[12.5px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                  >
                    {applyDiscount.isPending ? "..." : "Aplicar"}
                  </button>
                </div>
              ))}

            <LoyaltyBox loyalty={loyalty} vendorName={vendorName} />
            {loyalty.used > 0 && (
              <div className="mb-2 flex justify-between text-[12.5px] font-semibold text-verified-dark">
                <span>Puntos ({loyalty.used})</span>
                <span>-{formatPrice(loyalty.discount, loyalty.program.currency)}</span>
              </div>
            )}
            <div className="mb-6 flex justify-between border-t border-surface-container-high pt-4 text-title-md font-bold text-on-surface">
              <span>Total estimado</span>
              <span className="text-title-lg font-extrabold text-tertiary-accent">
                {loyalty.used
                  ? formatPrice(loyalty.total, loyalty.program.currency)
                  : discount
                  ? formatPrice(Math.max(0, items.reduce((s, i) => s + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0) - discount.amount))
                  : formatMixedTotal(items)}
              </span>
            </div>

            <button
              onClick={() => placeOrder.mutate()}
              disabled={!allFieldsFilled || placeOrder.isPending}
              className="w-full h-12 rounded-xl bg-secondary-container text-label-lg font-bold text-on-secondary-container shadow-md hover:bg-secondary-container/90 disabled:opacity-40 transition-all"
            >
              {placeOrder.isPending ? "Confirmando pedido..." : "Confirmar Pedido"}
            </button>
            {!allFieldsFilled && (
              <p className="mt-2 text-center text-[11.5px] text-outline">
                Completa todos los campos requeridos para confirmar.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
