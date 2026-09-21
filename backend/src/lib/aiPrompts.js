// Bloque 25: plantillas de "Mejorar con IA" (Bloque 13) separadas de
// gemini.js/groq.js — son texto puro, no dependen de qué proveedor las
// termine ejecutando, así que viven en un solo lugar que ai.js arma antes
// de despachar al proveedor activo.

// "Devolvé SOLO el texto" no alcanzaba solo — el modelo igual armaba 2-3
// variantes con encabezados markdown "para elegir". Hay que prohibirlo
// explícitamente (una sola opción, sin markdown, sin listas) o corta la
// respuesta a mitad de la segunda variante contra el límite de tokens.
const OUTPUT_RULES = `IMPORTANTE sobre el formato de tu respuesta:
- Escribe UNA SOLA versión de la descripción. Nunca ofrezcas variantes, opciones ni alternativas para elegir.
- Texto plano: sin markdown, sin encabezados, sin asteriscos, sin listas, sin comillas.
- Tu respuesta completa debe ser exactamente el texto de la descripción y nada más (ni una intro tipo "Aquí tienes:", ni comentarios después).`;

// "Mejorar con IA" (no "Generar") — el vendedor ya escribió algo (aunque sea
// dos palabras clave) y la IA lo reescribe/expande, nunca inventa un
// producto o tienda desde cero. Por eso el prompt siempre incluye el texto
// tal cual lo escribió el vendedor como punto de partida obligatorio.
export const PROMPTS = {
  // Bloque 230 (pedido explícito, con captura del formulario de producto —
  // "que la descripción generada con IA sea más corta para los productos y
  // más específica y llamativa"): bajado de 3-5 oraciones a 2-3, mismo
  // criterio de longitud que ya usa el prompt `offer` de abajo (se lee
  // rápido en la tarjeta del producto, no es el lugar para un párrafo
  // largo). "Llamativa" no es sinónimo de exagerada: sigue prohibido
  // inventar nada que el vendedor no haya sugerido ya.
  product: ({ currentText, vendorName, productName, siteName }) => `Eres un copywriter experto en e-commerce para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}"${productName ? ` está publicando el producto "${productName}"` : " está publicando un producto"} y escribió este borrador de descripción:
"${currentText}"

Tu tarea: reescribe ese borrador para convertirlo en la descripción final de la ficha de producto. Tiene que ser corta, específica y llamativa: engancha al cliente en la primera frase, en vez de sonar a resumen genérico de catálogo.

Reglas de contenido:
- Español neutro/cubano, tono profesional, cercano y moderno.
- 2 a 3 oraciones, no más. Destaca 1 o 2 beneficios o detalles concretos ya sugeridos en el borrador (material, uso, para quién es), nunca una frase vacía tipo "producto de excelente calidad".
- Nunca inventes características, materiales, tallas o precios que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  store: ({ currentText, vendorName, siteName }) => `Eres un copywriter experto en e-commerce para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}" escribió este borrador de descripción para su perfil público:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en la descripción final del perfil de la tienda — persuasiva, con un estilo moderno y descriptivo, pensada para generar confianza y captar clientes contando qué la hace distinta.

Reglas de contenido:
- Español neutro/cubano, tono profesional, cercano, confiable y moderno.
- 3 a 5 oraciones — desarrolla la propuesta de valor de la tienda, no te quedes en una sola frase genérica.
- Nunca inventes datos (rubro, ubicación, años de experiencia) que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  // Bloque 51: descripción de una tarjeta de OFERTA (Home) — a diferencia de
  // product/store (ficha completa), acá el texto tiene que seguir leyéndose
  // rápido sobre una imagen, así que es más corto pero sin caer en 1 sola
  // frase telegráfica (pedido explícito post-entrega: "que no sea tan corto").
  offer: ({ currentText, vendorName, productName, siteName }) => `Eres un copywriter experto en marketing de ofertas para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}"${productName ? ` está promocionando una oferta sobre el producto "${productName}"` : " está armando una oferta destacada"} y escribió este borrador:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en el texto final de una tarjeta de oferta — directo, persuasivo y con un estilo moderno, pensado para leerse rápido sobre una imagen pero sin sonar telegráfico.

Reglas de contenido:
- Español neutro/cubano, tono entusiasta, moderno y creíble (nunca exagerado o falso).
- 2 a 3 oraciones cortas.
- Nunca inventes porcentajes de descuento, plazos ni condiciones que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  // Bloque 192 (pedido explícito — "en admin la descripción no tiene el
  // botón para mejorar con IA"): misma tarjeta que `offer` de arriba, pero
  // para una oferta OFICIAL creada por el admin (AdminOffers.jsx) — nunca
  // hay una tienda puntual detrás (offer.vendorId es null en estas), así
  // que el prompt no depende de vendorName, a diferencia de `offer`.
  "admin-offer": ({ currentText, productName, siteName }) => `Eres un copywriter experto en marketing de ofertas para ${siteName}, un marketplace multivendedor de Cuba.
El equipo de administración de ${siteName} está armando una oferta oficial destacada${productName ? ` sobre el producto "${productName}"` : ""} y escribió este borrador:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en el texto final de una tarjeta de oferta — directo, persuasivo y con un estilo moderno, pensado para leerse rápido sobre una imagen pero sin sonar telegráfico.

Reglas de contenido:
- Español neutro/cubano, tono entusiasta, moderno y creíble (nunca exagerado o falso).
- 2 a 3 oraciones cortas.
- Nunca inventes porcentajes de descuento, plazos ni condiciones que no estén ya sugeridos en el borrador.

${OUTPUT_RULES}`,
  // Bloque 66 (pedido explícito): "Mejorar con IA" para el cuerpo de una
  // campaña de correo masivo (AdminCampaigns.jsx) — a diferencia de
  // product/store/offer, no hay una tienda/producto puntual detrás (lo manda
  // el equipo de la plataforma a clientes o vendedores en general), así que
  // el prompt no depende de vendorName/productName.
  campaign: ({ currentText, siteName }) => `Eres un copywriter experto en email marketing para ${siteName}, un marketplace multivendedor de Cuba.
El equipo de administración de la plataforma está redactando el cuerpo de un correo masivo (campaña) para sus clientes o vendedores, y escribió este borrador:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en el cuerpo final del correo — claro, persuasivo, con un estilo moderno y descriptivo (no un resumen telegráfico), manteniendo la intención y el tema original del borrador.

Reglas de contenido:
- Español neutro/cubano, tono profesional, cercano y moderno.
- 3 a 6 oraciones, idealmente cerrando con una invitación clara a la acción si el borrador ya sugiere una.
- Nunca inventes fechas, descuentos, promociones ni datos concretos que no estén ya sugeridos en el borrador.

${OUTPUT_RULES}`,
  // Bloque 194 (pedido explícito — "la IA vaya reconociendo el modo de uso
  // del negocio y le recomiende consejos... que recomiende ofertas en
  // productos vendidos, movimiento de inventarios para que los productos
  // que no salen puedan salir... consejos diarios para que los vendedores
  // sean más productivos"): a diferencia de TODOS los demás prompts de
  // arriba, este NO "mejora un borrador" — genera contenido nuevo a partir
  // de señales reales del negocio (ver getOrGenerateVendorDailyTips,
  // services/vendorDailyTips.service.js), por eso `currentText` no existe
  // acá, en su lugar `signals` ya viene armado como texto legible. Formato
  // de salida MUY estricto (una línea por consejo) porque se parsea a mano
  // después, no queda en un solo bloque de texto libre como el resto.
  "vendor-tips": ({ vendorName, siteName, signals }) => `Eres un consultor de negocios experto en comercio electrónico para ${siteName}, un marketplace multivendedor de Cuba.
Estás analizando el negocio "${vendorName}" con estos datos reales de los últimos 30 días:
${signals}

Tu tarea: da exactamente 3 consejos CONCRETOS y ACCIONABLES para que este vendedor sea más productivo — basados ÚNICAMENTE en los datos de arriba. Nunca inventes cifras, productos o situaciones que no estén en esos datos; si un dato clave falta (ej. no hay ventas todavía), dalo por dato también y aconseja en consecuencia.

Formato de tu respuesta — EXACTAMENTE 3 líneas, una por consejo, cada una así:
Título corto: descripción de 1-2 oraciones con la acción concreta a tomar.

Reglas de contenido:
- Español neutro/cubano, tono directo y práctico, como un consultor real, nunca genérico de manual.
- Nunca uses viñetas, numeración, ni ningún otro formato — solo las 3 líneas "Título: descripción".
- Nunca agregues una intro, cierre, ni nada antes/después de las 3 líneas.`,
  // Sección "Garantías" de VendorSettings.jsx — a diferencia de product/store,
  // el resultado no es marketing sino un texto legal/operativo real que se va
  // a imprimir tal cual en el certificado de garantía (ver generateWarrantyPdf
  // en lib/pdf.js) y que además gatea si el vendedor puede emitir garantías
  // (invoices.controller.js). Pedido explícito post-entrega: el resultado
  // venía demasiado corto/genérico (2-4 oraciones en un solo párrafo) — un
  // documento de garantía real se lee como cláusulas separadas, no como un
  // párrafo de marketing, así que este prompt NO reusa OUTPUT_RULES (esa
  // regla prohíbe listas, que acá es exactamente el formato que se necesita).
  warranty: ({ currentText, vendorName, businessCategoryName, siteName }) => `Eres un asistente que redacta términos y condiciones de garantía para tiendas de un marketplace cubano, ${siteName}.
La tienda "${vendorName}"${businessCategoryName ? ` (rubro: ${businessCategoryName})` : ""} escribió este borrador de condiciones de garantía:
"${currentText}"

Tu tarea: reescribe y AMPLÍA ese borrador para convertirlo en el texto final y completo de "Términos y condiciones de garantía" que se imprime en el certificado que reciben los clientes. No devuelvas un párrafo corto — es un documento legal/comercial real, así que necesita desarrollo punto por punto.

Estructura obligatoria — un punto numerado por cláusula, cada uno de 1 a 3 oraciones, cubriendo (en este orden, adaptado al rubro de la tienda):
1. Qué cubre la garantía (defectos de fabricación, funcionamiento bajo uso normal, etc., según lo que sugiera el borrador).
2. Qué NO cubre (exclusiones: mal uso, modificaciones no autorizadas, desgaste natural, daños accidentales, etc.).
3. Cómo hacer válido el reclamo (presentar el certificado junto con el producto, plazo para reclamar, canal de contacto de la tienda).
4. Qué pasa si se aprueba el reclamo (reparación, cambio o reembolso — solo si el borrador lo sugiere; si no dice nada, déjalo en términos generales como "reparación o cambio a criterio de la tienda").
5. Cualquier condición adicional relevante que el borrador ya sugiera (garantía no transferible, requiere comprobante de compra, etc.) — omite este punto si el borrador no da pie a nada más.

Reglas de contenido:
- Español neutro/cubano, tono claro y formal.
- Nunca inventes plazos, porcentajes ni cobertura específica que no estén ya sugeridos en el borrador del vendedor — si el borrador es vago en un punto, quédate en generalidades razonables para ese punto en vez de inventar números o condiciones concretas.
- Cada cláusula en su propia línea, con el formato "1. texto", "2. texto", etc. (numeración simple, sin asteriscos ni otro formato).

IMPORTANTE sobre el formato de tu respuesta:
- Escribe UNA SOLA versión. Nunca ofrezcas variantes, opciones ni alternativas para elegir.
- Sin markdown, sin encabezados, sin asteriscos, sin comillas — solo las líneas numeradas de texto plano descritas arriba.
- Tu respuesta completa debe ser exactamente las cláusulas numeradas y nada más (ni una intro tipo "Aquí tienes:", ni comentarios después).`,
};

// Bloque 52 (bug real reportado en vivo): la barra de búsqueda no toleraba
// errores de tipeo (ej. "zapatiya" en vez de "zapatilla") — a diferencia de
// PROMPTS de arriba (que "mejoran" un borrador largo), acá la tarea es
// puntual y mecánica: corregir/interpretar UN término de búsqueda corto.
// Prompt separado, no reusa OUTPUT_RULES (esas reglas hablan de
// "descripción" — acá la única regla real es "devolvé nada más que el
// término corregido"). Se usa solo como ÚLTIMO recurso, cuando la búsqueda
// literal (con tildes/mayúsculas ya ignoradas) no encontró nada — ver
// correctSearchQuery en lib/ai.js y search.controller.js.
export const searchQueryCorrectionPrompt = (rawQuery, siteName) => `Un cliente escribió esto en la barra de búsqueda de ${siteName}, un marketplace de Cuba, y no se encontró ningún resultado:
"${rawQuery}"

Es probable que tenga un error de tipeo (letra de más, de menos, cambiada o transpuesta) o que abrevie/escriba mal el nombre de un producto o categoría común (ropa, comida, electrónica, servicios, etc.).

Tu tarea: devuelve la versión corregida de ese término de búsqueda — la palabra o frase corta que el cliente casi seguro quiso escribir. Si el texto ya parece correcto tal cual (no es un typo, simplemente no hay ese producto en el catálogo), devuelve el mismo texto sin cambios.

Reglas estrictas:
- Nunca inventes un producto o marca específica que no esté ya sugerido por el texto — solo corrige ortografía/tipeo, no cambies el significado ni la intención de búsqueda.
- Tu respuesta es SOLO el término corregido, nada más: sin comillas, sin explicación, sin markdown, sin puntuación final, una sola línea.`;
