import { Banknote, DollarSign, Euro, Coins } from "lucide-react";

// Bloque 47 (ver decisión B): informativo, mismo criterio que
// PAYMENT_METHODS en paymentMethods.js — el vendedor elige qué monedas
// coordina con el cliente, sin conversión real ni tasa de cambio. Los
// precios de catálogo siguen siempre en CUP (Product.price).
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
