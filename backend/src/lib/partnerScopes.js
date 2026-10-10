// Grupos de endpoints que se le pueden dar a una llave de la API de socios.
// El admin marca cuáles activa por llave; el middleware rechaza con 403 lo demás.
export const PARTNER_SCOPES = [
  { id: "products:read", label: "Productos", description: "Listado, búsqueda, filtros y detalle de productos.", endpoints: ["GET /products", "GET /products/:id"] },
  { id: "ranking:read", label: "Ranking y destacados", description: "Productos ordenados por el mismo ranking real de Baznova.", endpoints: ["GET /products/featured"] },
  { id: "stores:read", label: "Tiendas", description: "Listado y detalle de tiendas, y los productos de cada una.", endpoints: ["GET /stores", "GET /stores/:slug", "GET /stores/:slug/products"] },
  { id: "reviews:read", label: "Reseñas", description: "Reseñas visibles de productos y tiendas.", endpoints: ["GET /products/:id/reviews", "GET /stores/:slug/reviews"] },
  { id: "offers:read", label: "Ofertas del sitio", description: "Ofertas activas publicadas por Baznova.", endpoints: ["GET /offers"] },
  { id: "store-offers:read", label: "Ofertas de tiendas", description: "Ofertas y códigos de descuento públicos de cada tienda.", endpoints: ["GET /stores/:slug/offers"] },
  { id: "catalog:read", label: "Categorías y ubicaciones", description: "Categorías, tipos de negocio, provincias y municipios.", endpoints: ["GET /categories", "GET /business-categories", "GET /locations/provinces", "GET /locations/municipalities"] },
  { id: "cart:validate", label: "Carrito", description: "Comprueba precios, stock y totales de un carrito y trae los requisitos del pedido de una tienda. No crea pedidos.", endpoints: ["POST /cart/validate", "GET /stores/:slug/checkout"] },
  { id: "orders:create", label: "Crear pedidos", description: "Crea pedidos reales (llegan al panel del vendedor y por WhatsApp igual que en Baznova) y consulta su estado.", endpoints: ["POST /orders", "GET /orders/:code"] },
  { id: "plans:read", label: "Planes y precios", description: "Planes de Baznova con el precio base y el precio final del socio.", endpoints: ["GET /plans"] },
];

export const PARTNER_SCOPE_IDS = PARTNER_SCOPES.map((s) => s.id);
export const DEFAULT_PARTNER_SCOPES = PARTNER_SCOPE_IDS;

// Límites por defecto: amplios a propósito (a Baznova le conviene que el socio muestre y
// registre muchas tiendas). Solo existen para frenar bots y abuso del navegador.
export const DEFAULT_RATE_PER_MINUTE = 1200;
export const DEFAULT_DAILY_LIMIT = 500000;
export const MAX_RATE_PER_MINUTE = 100000;
export const MAX_DAILY_LIMIT = 100000000;
