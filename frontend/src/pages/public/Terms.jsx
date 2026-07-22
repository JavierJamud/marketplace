import { useStaticPage } from "../../lib/useStaticPage.js";

const SECTIONS = [
  {
    title: "1. Qué es ZeuDin",
    body: "ZeuDin es un marketplace multivendedor que conecta compradores con tiendas y restaurantes independientes en Cuba. ZeuDin no vende productos propios ni es parte de las transacciones entre comprador y vendedor — actúa únicamente como vitrina y canal de contacto (WhatsApp, panel de pedidos o menú QR de mesa).",
  },
  {
    title: "2. Cuentas de usuario",
    body: "Para vender o realizar pedidos con seguimiento es necesario crear una cuenta con datos reales. Cada usuario es responsable de mantener la confidencialidad de su contraseña y de toda actividad realizada desde su cuenta.",
  },
  {
    title: "3. Responsabilidad de los vendedores",
    body: "Cada tienda es responsable de la exactitud de sus publicaciones (precios, stock, descripciones, fotos), del cumplimiento de sus pedidos y de coordinar el pago y la entrega directamente con el comprador. ZeuDin no garantiza la calidad, legalidad ni disponibilidad de los productos publicados por terceros.",
  },
  {
    title: "4. Pagos",
    body: "ZeuDin no procesa pagos entre compradores y vendedores — el pago se coordina directamente entre ambas partes por el medio que la tienda tenga habilitado (efectivo, transferencia, pago contra entrega, etc.). La única excepción es la suscripción del Plan Business, que ZeuDin sí cobra directamente al vendedor para activar la verificación de su tienda.",
  },
  {
    title: "5. Verificación de tiendas",
    body: "El badge de tienda verificada se otorga después de una revisión manual de documentación por parte del equipo de ZeuDin y la confirmación del pago de la suscripción correspondiente. ZeuDin puede revocar la verificación de una tienda ante incumplimientos de estos términos.",
  },
  {
    title: "6. Contenido prohibido",
    body: "Está prohibido publicar productos o servicios ilegales, falsificados, peligrosos o que infrinjan derechos de terceros. ZeuDin puede remover publicaciones o suspender cuentas que incumplan esta política, sin previo aviso.",
  },
  {
    title: "7. Modificaciones",
    body: "Estos términos pueden actualizarse periódicamente. Los cambios relevantes se anunciarán dentro de la plataforma. El uso continuado de ZeuDin después de una actualización implica la aceptación de los nuevos términos.",
  },
  {
    title: "8. Contacto",
    body: "Ante dudas sobre estos términos, podés escribirnos desde tu panel de cuenta o por los canales de contacto publicados en el sitio.",
  },
];

// Bloque 48: si el admin guardó su propio HTML desde AdminPages.jsx, se
// muestra eso (ya sanitizado server-side) en vez del copy fijo de abajo —
// nunca se pierde este copy original, solo se reemplaza en pantalla cuando
// hay algo guardado.
export default function Terms() {
  const { htmlContent } = useStaticPage("terminos");

  if (htmlContent) {
    return (
      <div className="container-app max-w-[820px] py-14">
        <div className="prose-static" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    );
  }

  return (
    <div className="container-app max-w-[820px] py-14">
      <p className="mb-1.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Legal</p>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Términos y condiciones</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">
        Última actualización: {new Date().toLocaleDateString("es-CU", { year: "numeric", month: "long" })}. Este texto es una
        estructura genérica de referencia — la versión legal definitiva puede ser revisada por el equipo de ZeuDin.
      </p>

      <div className="flex flex-col gap-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 font-display text-title-lg text-on-surface">{s.title}</h2>
            <p className="text-[14.5px] leading-[23px] text-on-surface-variant">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
