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
  product: ({ currentText, vendorName, productName, siteName }) => `Eres un copywriter experto en e-commerce para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}"${productName ? ` está publicando el producto "${productName}"` : " está publicando un producto"} y escribió este borrador de descripción:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en la descripción final de la ficha de producto — resumida, profesional y persuasiva, pensada para captar la atención del cliente.

Reglas de contenido:
- Español neutro/cubano, tono profesional pero cercano.
- 2 a 4 oraciones.
- Nunca inventes características, materiales, tallas o precios que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  store: ({ currentText, vendorName, siteName }) => `Eres un copywriter experto en e-commerce para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}" escribió este borrador de descripción para su perfil público:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en la descripción final del perfil de la tienda — resumida, profesional y persuasiva, pensada para generar confianza y captar clientes.

Reglas de contenido:
- Español neutro/cubano, tono profesional pero cercano y confiable.
- 2 a 4 oraciones.
- Nunca inventes datos (rubro, ubicación, años de experiencia) que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  // Bloque 51: descripción corta de una tarjeta de OFERTA (Home) — a
  // diferencia de product/store (ficha completa), acá el texto es de 1-2
  // oraciones nada más, pensado para leerse en 2 segundos sobre una imagen.
  offer: ({ currentText, vendorName, productName, siteName }) => `Eres un copywriter experto en marketing de ofertas para ${siteName}, un marketplace multivendedor de Cuba.
La tienda "${vendorName}"${productName ? ` está promocionando una oferta sobre el producto "${productName}"` : " está armando una oferta destacada"} y escribió este borrador:
"${currentText}"

Tu tarea: reescribe y mejora ese borrador para convertirlo en el texto final de una tarjeta de oferta — corto, directo y persuasivo, pensado para leerse de un vistazo sobre una imagen.

Reglas de contenido:
- Español neutro/cubano, tono entusiasta pero creíble (nunca exagerado o falso).
- 1 a 2 oraciones cortas, nunca más.
- Nunca inventes porcentajes de descuento, plazos ni condiciones que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
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
