import { MessageCircle, Phone, Mail } from "lucide-react";
import { waLink } from "../lib/whatsapp.js";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";

// Pedido que el sistema cerró porque la tienda no lo confirmó a tiempo. Al cliente no se le culpa a la tienda: se le explica
// que no se confirmó y se le da cómo escribirle directo, con su número de pedido, para retomarlo. Si la tienda lo reactiva, el
// pedido vuelve a "Esperando confirmación" y le llega un aviso. Lo usan "Mis pedidos" y la página de rastreo.
// store: { name, whatsapp, email }
export function AutoClosedOrderHelp({ code, store, className = "" }) {
  const { siteName } = usePlatformSettings();
  const digits = String(store?.whatsapp ?? "").replace(/\D/g, "");
  const message = `Hola ${store?.name ?? ""}, hice el pedido ${code} en ${siteName} y se cerró porque no se confirmó a tiempo. ¿Todavía pueden atenderlo?`;

  return (
    <div className={`rounded-xl border border-surface-container-high bg-surface-container px-4 py-3.5 text-[13px] text-on-surface ${className}`}>
      <div className="font-bold">Tu pedido no se confirmó a tiempo</div>
      <p className="mt-1 text-on-surface-variant">
        {store?.name ?? "La tienda"} no alcanzó a confirmarlo, así que lo cerramos para que no sigas esperando. Si todavía lo quieres, escríbele con tu número de pedido
        <span className="font-semibold text-on-surface"> {code}</span>: si lo retoma, te avisamos aquí mismo.
      </p>
      <p className="mt-1 text-on-surface-variant">Si ya hiciste algún pago o transferencia, escríbele también para resolverlo.</p>
      {(digits || store?.email) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {digits && (
            <a
              href={waLink(digits, message)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-2 rounded-xl bg-[#25D366] px-4 text-[13.5px] font-bold text-primary hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Escribir por WhatsApp
            </a>
          )}
          {digits && (
            <a
              href={`tel:+${digits}`}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] font-bold text-on-surface hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              <Phone className="h-4 w-4" aria-hidden="true" /> Llamar
            </a>
          )}
          {store?.email && (
            <a
              href={`mailto:${store.email}?subject=${encodeURIComponent(`Pedido ${code}`)}&body=${encodeURIComponent(message)}`}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] font-bold text-on-surface hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> Escribir un correo
            </a>
          )}
        </div>
      )}
    </div>
  );
}
