// Título, descripción y palabras clave de las pantallas públicas fijas, escritos para lo que la gente busca en Google
// (tiendas, productos, comida a domicilio y pago contra entrega en Cuba). Las pantallas de tienda y de producto arman los
// suyos con sus datos reales (ver Store.jsx y Product.jsx).

export const NOINDEX_PREFIXES = ["/carrito", "/carrito-compartido", "/checkout", "/cuenta", "/vendedor", "/admin", "/socio", "/mesa", "/vender"];

export function isNoindexPath(path) {
  return NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// Rutas con datos propios: la pantalla pone su SEO, no esta tabla.
export function isDynamicSeoPath(path) {
  return path.startsWith("/tienda/") || path.startsWith("/producto/");
}

export function staticSeoFor(path, siteName) {
  const n = siteName || "Baznova";
  const common = ["tienda en línea Cuba", "comprar en Cuba", "marketplace Cuba", "tiendas locales", "pago contra entrega", "pedido por WhatsApp"];
  const table = {
    "/": {
      title: `${n} | Marketplace para comprar y vender en Cuba`,
      description: `Compra en tiendas y restaurantes de toda Cuba y pide por WhatsApp o en la web. ¿Tienes un negocio? Abre tu tienda en ${n} gratis y sin comisión por venta.`,
      keywords: [...common, "comida a domicilio Cuba", "restaurantes La Habana", "tiendas verificadas", "comprar productos en Cuba", "vender en Cuba"],
    },
    "/tiendas": {
      title: `Tiendas y restaurantes en Cuba | ${n}`,
      description: `Directorio de tiendas locales y restaurantes de Cuba por provincia y tipo de negocio. Encuentra tiendas verificadas cerca de ti y haz tu pedido en ${n}.`,
      keywords: [...common, "directorio de tiendas Cuba", "tiendas por provincia", "restaurantes en Cuba", "negocios locales Cuba"],
    },
    "/catalogo": {
      title: `Catálogo de productos en Cuba | ${n}`,
      description: `Explora productos de tiendas locales de Cuba: alimentos, ropa, tecnología, hogar, belleza y más. Compara precios y pide directo a la tienda en ${n}.`,
      keywords: [...common, "catálogo de productos Cuba", "comprar ropa Cuba", "comprar tecnología Cuba", "alimentos Cuba", "precios en Cuba"],
    },
    "/ventas-rapidas": {
      title: `Ventas rápidas entre personas en Cuba | ${n}`,
      description: `Anuncios de ventas rápidas de particulares en Cuba: artículos usados y ofertas de última hora. Publica o encuentra lo que buscas en ${n}.`,
      keywords: ["ventas rápidas Cuba", "artículos usados Cuba", "compraventa Cuba", "anuncios clasificados Cuba"],
    },
    "/faq": {
      title: `Preguntas frecuentes | ${n}`,
      description: `Respuestas a las dudas más comunes sobre cómo comprar, pagar, recibir pedidos y vender en ${n}, el marketplace de tiendas locales de Cuba.`,
      keywords: ["preguntas frecuentes", "cómo comprar en Cuba", "cómo vender en Cuba", "pago contra entrega", "ayuda marketplace"],
    },
    "/ayuda": {
      title: `Centro de ayuda | ${n}`,
      description: `Guías para comprar, vender, pagar y gestionar tu cuenta en ${n}: pedidos, entregas, tienda verificada, menú QR para restaurantes y más.`,
      keywords: ["centro de ayuda", "ayuda para comprar", "cómo abrir una tienda en línea", "menú QR restaurante", "tienda verificada"],
    },
    "/contacto": {
      title: `Contacto | ${n}`,
      description: `Escríbenos por WhatsApp, correo o desde el formulario. Atendemos dudas sobre pedidos, cuentas de tienda, verificación y alianzas de ${n}.`,
      keywords: ["contacto", "soporte", "atención al cliente", "WhatsApp"],
    },
    "/terminos": {
      title: `Términos y condiciones | ${n}`,
      description: `Términos y condiciones de uso de ${n}, marca de Zeudin Group: reglas para compradores y vendedores, uso de inteligencia artificial, derechos de autor y resolución de disputas.`,
      keywords: ["términos y condiciones", "condiciones de uso"],
    },
    "/privacidad": {
      title: `Política de privacidad | ${n}`,
      description: `Cómo ${n} recopila, usa y protege tus datos personales: cookies, inteligencia artificial, verificación de tiendas, tus derechos y declaración de datos para tiendas de aplicaciones.`,
      keywords: ["política de privacidad", "protección de datos", "privacidad"],
    },
    "/api-socios": {
      title: `API para socios y sitios web | ${n}`,
      description: `Conecta tu sitio o aplicación con el catálogo de ${n}: API REST con clave personal para mostrar productos y recibir pedidos de tiendas locales de Cuba.`,
      keywords: ["API marketplace", "API de productos", "integración de tienda", "API REST", "socios"],
    },
    "/socios/solicitar": {
      title: `Solicitar acceso como socio | ${n}`,
      description: `Solicita tu clave de la API de ${n} para conectar tu sitio web con el catálogo y los pedidos de tiendas locales de Cuba.`,
      keywords: ["solicitar API", "programa de socios", "integración marketplace"],
    },
  };
  const item = table[path];
  return item ? { ...item, path } : null;
}
