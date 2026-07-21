import { CreditCard, Landmark, Wallet, Smartphone, Coins, Send } from "lucide-react";

// Métodos de pago que una tienda puede aceptar (Bloque 14) — puramente
// informativo, se muestra en Store.jsx tal cual, nunca se valida ni se
// procesa nada acá. El vendedor también puede agregar uno en texto libre
// que no esté en esta lista ("otro"), ver VendorSettings.jsx.
export const PAYMENT_METHODS = [
  { id: "zelle", label: "Zelle", icon: Send },
  { id: "visa", label: "Visa", icon: CreditCard },
  { id: "mastercard", label: "Mastercard", icon: CreditCard },
  { id: "usdt", label: "USDT", icon: Coins },
  { id: "tropipay", label: "Tropipay", icon: Wallet },
  { id: "card", label: "Tarjeta de crédito/débito", icon: CreditCard },
  { id: "bizum", label: "Bizum", icon: Smartphone },
  { id: "postepay", label: "Postepay", icon: CreditCard },
  { id: "iban", label: "IBAN / Transferencia", icon: Landmark },
  { id: "paypal", label: "PayPal", icon: Wallet },
  { id: "cashapp", label: "Cash App", icon: Smartphone },
  { id: "venmo", label: "Venmo", icon: Smartphone },
];

const METHOD_BY_ID = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m]));

// Un método guardado puede ser un id conocido (icono+label de la lista) o
// texto libre escrito por el vendedor ("otro") — en ese caso se muestra tal
// cual con un ícono genérico.
export function resolvePaymentMethod(value) {
  return METHOD_BY_ID[value] ?? { id: value, label: value, icon: Wallet };
}
