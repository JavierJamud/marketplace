// Bloque 25: plantillas de "Mejorar con IA" (Bloque 13) separadas de
// gemini.js/groq.js — son texto puro, no dependen de qué proveedor las
// termine ejecutando, así que viven en un solo lugar que ai.js arma antes
// de despachar al proveedor activo.

// "Devolvé SOLO el texto" no alcanzaba solo — el modelo igual armaba 2-3
// variantes con encabezados markdown "para elegir". Hay que prohibirlo
// explícitamente (una sola opción, sin markdown, sin listas) o corta la
// respuesta a mitad de la segunda variante contra el límite de tokens.
const OUTPUT_RULES = `IMPORTANTE sobre el formato de tu respuesta:
- Escribí UNA SOLA versión de la descripción. Nunca ofrezcas variantes, opciones ni alternativas para elegir.
- Texto plano: sin markdown, sin encabezados, sin asteriscos, sin listas, sin comillas.
- Tu respuesta completa debe ser exactamente el texto de la descripción y nada más (ni una intro tipo "Aquí tenés:", ni comentarios después).`;

// "Mejorar con IA" (no "Generar") — el vendedor ya escribió algo (aunque sea
// dos palabras clave) y la IA lo reescribe/expande, nunca inventa un
// producto o tienda desde cero. Por eso el prompt siempre incluye el texto
// tal cual lo escribió el vendedor como punto de partida obligatorio.
export const PROMPTS = {
  product: ({ currentText, vendorName, productName }) => `Sos un copywriter experto en e-commerce para ZeuDin, un marketplace multivendedor de Cuba.
La tienda "${vendorName}"${productName ? ` está publicando el producto "${productName}"` : " está publicando un producto"} y escribió este borrador de descripción:
"${currentText}"

Tu tarea: reescribí y mejorá ese borrador para convertirlo en la descripción final de la ficha de producto — resumida, profesional y persuasiva, pensada para captar la atención del cliente.

Reglas de contenido:
- Español neutro/cubano, tono profesional pero cercano.
- 2 a 4 oraciones.
- Nunca inventes características, materiales, tallas o precios que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  store: ({ currentText, vendorName }) => `Sos un copywriter experto en e-commerce para ZeuDin, un marketplace multivendedor de Cuba.
La tienda "${vendorName}" escribió este borrador de descripción para su perfil público:
"${currentText}"

Tu tarea: reescribí y mejorá ese borrador para convertirlo en la descripción final del perfil de la tienda — resumida, profesional y persuasiva, pensada para generar confianza y captar clientes.

Reglas de contenido:
- Español neutro/cubano, tono profesional pero cercano y confiable.
- 2 a 4 oraciones.
- Nunca inventes datos (rubro, ubicación, años de experiencia) que no estén ya sugeridos en el borrador del vendedor.

${OUTPUT_RULES}`,
  // Sección "Garantías" de VendorSettings.jsx — a diferencia de product/store,
  // el resultado no es marketing sino un texto legal/operativo real que se va
  // a imprimir tal cual en el certificado de garantía (ver generateWarrantyPdf
  // en lib/pdf.js) y que además gatea si el vendedor puede emitir garantías
  // (invoices.controller.js) — por eso la regla extra de "nunca inventes
  // plazos ni cobertura" es más estricta acá que en los otros dos prompts.
  warranty: ({ currentText, vendorName, businessCategoryName }) => `Sos un asistente que redacta términos y condiciones de garantía para tiendas de un marketplace cubano, ZeuDin.
La tienda "${vendorName}"${businessCategoryName ? ` (rubro: ${businessCategoryName})` : ""} escribió este borrador de condiciones de garantía:
"${currentText}"

Tu tarea: reescribí y mejorá ese borrador para convertirlo en el texto final de "Términos y condiciones de garantía" que se imprime en el certificado que reciben los clientes.

Reglas de contenido:
- Español neutro/cubano, tono claro y formal (es un documento legal/comercial).
- 2 a 4 oraciones.
- Nunca inventes plazos, porcentajes ni cobertura específica (qué cubre/no cubre) que no estén ya sugeridos en el borrador del vendedor — si el borrador es vago, quedate en generalidades (defectos de fabricación bajo uso normal, exclusión de mal uso/desgaste natural) en vez de inventar detalles concretos.

${OUTPUT_RULES}`,
};
