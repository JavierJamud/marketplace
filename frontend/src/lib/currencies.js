import { Banknote, DollarSign, Euro, Coins } from "lucide-react";

// Bloque 47 (ver decisión B): informativo, mismo criterio que
// PAYMENT_METHODS en paymentMethods.js — el vendedor elige qué monedas
// coordina con el cliente (Vendor.acceptedCurrencies), sin conversión real
// ni tasa de cambio. Distinto de Product.currency (Bloque 52): esa es la
// moneda EN LA QUE ESTÁ EXPRESADO el precio de un producto puntual
// (frontend/src/lib/format.js), esta lista de acá es sobre qué monedas
// acepta la tienda en general al coordinar el pago, dos cosas separadas.
export const CURRENCIES = [
  { id: "CUP", label: "CUP", icon: Banknote },
  { id: "USD", label: "USD", icon: DollarSign },
  { id: "EUR", label: "EUR", icon: Euro },
  { id: "USDT", label: "USDT", icon: Coins },
];

const CURRENCY_BY_ID = Object.fromEntries(CURRENCIES.map((c) => [c.id, c]));

export function resolveCurrency(value) {
  return CURRENCY_BY_ID[value] ?? { id: value, label: value, icon: Coins };
}
