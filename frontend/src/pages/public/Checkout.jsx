import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, MessageCircle, Globe2, MapPin } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { waLink } from "../../lib/whatsapp.js";
import { useCart } from "../../context/CartContext.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";

const PAY_OPTIONS = [
  { id: "cod", title: "Pago contra entrega", sub: "Coordinado por WhatsApp con el vendedor" },
  { id: "online", title: "Pago en línea con el vendedor", sub: "Transferencia, Zelle, etc. — arreglan método y monto directo por WhatsApp" },
  { id: "cash", title: "Efectivo", sub: "Coordinas el lugar y momento por WhatsApp" },
];

export default function Checkout() {
  const { siteName } = usePlatformSettings();
  const { items, vendorId, vendorName, vendorSlug, vendorColor, clearCart, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const [confirmedInfo, setConfirmedInfo] = useState(null);
  const [pay, setPay] = useState("cod");
  const [selectedCountryId, setSelectedCountryId] = useState("");
  const [form, setForm] = useState({
    customerName: user?.fullName ?? "",
    customerPhone: user?.phone ?? "",
    customerEmail: user?.email ?? "",
    provinceId: "",
    municipalityName: "",
    address: "",
  });

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug,
  });

  const wantsWhatsApp = (vendor?.orderDestination ?? "WHATSAPP") === "WHATSAPP";

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
  const vendorProvincesForCountry = useMemo(() => {
    if (!vendor || !selectedCountryId) return [];
    const provMap = new Map();
    (vendor.locations ?? []).forEach((l) => {
      if (l.province && (l.province.countryId === selectedCountryId || l.province.country?.id === selectedCountryId)) {
        provMap.set(l.province.id, l.province);
      }
    });
    // Fallback: if vendor specified country but no specific locations, allow all active provinces for that country
    if (provMap.size === 0 && provinces) {
      provinces
        .filter((p) => p.countryId === selectedCountryId || p.country?.id === selectedCountryId)
        .forEach((p) => provMap.set(p.id, p));
    }
    return Array.from(provMap.values());
  }, [vendor, selectedCountryId, provinces]);

  const selectedProvince = useMemo(() => {
    if (!form.provinceId) return null;
    return provinces?.find((p) => p.id === form.provinceId) ?? vendorProvincesForCountry.find((p) => p.id === form.provinceId) ?? null;
  }, [form.provinceId, provinces, vendorProvincesForCountry]);

  const isStateSelected = selectedProvince?.type === "STATE";

  const allFieldsFilled =
    form.customerName.trim() &&
    form.customerPhone.trim() &&
    form.customerEmail.trim() &&
    form.provinceId &&
    (isStateSelected || form.municipalityName.trim()) &&
    form.address.trim();

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
          shippingAddress: [isStateSelected ? null : form.municipalityName, form.address].filter(Boolean).join(" — ") || undefined,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, selectedOptions: i.selectedOptions, size: i.size ?? undefined })),
        })
      ).data,
    onSuccess: ({ order }) => {
      setConfirmedInfo({
        vendorName,
        provinceName: selectedProvince?.name ?? "tu provincia/estado",
        wantsWhatsApp,
        vendorWhatsapp: vendor?.whatsapp,
        orderCode: order.code,
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
        toast.error(err.response?.data?.error ?? "No se pudo realizar el pedido.");
      }
    },
  });

  if (done && confirmedInfo) {
    const waText = `¡Hola! Acabo de hacer el pedido ${confirmedInfo.orderCode} en ${confirmedInfo.vendorName}.`;
    const href = waLink(confirmedInfo.vendorWhatsapp, waText);

    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-verified/10 text-verified">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="text-display-sm font-extrabold text-on-surface">¡Pedido realizado!</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Tu código es <span className="font-mono font-bold text-on-surface">{confirmedInfo.orderCode}</span>.
        </p>

        {confirmedInfo.wantsWhatsApp ? (
          <div className="mt-6 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6 text-left">
            <p className="text-body-md text-on-surface-variant">
              Esta tienda coordina sus entregas por WhatsApp. Escribiles para ultimar el envío a{" "}
              <span className="font-semibold text-on-surface">{confirmedInfo.provinceName}</span>.
            </p>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#25D366] text-label-lg font-bold text-white shadow hover:opacity-90"
              >
                <MessageCircle className="h-5 w-5" /> Abrir WhatsApp con la tienda
              </a>
            ) : (
              <p className="mt-3 text-body-sm text-outline">
                (La tienda todavía no configuró su número de WhatsApp en el perfil.)
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6 text-left">
            <p className="text-body-md text-on-surface-variant">
              Le avisamos a <span className="font-semibold text-on-surface">{confirmedInfo.vendorName}</span> por correo. Te van a
              contactar pronto para coordinar la entrega.
            </p>
          </div>
        )}

        <div className="mt-8">
          <Link to={`/v/${vendorSlug}`} className="text-label-lg font-bold text-tertiary-accent hover:underline">
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
          <Link to="/stores" className="text-label-lg font-bold text-tertiary-accent hover:underline">
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
            <Link to={`/v/${vendorSlug}`} className="font-bold text-on-surface hover:underline">
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
              Completa tu información para que la tienda organice el envío.
            </p>
            <div className="mb-3 flex flex-col gap-3">
              <input
                placeholder="Nombre y apellido completo *"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
              />
              <PhoneInput
                value={form.customerPhone}
                onChange={(val) => setForm({ ...form, customerPhone: val })}
              />
              <input
                type="email"
                placeholder="Correo electrónico *"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
              />
            </div>

            {/* Dynamic Location Filtering */}
            <div className="mb-3 flex flex-col gap-3">
              {/* Country Selector */}
              {vendorCountries.length > 1 ? (
                <div>
                  <label className="mb-1 block text-label-sm text-outline">País de entrega</label>
                  <select
                    value={selectedCountryId}
                    onChange={(e) => {
                      setSelectedCountryId(e.target.value);
                      setForm({ ...form, provinceId: "", municipalityName: "" });
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
                  onChange={(e) => setForm({ ...form, provinceId: e.target.value, municipalityName: "" })}
                  className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-2.5 text-body-md outline-none focus:border-tertiary-accent"
                >
                  <option value="">Provincia / Estado *</option>
                  {vendorProvincesForCountry.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.type === "STATE" ? "(Estado)" : "(Provincia)"}
                    </option>
                  ))}
                </select>

                {/* Show municipality input ONLY if selected subdivision is a PROVINCE */}
                {!isStateSelected && (
                  <input
                    placeholder="Municipio *"
                    value={form.municipalityName}
                    onChange={(e) => setForm({ ...form, municipalityName: e.target.value })}
                    className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md outline-none focus:border-tertiary-accent"
                  />
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
              No se cobra nada acá — se arregla directo con la tienda. {siteName} nunca procesa ni recibe pagos.
            </p>
            <div className="flex flex-col gap-3">
              {PAY_OPTIONS.map((pm) => (
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
              {items.map((item) => (
                <div key={`${item.productId}-${item.size ?? ""}`} className="flex justify-between gap-3 text-body-md border-b border-surface-container-high pb-2.5 last:border-b-0">
                  <div>
                    <div className="font-semibold text-on-surface">
                      {item.name}
                      {item.size && <span className="ml-1.5 text-body-sm text-outline">(talla {item.size})</span>}
                    </div>
                    <div className="text-body-sm text-outline">
                      {item.quantity} x {formatPrice(item.price, item.currency)}
                    </div>
                  </div>
                  <div className="font-bold text-on-surface">{formatPrice(item.price * item.quantity, item.currency)}</div>
                </div>
              ))}
            </div>
            <div className="mb-6 flex justify-between border-t border-surface-container-high pt-4 text-title-md font-bold text-on-surface">
              <span>Total estimado</span>
              <span className="text-title-lg font-extrabold text-tertiary-accent">{formatMixedTotal(items)}</span>
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
