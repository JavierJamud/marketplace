import { Clock, CheckCircle2, XCircle, AlertTriangle, Ban } from "lucide-react";

// Verificación y Suscripción se unificaron en una sola página
// (VendorVerification.jsx) por mostrar prácticamente lo mismo — este array
// ya no se comparte entre dos archivos, pero se deja acá separado del
// componente porque BENEFITS/PLANS son datos, no UI.
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

// Bloque 64: verificationStatus (Vendor.verificationStatus, fuente única de
// verdad — ver vendorVerification.service.js) ES el ciclo completo, ya no
// hace falta traducirlo a un stage aparte: NOT_STARTED -> PENDING_DOCS ->
// IN_REVIEW -> PENDING_PAYMENT -> VERIFIED, o PAYMENT_FAILED/SUSPENDED/
// REJECTED en el medio.
export const STAGE_META = {
  NOT_STARTED: { label: "Sin verificar todavía", color: "#75777c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
  PENDING_DOCS: { label: "Documentos enviados — esperando revisión", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  IN_REVIEW: { label: "Un admin está revisando tus documentos", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  PENDING_PAYMENT: { label: "Documentos aprobados — falta el pago", color: "#337475", bg: "rgba(51,116,117,0.1)", Icon: Clock },
  VERIFIED: { label: "Tienda verificada", color: "#0A8F42", bg: "rgba(12,174,83,0.1)", Icon: CheckCircle2 },
  PAYMENT_FAILED: { label: "El cobro de tu suscripción falló", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: AlertTriangle },
  SUSPENDED: { label: "Tu suscripción fue suspendida", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: Ban },
  REJECTED: { label: "Documentos rechazados", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: XCircle },
};
