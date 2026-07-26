import { useStaticPage } from "../../lib/useStaticPage.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

const buildSections = (siteName) => [
  {
    title: "1. Qué datos recopilamos",
    body: "Recopilamos los datos que cargas al registrarte (nombre, correo, teléfono, provincia), los datos de tu tienda si eres vendedor (incluyendo documentación de verificación KYC), y los datos de tus pedidos (dirección de entrega, historial de compras). También registramos eventos mínimos de uso (visitas a una tienda, productos agregados al carrito) para mostrarle analíticas básicas a los vendedores.",
  },
  {
    title: "2. Para qué los usamos",
    body: "Usamos tus datos para procesar pedidos, permitir la comunicación entre comprador y vendedor, mostrar tu tienda en el catálogo, enviar notificaciones transaccionales por correo (confirmaciones, cambios de estado, verificación de cuenta) y prevenir fraude.",
  },
  {
    title: "3. Documentos de verificación (KYC)",
    body: `Las fotos de identidad y selfie que subes al verificar tu tienda se almacenan cifradas y privadas — nunca se publican ni se comparten con otros usuarios. Solo el equipo de ${siteName} puede revisarlas para aprobar o rechazar tu verificación.`,
  },
  {
    title: "4. Con quién compartimos datos",
    body: "No vendemos tus datos a terceros. Compartimos lo estrictamente necesario con proveedores que hacen funcionar la plataforma (envío de emails transaccionales, procesamiento de pagos de suscripción), siempre bajo acuerdos de confidencialidad.",
  },
  {
    title: "5. Seguridad",
    body: "Las contraseñas se almacenan cifradas (nunca en texto plano). Las claves de integraciones de terceros (email, IA, pagos) se cifran en el servidor y nunca se exponen al navegador. El acceso a datos sensibles está restringido según el rol de cada usuario (cliente, vendedor, administrador).",
  },
  {
    title: "6. Tus derechos",
    body: "Puedes pedir la corrección o eliminación de tu cuenta y tus datos personales escribiendo desde tu panel. Los pedidos históricos pueden conservarse de forma anonimizada por razones contables, incluso después de eliminar una cuenta.",
  },
  {
    title: "7. Cambios en esta política",
    body: "Podemos actualizar esta política ocasionalmente. Te avisaremos dentro de la plataforma ante cualquier cambio relevante en cómo tratamos tus datos.",
  },
];

export default function Privacy() {
  const { siteName } = usePlatformSettings();
  const { htmlContent } = useStaticPage("privacidad");
  const sections = buildSections(siteName);

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
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Política de privacidad</h1>
      <p className="mb-10 text-body-md text-on-surface-variant">
        Última actualización: {new Date().toLocaleDateString("es-CU", { year: "numeric", month: "long" })}. Este texto es una
        estructura genérica de referencia — la versión legal definitiva puede ser revisada por el equipo de {siteName}.
      </p>

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
