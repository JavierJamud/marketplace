// Bloque 287 (pedido explícito — "primero debería buscar a qué sección pertenece la
// pregunta y luego traer el dato exacto, con el menor consumo de tokens"): en vez de
// mandarle a la IA la lista completa de herramientas (con consultar_datos, que sola
// pesa 2.000 a 3.000 letras) en cada vuelta, un clasificador LOCAL (sin llamar a la IA,
// 0 tokens) decide a qué sección(es) pertenece la pregunta y solo se describen las
// herramientas de esa sección. El resto va solo por nombre, y si la IA pide una que no
// se le describió, el error le devuelve cómo se usa (ver businessAssistant.service.js).

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const PAST = { re: /anterior|antes|conversaci|hablamos|dijiste|te pregunte/, tools: ["conversaciones_anteriores"] };

const SECTIONS = {
  VENDOR: [
    { re: /venta|vend[io]|ingres|factur|ganan|dinero|periodo|semana|\bmes\b|\bdia|hoy|ayer|mejor dia|rendimiento|crec/, tools: ["resumen_negocio", "ventas_por_periodo", "productos_mas_vendidos", "mejor_dia_semana", "salud_del_negocio"] },
    { re: /producto|inventario|stock|agotad|precio|catalogo|articulo|sin ventas/, tools: ["mis_productos", "detalle_de_producto", "productos_sin_ventas", "inventario_critico", "productos_mas_vendidos"] },
    { re: /pedido|orden|entrega|encargo/, tools: ["pedidos_recientes", "pedidos_detalle", "pedido_al_detalle"] },
    { re: /cliente|comprador|favorit|carrito|interes|potencial|visitan/, tools: ["interes_de_clientes", "clientes_potenciales", "clientes_y_chat", "detalle_de_cliente"] },
    { re: /resena|opinion|calific|estrella|valorac/, tools: ["resenas"] },
    { re: /\bplan\b|suscrip|verific|pago|vencim|premium|membres/, tools: ["plan_y_suscripcion", "perfil_de_la_tienda"] },
    { re: /algoritm|ranking|posicion|visibilidad|aparec|puntaje|score|salir primero/, tools: ["algoritmo_de_mi_tienda", "como_funciona_el_algoritmo", "salud_del_negocio"] },
    { re: /sesion|acceso|actividad|alerta|seguridad|dispositivo|ingreso a mi/, tools: ["actividad_de_la_cuenta", "alertas_de_la_cuenta"] },
    { re: /mensaje|notificaci|chat/, tools: ["mensajes_y_notificaciones", "clientes_y_chat"] },
    { re: /oferta|descuento|cupon|codigo|promocion/, tools: ["ofertas_y_codigos"] },
    { re: /mesero|agente|mesa|\bqr\b|personal|usuario de sistema|equipo|caja/, tools: ["personal_y_mesas", "agentes_de_ventas"] },
    { re: /tienda|horario|direccion|logo|perfil|cobertura|datos de mi/, tools: ["perfil_de_la_tienda"] },
    PAST,
  ],
  ADMIN: [
    { re: /suspendid|bloquead|eliminad|en eliminacion/, tools: ["tiendas_por_estado"], exclusive: true },
    { re: /quien es|persona|correo|telefono|responsable|representante|dueno|documento|identidad/, tools: ["buscar_persona", "ficha_del_responsable"], exclusive: true },
    { re: /tienda|negocio|vendedor/, tools: ["tiendas_top", "detalle_tienda", "consultar_tienda", "tiendas_actividad", "tiendas_por_estado"] },
    { re: /venta|ingres|factur|vendi|crecimiento|rendimiento/, tools: ["ventas_plataforma", "resumen_plataforma", "tiendas_top", "productos_top_plataforma"] },
    { re: /producto|articulo|catalogo/, tools: ["resumen_productos", "productos_top_plataforma"] },
    { re: /cliente|comprador|usuarios registrados/, tools: ["resumen_clientes", "detalle_de_cliente"] },
    { re: /suscrip|\bplan\b|verific|pago|vencim/, tools: ["suscripciones_plataforma", "pendientes_admin"] },
    { re: /pendiente|por revisar|aprobar|revisar/, tools: ["pendientes_admin"] },
    { re: /actividad|sesion|visita|trafico|en linea/, tools: ["actividad_plataforma", "tiendas_actividad"] },
    { re: /error|falla|cayo|caida|log\b/, tools: ["errores_recientes"] },
    { re: /fraude|denuncia|incumpl|reporte/, tools: ["reportes_de_fraude"] },
    { re: /\bia\b|inteligencia|modelo|groq|gemini|nvidia|chatbot|token|asistente/, tools: ["estado_ia"] },
    { re: /algoritm|ranking|posicion|puntaje/, tools: ["como_funciona_el_algoritmo", "tiendas_top"] },
    { re: /agente|mesero|usuario de sistema/, tools: ["agentes_de_ventas"] },
    { re: /venta rapida|anuncio|clasificado/, tools: ["ventas_rapidas"], exclusive: true },
    PAST,
  ],
};

const MAX_SECTION_TOOLS = 9;

// Devuelve los nombres de las herramientas de la(s) sección(es) de la pregunta, o null
// si no se reconoce ninguna (entonces se manda la lista completa, como siempre). Una
// pregunta corta de seguimiento ("¿y el mes pasado?") hereda la sección de la anterior.
export function pickSectionTools(scope, message, history = []) {
  const rules = SECTIONS[scope];
  if (!rules) return null;
  const match = (text) => {
    const t = norm(text);
    const names = new Set();
    for (const r of rules) {
      if (!r.re.test(t)) continue;
      // Una regla muy específica ("tiendas suspendidas") gana sobre las generales.
      if (r.exclusive) return new Set(r.tools);
      r.tools.forEach((n) => names.add(n));
    }
    return names;
  };
  let names = match(message);
  if (names.size === 0) {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (lastUser) names = match(lastUser.content);
  }
  if (names.size === 0) return null;
  return [...names].slice(0, MAX_SECTION_TOOLS);
}
