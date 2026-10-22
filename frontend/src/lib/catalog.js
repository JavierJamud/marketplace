import { useQuery } from "@tanstack/react-query";
import { Banknote, DollarSign, Euro, Coins, MessageCircle, Truck, Wallet, CreditCard, Send, Smartphone, Landmark, Store, Clock } from "lucide-react";
import { api } from "./api.js";

// Monedas y formas de pago que edita el admin (backend/src/lib/catalog.js). Productos, tiendas y pedidos guardan el código
// (USD, cod...), que no cambia; el nombre visible sale de aquí, así un cambio de nombre en el admin se ve en todo el sitio.
// Se guarda en un módulo (no solo en el estado de React) porque formatPrice y las etiquetas se usan en funciones normales.
// Lo mantiene al día useCatalog() en App.jsx; mientras llega la primera respuesta se muestran los códigos tal cual.

export const CATALOG_ICONS = {
  banknote: Banknote,
  dollar: DollarSign,
  euro: Euro,
  coins: Coins,
  message: MessageCircle,
  truck: Truck,
  wallet: Wallet,
  card: CreditCard,
  send: Send,
  phone: Smartphone,
  bank: Landmark,
  store: Store,
  clock: Clock,
};

// Los pedidos de mesa no son una forma de cobro del catálogo.
const SYSTEM_CHANNEL_LABEL = { TABLE: "Mesa" };

let catalog = { currencies: [], productPayments: [], checkoutPayments: [], storePayments: [] };

export function setCatalog(next) {
  if (next) catalog = next;
}

export function iconFor(key, fallback = Wallet) {
  return CATALOG_ICONS[key] ?? fallback;
}

const find = (list, code) => list.find((o) => o.code === code);
const pick = (list, activeOnly) => (activeOnly ? list.filter((o) => o.isActive) : list);

// --- Monedas ---
export function currencyLabel(code) {
  return find(catalog.currencies, code)?.label ?? code ?? "";
}

export function currencyName(code) {
  return find(catalog.currencies, code)?.description ?? "";
}

export function currencyOptions({ activeOnly = true } = {}) {
  return pick(catalog.currencies, activeOnly);
}

// Texto de una opción de selector: "USD · Dólar estadounidense".
export function currencyOption(code) {
  const name = currencyName(code);
  return name ? `${currencyLabel(code)} · ${name}` : currencyLabel(code);
}

// Para selectores: las activas, y además la que ya tiene guardada el producto o la tienda aunque el admin la haya desactivado.
export function currencyCodesFor(current) {
  const codes = currencyOptions().map((o) => o.code);
  return current && !codes.includes(current) ? [...codes, current] : codes;
}

// --- Formas de pago del producto ---
export function productPaymentLabel(code) {
  return find(catalog.productPayments, code)?.label ?? code;
}

export function productPaymentOptions({ activeOnly = true } = {}) {
  return pick(catalog.productPayments, activeOnly);
}

export function universalProductPayment() {
  return (catalog.productPayments.find((o) => o.isUniversal) ?? catalog.productPayments[0])?.code ?? "whatsapp";
}

// --- Formas de cobro al terminar la compra ---
export function checkoutChoices({ activeOnly = true } = {}) {
  return pick(catalog.checkoutPayments, activeOnly).map((o) => ({ id: o.code, title: o.label, sub: o.description ?? "", icon: iconFor(o.icon, CreditCard), active: o.isActive }));
}

export function checkoutLabel(code) {
  return find(catalog.checkoutPayments, code)?.label ?? code;
}

// Order.channel guarda el código en mayúsculas (COD, ONLINE...).
export function channelLabel(channel) {
  if (!channel) return "";
  if (SYSTEM_CHANNEL_LABEL[channel]) return SYSTEM_CHANNEL_LABEL[channel];
  return catalog.checkoutPayments.find((o) => o.code.toUpperCase() === channel)?.label ?? channel;
}

// --- Métodos que acepta una tienda (Zelle, Visa...) ---
export function storePaymentMethods({ activeOnly = true } = {}) {
  return pick(catalog.storePayments, activeOnly).map((o) => ({ id: o.code, label: o.label, icon: iconFor(o.icon), active: o.isActive }));
}

// Un método guardado es un código del catálogo o un texto que la tienda escribió a mano: ese se muestra tal cual.
export function resolvePaymentMethod(value) {
  const o = find(catalog.storePayments, value);
  return o ? { id: o.code, label: o.label, icon: iconFor(o.icon) } : { id: value, label: value, icon: Wallet };
}

// Lee el catálogo de la misma consulta que la configuración pública y lo deja en el módulo. Devuelve el catálogo para que
// el componente que lo usa se vuelva a pintar cuando cambia.
export function useCatalog() {
  const { data } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 5 * 60 * 1000,
  });
  if (data?.catalog) setCatalog(data.catalog);
  return data?.catalog ?? catalog;
}
