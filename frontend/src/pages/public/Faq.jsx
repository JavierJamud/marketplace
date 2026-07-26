import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useStaticPage } from "../../lib/useStaticPage.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

const buildCustomerFaqs = (siteName) => [
  {
    q: "¿Cómo hago un pedido?",
    a: "Elige los productos que quieres, agrégalos al carrito y confirma el pedido desde el checkout. Según cómo tenga configurada su tienda el vendedor, vas a coordinar el pago por WhatsApp, contra entrega o transferencia.",
  },
  {
    q: `¿${siteName} cobra el pedido?`,
    a: `No. ${siteName} no procesa pagos entre compradores y vendedores — coordinas el pago directo con la tienda por el medio que tenga habilitado.`,
  },
  {
    q: "¿Qué significa el badge de tienda verificada?",
    a: `Que esa tienda pasó una revisión de identidad y activó su suscripción con el equipo de ${siteName}. No es una garantía sobre la calidad de sus productos, pero sí que hay una persona real detrás del negocio.`,
  },
  {
    q: "¿Puedo pedir sin crear una cuenta?",
    a: "Puedes navegar el catálogo libremente. Para hacer pedidos con seguimiento de estado necesitas una cuenta de cliente; el menú QR de mesa en restaurantes es la excepción — se pide sin cuenta.",
  },
  {
    q: "¿Cómo sigo el estado de mi pedido?",
    a: "Desde tu panel de cliente vas a ver el estado (nuevo, preparando, listo, entregado) y también te llega un correo cada vez que cambia.",
  },
];

const buildVendorFaqs = (siteName) => [
  {
    q: `¿Cuánto cuesta vender en ${siteName}?`,
    a: "El Plan Regular es gratis y permite publicar hasta 20 productos con pedidos por WhatsApp. El Plan Business (2 500 CUP/mes) desbloquea productos ilimitados, badge de verificación y más visibilidad — se activa después de verificar tu tienda.",
  },
  {
    q: "¿Cómo verifico mi tienda?",
    a: `Desde tu panel, en 'Verificación', subes una foto tuya y de tu documento de identidad. Un admin de ${siteName} revisa los documentos; si los aprueba, eliges cómo pagar la suscripción (tarjeta o transferencia CUP) y al confirmarse el pago tu tienda queda verificada.`,
  },
  {
    q: "¿Cómo recibo mis pedidos?",
    a: "Puedes elegir recibir el aviso por WhatsApp o directamente en tu panel de vendedor, según lo que configures en Ajustes.",
  },
  {
    q: "¿Puedo tener un restaurante con menú QR?",
    a: "Sí — al registrar tu tienda marca que eres restaurante y elige cuántas mesas tienes. Cada mesa recibe un QR único; marca qué productos aparecen en ese menú desde la edición de cada producto.",
  },
  {
    q: "¿Qué pasa si rechazan mis documentos?",
    a: "Vas a ver el motivo del rechazo en tu panel y vas a poder volver a enviarlos las veces que necesites.",
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-[14px] font-bold text-on-surface">{q}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-outline transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="px-5 pb-4 text-[13.5px] leading-5 text-on-surface-variant">{a}</p>}
    </div>
  );
}

export default function Faq() {
  const { siteName } = usePlatformSettings();
  const [searchParams] = useSearchParams();
  // Bloque 48: Ayuda.jsx linkea acá con ?tab=vendor para las categorías de
  // vendedor — cualquier otro valor (o ninguno) cae en "customer".
  const [tab, setTab] = useState(searchParams.get("tab") === "vendor" ? "vendor" : "customer");
  const faqs = tab === "customer" ? buildCustomerFaqs(siteName) : buildVendorFaqs(siteName);
  const { htmlContent } = useStaticPage("faq");

  if (htmlContent) {
    return (
      <div className="container-app max-w-[820px] py-14">
        <div className="prose-static" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    );
  }

  return (
    <div className="container-app max-w-[820px] py-14">
      <p className="mb-1.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Ayuda</p>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Preguntas frecuentes</h1>
      <p className="mb-8 text-body-md text-on-surface-variant">Elige la sección que te interesa.</p>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setTab("customer")}
          className={`rounded-full px-4 py-2 text-[13px] font-bold ${
            tab === "customer" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
          }`}
        >
          Para clientes
        </button>
        <button
          onClick={() => setTab("vendor")}
          className={`rounded-full px-4 py-2 text-[13px] font-bold ${
            tab === "vendor" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
          }`}
        >
          Para vendedores
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {faqs.map((f) => (
          <FaqItem key={f.q} {...f} />
        ))}
      </div>
    </div>
  );
}
