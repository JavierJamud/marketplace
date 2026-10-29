import { Link } from "react-router-dom";
import { useStaticPage } from "../../lib/useStaticPage.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Breadcrumbs } from "../../components/Breadcrumbs.jsx";
import { Skeleton, SkeletonGroup } from "../../components/ui/Skeleton.jsx";

// Fecha del texto predeterminado de abajo. Antes se mostraba new Date(), así que la "Última actualización" de un documento
// legal cambiaba sola cada mes sin que nadie lo tocara. Esta fecha se cambia a mano cada vez que se edita buildSections.
const DEFAULT_TERMS_UPDATED = "octubre de 2026";

// Frase sobre los planes gratis: sale de la configuración pública (/settings), nunca de una lista fija, porque el admin
// puede volver de pago un plan gratis o crear otro. Solo cuenta los planes públicos (los ocultos no se ofrecen a nadie).
// Mientras /settings no responde, `plans` viene vacío y la frase no se muestra en vez de afirmar algo que quizá no es cierto.
// No promete un aviso previo si un plan gratis pasa a ser de pago: el servidor solo avisa a las tiendas de los planes que
// se cobran sin insignia (billedPlanConfigs en planBilling.service.js), y un texto legal no puede prometer más que eso.
function freePlansSentence(plans, plansLoading) {
  if (plansLoading || plans.length === 0) return "";
  const free = plans.filter((p) => p.isPublic && p.isFree).map((p) => p.displayName);
  if (free.length === 0) return " Hoy todos los planes tienen costo.";
  const names = free.length === 1 ? `el plan ${free[0]}` : `los planes ${free.slice(0, -1).join(", ")} y ${free[free.length - 1]}`;
  const verb = free.length === 1 ? "es gratis" : "son gratis";
  return ` Hoy ${names} ${verb}.`;
}

const buildSections = (siteName, freeSentence) => [
  {
    title: `1. Qué es ${siteName}`,
    body: `${siteName} es un marketplace multivendedor que conecta compradores con tiendas y restaurantes independientes en Cuba. ${siteName} no vende productos propios ni es parte de las transacciones entre comprador y vendedor: actúa únicamente como vitrina y canal de contacto (WhatsApp, panel de pedidos o menú QR de mesa).`,
  },
  {
    title: "2. Cuentas de usuario",
    body: "Para vender o realizar pedidos con seguimiento es necesario crear una cuenta con datos reales. Cada usuario es responsable de mantener la confidencialidad de su contraseña y de toda actividad realizada desde su cuenta.",
  },
  {
    title: "3. Responsabilidad de los vendedores",
    body: `Cada tienda es responsable de la exactitud de sus publicaciones (precios, stock, descripciones, fotos), del cumplimiento de sus pedidos y de coordinar el pago y la entrega directamente con el comprador. ${siteName} no garantiza la calidad, legalidad ni disponibilidad de los productos publicados por terceros.`,
  },
  {
    // Antes hablaba de un único "plan de pago" que solo servía para la verificación. Ahora hay varios planes, editables
    // desde el admin, y alguno puede cobrarse sin dar la insignia: el texto no nombra planes ni precios y manda a /planes.
    title: "4. Pagos y planes",
    body: (
      <>
        {siteName} no procesa pagos entre compradores y vendedores: el pago se coordina directamente entre ambas partes por el
        medio que la tienda tenga habilitado (efectivo, transferencia, pago contra entrega, etc.). La excepción son los planes
        para tiendas: {siteName} cobra directamente al vendedor la suscripción de su plan, por un mes o por varios meses a la
        vez.{freeSentence} Si el pago de un plan vence, la tienda puede perder las funciones de ese plan, dejar de recibir
        pedidos nuevos o quedar suspendida hasta ponerse al día. Los planes, sus precios y lo que incluye cada uno están en la{" "}
        <Link to="/planes" className="font-semibold text-tertiary-accent underline underline-offset-2 hover:text-tertiary">
          página de planes
        </Link>
        .
      </>
    ),
  },
  {
    // La prueba gratis da la insignia sola cuando la tienda completa los pasos (activateVendorTrial en
    // trialEligibility.service.js), sin revisión manual ni pago: el texto lo dice para no afirmar algo falso.
    title: "5. Verificación de tiendas",
    body: `La insignia de tienda verificada solo existe en los planes que la incluyen. Se otorga tras la revisión del equipo de ${siteName} y, en los planes de pago, con el pago confirmado, o durante la prueba gratis cuando la tienda completa los pasos que se le piden. ${siteName} puede revocar la verificación de una tienda ante incumplimientos de estos términos.`,
  },
  {
    title: "6. Contenido prohibido",
    body: `Está prohibido publicar productos o servicios ilegales, falsificados, peligrosos o que infrinjan derechos de terceros. ${siteName} puede remover publicaciones o suspender cuentas que incumplan esta política, sin previo aviso.`,
  },
  {
    title: "7. Modificaciones",
    body: `Estos términos pueden actualizarse periódicamente. Los cambios relevantes se anunciarán dentro de la plataforma. El uso continuado de ${siteName} después de una actualización implica la aceptación de los nuevos términos.`,
  },
  {
    title: "8. Contacto",
    body: "Ante dudas sobre estos términos, puedes escribirnos desde tu panel de cuenta o por los canales de contacto publicados en el sitio.",
  },
];

// Mismo hueco que ocupa el texto: título, fecha y unas secciones. Así no se ve un instante el texto predeterminado antes
// de que llegue el que guardó el admin.
function TermsSkeleton() {
  return (
    <SkeletonGroup label="Cargando términos y condiciones" className="flex flex-col gap-8">
      <div>
        <Skeleton width="60%" height={32} />
        <Skeleton width="40%" height={16} className="mt-3" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i}>
          <Skeleton width={`${45 - (i % 2) * 10}%`} height={22} />
          <Skeleton count={3} height={14} className="mt-2" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

// Bloque 48: si el admin guardó su propio HTML desde AdminPages.jsx, se
// muestra eso (ya sanitizado server-side) en vez del copy fijo de abajo —
// nunca se pierde este copy original, solo se reemplaza en pantalla cuando
// hay algo guardado.
export default function Terms() {
  const { siteName, plans, plansLoading } = usePlatformSettings();
  const { htmlContent, isLoading } = useStaticPage("terminos");
  const sections = buildSections(siteName, freePlansSentence(plans, plansLoading));

  if (isLoading) {
    return (
      <div className="container-app max-w-[820px] py-14">
        <Breadcrumbs className="mb-4" items={[{ label: "Términos y condiciones" }]} />
        <TermsSkeleton />
      </div>
    );
  }

  if (htmlContent) {
    return (
      <div className="container-app max-w-[820px] py-14">
        {/* El texto editado desde el admin también lleva la ruta para volver al inicio. */}
        <Breadcrumbs className="mb-4" items={[{ label: "Términos y condiciones" }]} />
        <div className="prose-static" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </div>
    );
  }

  return (
    <div className="container-app max-w-[820px] py-14">
      <Breadcrumbs className="mb-2" items={[{ label: "Términos y condiciones" }]} />
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Términos y condiciones</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">Última actualización: {DEFAULT_TERMS_UPDATED}.</p>

      <div className="flex flex-col gap-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 font-display text-title-lg text-on-surface">{s.title}</h2>
            <p className="text-[14.5px] leading-[23px] text-on-surface-variant">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
