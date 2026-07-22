import { Clock, CheckCircle2, XCircle } from "lucide-react";

// Bloque 47: extraído de VendorVerification.jsx para que VendorSubscription.jsx
// reuse los mismos arrays en vez de duplicarlos — mismo criterio del bloque
// ("no duplicar el array").
export const BENEFITS = ["Badge de verificación", "Productos ilimitados", "Aparición en la home", "IA de empresa (chatbot)"];

// Bloque 16: la comparación Regular/Business se movió acá desde Home.jsx —
// ya no es un gancho de marketing público, es algo que el vendedor explora
// si quiere desde su propio panel.
export const PLANS = [
  {
    id: "regular",
    name: "Regular",
    priceLabel: "Gratis",
    features: ["Hasta 20 productos", "Pedidos por WhatsApp", "Perfil de tienda público", "Sin comisiones por venta"],
  },
  {
    id: "business",
    name: "Business",
    priceLabel: "2 500 CUP/mes",
    features: ["Productos ilimitados", "Sello de tienda verificada", "Destacada en la home", "Recomendaciones con IA", "Horarios de atención"],
  },
];

// stage (derivado server-side, ver verification.controller.js): REGULAR →
// PENDIENTE_DOCS → PENDIENTE_PAGO → VERIFICADO, o RECHAZADO en el medio.
export const STAGE_META = {
  REGULAR: { label: "Sin verificar todavía", color: "#75777c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
  PENDIENTE_DOCS: { label: "Documentos en revisión", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  PENDIENTE_PAGO: { label: "Documentos aprobados — falta el pago", color: "#337475", bg: "rgba(51,116,117,0.1)", Icon: Clock },
  VERIFICADO: { label: "Tienda verificada", color: "#0A8F42", bg: "rgba(12,174,83,0.1)", Icon: CheckCircle2 },
  RECHAZADO: { label: "Documentos rechazados", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: XCircle },
};
