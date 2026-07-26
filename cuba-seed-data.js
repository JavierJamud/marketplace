// cuba-seed-data.js
// -----------------------------------------------------------------------------
// Dataset de prueba (contexto Cuba real) para el marketplace ZeuDin.
// Pensado para consumirse desde backend/prisma/seed.js.
//
// Cómo usarlo:
//   import { seedData } from "./cuba-seed-data.js";  (o require, según tu setup)
//   ...recorré seedData.* y creá los registros con prisma.<modelo>.createMany/create.
//
// Mapea a los modelos de ARQUITECTURA_MARKETPLACE.md §14:
//   provinces, municipalities, province_adjacency, categories, users, profiles,
//   vendors, vendor_locations, products, product_options, payment_methods,
//   orders, tables, table_orders, reviews, subscriptions, verifications.
//
// Moneda: CUP (enteros). Teléfonos WhatsApp en formato internacional (53...).
// Nota: los password_hash acá son placeholders — hasheá con bcrypt en el seed real.
//
// Bloque 53 (pedido explícito): dataset ampliado de 6 a 12 tiendas (cubriendo
// 10 de las 16 provincias), imágenes de referencia en cada producto, más
// clientes/pedidos/verificaciones. Credenciales de prueba (mismo password
// para TODAS las cuentas sembradas, ver backend/prisma/seed.js DEV_PASSWORD
// = "Zeudin2026!"):
//   Admin:    admin@zeudin.com
//   Vendedor (Business, verificado):  julio.ramirez@zeudin.com   (TecnoHabana)
//   Vendedor (Regular, sin verificar): laura.fernandez@zeudin.com (Moda Caribe)
//   Vendedor nuevo (Morón):           idelsis.perdomo@zeudin.com (Electro Morón)
//   Cliente con pedidos:              yanet.perez@zeudin.com
//   Cliente sin pedidos:              damaris.leyva@zeudin.com
// Imágenes: SOLO referenciales (picsum.photos con semilla estable por
// producto, nunca la foto real del artículo) — en producción cada vendedor
// sube o enlaza las suyas (ver Bloque 53, punto 2 — subida o enlace).
// -----------------------------------------------------------------------------

function imgSeed(slug, count = 2) {
  return Array.from({ length: count }, (_, i) => `https://picsum.photos/seed/${slug}-${i + 1}/800/800`);
}

export const provinces = [
  { code: "pri", name: "Pinar del Río" },
  { code: "art", name: "Artemisa" },
  { code: "hab", name: "La Habana" },
  { code: "may", name: "Mayabeque" },
  { code: "mat", name: "Matanzas" },
  { code: "cfg", name: "Cienfuegos" },
  { code: "vcl", name: "Villa Clara" },
  { code: "ssp", name: "Sancti Spíritus" },
  { code: "cav", name: "Ciego de Ávila" },
  { code: "cmg", name: "Camagüey" },
  { code: "ltu", name: "Las Tunas" },
  { code: "grm", name: "Granma" },
  { code: "hlg", name: "Holguín" },
  { code: "stg", name: "Santiago de Cuba" },
  { code: "gtm", name: "Guantánamo" },
  { code: "ijv", name: "Isla de la Juventud" },
];

// Muestra de municipios por provincia (ampliá con el listado completo de 168 en tu seed real)
// Bloque 53: se agregan cav/cmg/cfg/gtm/ltu (antes solo 5 de 16 provincias
// tenían municipios de muestra) — Morón (pedido explícito) vive en cav.
export const municipalities = {
  hab: ["Playa", "Plaza de la Revolución", "Centro Habana", "Habana Vieja", "Marianao", "Diez de Octubre", "Cerro", "Boyeros", "Regla", "Guanabacoa", "San Miguel del Padrón", "Cotorro", "La Lisa", "Arroyo Naranjo", "Habana del Este"],
  stg: ["Santiago de Cuba", "Palma Soriano", "Contramaestre", "San Luis", "Songo-La Maya", "Mella", "Guamá", "Segundo Frente", "Tercer Frente"],
  vcl: ["Santa Clara", "Sagua la Grande", "Caibarién", "Remedios", "Camajuaní", "Placetas", "Manicaragua", "Cifuentes"],
  hlg: ["Holguín", "Banes", "Moa", "Gibara", "Mayarí", "Antilla", "Báguanos", "Calixto García"],
  mat: ["Matanzas", "Cárdenas", "Varadero", "Colón", "Jovellanos", "Jagüey Grande", "Los Arabos"],
  cav: ["Morón", "Ciego de Ávila", "Chambas", "Florencia", "Majagua", "Venezuela"],
  cmg: ["Camagüey", "Nuevitas", "Florida", "Vertientes", "Guáimaro"],
  cfg: ["Cienfuegos", "Cumanayagua", "Palmira", "Rodas"],
  gtm: ["Guantánamo", "Baracoa", "Maisí", "Imías"],
  ltu: ["Las Tunas", "Puerto Padre", "Manatí", "Jesús Menéndez"],
};

export const provinceAdjacency = {
  pri: ["art"], art: ["pri", "hab", "may"], hab: ["art", "may"], may: ["hab", "art", "mat"],
  mat: ["may", "cfg", "vcl"], cfg: ["mat", "vcl", "ssp"], vcl: ["mat", "cfg", "ssp"],
  ssp: ["vcl", "cfg", "cav"], cav: ["ssp", "cmg"], cmg: ["cav", "ltu"], ltu: ["cmg", "grm", "hlg"],
  grm: ["ltu", "hlg", "stg"], hlg: ["ltu", "grm", "stg"], stg: ["grm", "hlg", "gtm"], gtm: ["stg"],
};

export const categories = [
  { slug: "tech", name: "Tecnología" },
  { slug: "hogar", name: "Hogar" },
  { slug: "moda", name: "Moda" },
  { slug: "alimentos", name: "Alimentos" },
  { slug: "restaurante", name: "Restaurantes" },
  { slug: "belleza", name: "Belleza" },
  { slug: "servicios", name: "Servicios" },
];

// Bloque 18: catálogo de "tipo de negocio" (rubro de la tienda, elegido una
// sola vez al registrarse) — modelo BusinessCategory, separado del Category
// de arriba (ese sigue siendo de producto/rubro heredado, no se toca). Ícono
// = nombre exacto de un export de lucide-react (mapeo documentado en
// tokens-cheatsheet.md). Orden = el mismo orden en que aparecen acá.
export const businessCategories = [
  { slug: "tienda-general", name: "Tienda general", icon: "Store" },
  { slug: "catalogo", name: "Catálogo", icon: "BookOpen" },
  { slug: "belleza-negocio", name: "Belleza", icon: "Sparkles" },
  { slug: "tienda-de-regalos", name: "Tienda de regalos", icon: "Gift" },
  { slug: "combos", name: "Combos", icon: "PackagePlus" },
  { slug: "dulceria", name: "Dulcería", icon: "Candy" },
  { slug: "ropa", name: "Ropa", icon: "Shirt" },
  { slug: "arte-y-artesania", name: "Arte y artesanía", icon: "Palette" },
  { slug: "cafeteria-y-comida-rapida", name: "Cafetería y comida rápida", icon: "Utensils" },
  { slug: "restaurante-negocio", name: "Restaurante", icon: "UtensilsCrossed" },
  { slug: "bar", name: "Bar", icon: "Martini" },
  { slug: "hogar-y-decoracion", name: "Hogar y decoración", icon: "Sofa" },
  { slug: "articulos-de-aseo", name: "Artículos de aseo", icon: "SprayCan" },
  { slug: "grocery-o-bodegon", name: "Grocery o bodegón", icon: "ShoppingBasket" },
  { slug: "ferreteria", name: "Ferretería", icon: "Hammer" },
  { slug: "perfumeria", name: "Perfumería", icon: "FlaskConical" },
  { slug: "cosmetica-natural", name: "Cosmética natural", icon: "Leaf" },
  { slug: "joyeria-y-relojeria", name: "Joyería y relojería", icon: "Gem" },
  { slug: "ropa-deportiva", name: "Ropa deportiva", icon: "Footprints" },
  { slug: "moviles-y-accesorios", name: "Móviles y accesorios", icon: "Smartphone" },
  { slug: "impresion-y-personalizacion", name: "Impresión y personalización", icon: "Printer" },
  { slug: "cafe", name: "Café", icon: "Coffee" },
  { slug: "jugueteria", name: "Juguetería", icon: "ToyBrick" },
  { slug: "gym", name: "Gym", icon: "Dumbbell" },
  { slug: "marketing-y-publicidad", name: "Marketing y publicidad", icon: "Megaphone" },
  { slug: "set", name: "Set", icon: "Package" },
  { slug: "shop", name: "Shop", icon: "ShoppingBag" },
  { slug: "heladeria", name: "Heladería", icon: "IceCreamCone" },
  { slug: "productos-naturales", name: "Productos naturales", icon: "Sprout" },
  { slug: "organizacion-de-eventos", name: "Organización de eventos", icon: "PartyPopper" },
  { slug: "salud-y-farmacia", name: "Salud y farmacia", icon: "Pill" },
  { slug: "tienda-de-mascotas", name: "Tienda de mascotas", icon: "PawPrint" },
  { slug: "carniceria", name: "Carnicería", icon: "Beef" },
  { slug: "computadoras-y-accesorios", name: "Computadoras y accesorios", icon: "Laptop" },
  { slug: "pizzeria", name: "Pizzería", icon: "Pizza" },
  { slug: "imprenta", name: "Imprenta", icon: "Newspaper" },
  { slug: "articulos-para-bebes", name: "Artículos para bebés", icon: "Baby" },
  { slug: "automotriz", name: "Automotriz", icon: "Car" },
  { slug: "tienda-de-videojuegos", name: "Tienda de videojuegos", icon: "Gamepad2" },
  { slug: "servicios-informaticos", name: "Servicios informáticos", icon: "Server" },
  { slug: "floristeria", name: "Floristería", icon: "Flower2" },
  { slug: "panaderia", name: "Panadería", icon: "Croissant" },
  { slug: "servicio-de-fotografia", name: "Servicio de fotografía", icon: "Camera" },
  { slug: "hamburguesa", name: "Hamburguesa", icon: "Sandwich" },
  { slug: "optica", name: "Óptica", icon: "Glasses" },
  { slug: "academia", name: "Academia", icon: "GraduationCap" },
  { slug: "pescaderia", name: "Pescadería", icon: "Fish" },
  { slug: "enoteca", name: "Enoteca", icon: "Wine" },
  { slug: "consultoria", name: "Consultoría", icon: "Briefcase" },
];

export const plans = {
  regular: { code: "regular", name: "Regular", priceCUP: 0, maxProducts: 20 },
  business: { code: "business", name: "Business", priceCUP: 2500, maxProducts: null },
};

// Vendedores (tiendas). owner = datos de perfil privado (KYC).
// color/salesCount tomados de zeudin-data.js (referencia de diseño).
// Bloque 53: 6 tiendas nuevas (moron-electro, ferreteria-camaguey,
// pizzeria-varadero, farmacia-cienfuegos, boutique-guantanamo,
// autopartes-tunas) — cubren 6 provincias nuevas, un 2do restaurante, y un
// negocio permanentemente cerrado (boutique-guantanamo, ver
// closedAllWeek) para poder probar el estado "cerrado ahora" sin depender
// de en qué día/hora corra el seed.
export const vendors = [
  {
    slug: "tecnohabana", companyName: "TecnoHabana", categorySlug: "tech", businessCategorySlug: "computadoras-y-accesorios",
    province: "hab", municipality: "Playa", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010001", timezone: "America/Havana",
    description: "Repuestos, celulares y accesorios con garantía en La Habana.",
    color: "#232F3E", salesCount: 1240, orderDestination: "panel",
    paymentMethods: ["usdt", "zelle", "card"],
    owner: { fullName: "Julio Ramírez", email: "julio.ramirez@zeudin.com", phone: "+5350010001" },
  },
  {
    slug: "sabor-criollo", companyName: "Sabor Criollo", categorySlug: "restaurante", businessCategorySlug: "restaurante-negocio",
    province: "hab", municipality: "Centro Habana", plan: "business", verified: true,
    isRestaurant: true, tables: 8, whatsapp: "+5350010002", timezone: "America/Havana",
    description: "Comida cubana casera. Servicio en mesa con QR y para llevar.",
    color: "#8A5100", salesCount: 3200,
    paymentMethods: ["iban", "cashapp", "Transferencia bancaria nacional"],
    owner: { fullName: "Marta Núñez", email: "marta.nunez@zeudin.com", phone: "+5350010002" },
  },
  {
    slug: "casa-verde", companyName: "Casa Verde", categorySlug: "hogar", businessCategorySlug: "hogar-y-decoracion",
    province: "vcl", municipality: "Santa Clara", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010003", timezone: "America/Havana",
    description: "Decoración y artículos para el hogar, hechos en Villa Clara.",
    color: "#003435", salesCount: 410, blocked: true,
    owner: { fullName: "Pedro Sosa", email: "pedro.sosa@zeudin.com", phone: "+5350010003" },
  },
  {
    slug: "bella-piel", companyName: "Bella Piel", categorySlug: "belleza", businessCategorySlug: "cosmetica-natural",
    province: "stg", municipality: "Santiago de Cuba", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010004", timezone: "America/Havana",
    description: "Cosmética natural y cuidado de la piel del oriente cubano.",
    color: "#643900", salesCount: 890,
    paymentMethods: ["paypal", "visa", "mastercard"],
    owner: { fullName: "Yaima Terry", email: "yaima.terry@zeudin.com", phone: "+5350010004" },
  },
  {
    slug: "moda-caribe", companyName: "Moda Caribe", categorySlug: "moda", businessCategorySlug: "ropa",
    province: "hab", municipality: "Plaza de la Revolución", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010005", timezone: "America/Havana",
    description: "Ropa y accesorios de temporada. Solo por WhatsApp.",
    color: "#337475", salesCount: 260,
    owner: { fullName: "Laura Fernández", email: "laura.fernandez@zeudin.com", phone: "+5350010005" },
  },
  {
    slug: "agro-holguin", companyName: "AgroHolguín", categorySlug: "alimentos", businessCategorySlug: "grocery-o-bodegon",
    province: "hlg", municipality: "Holguín", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010006", timezone: "America/Havana",
    description: "Productos agrícolas frescos, entrega en Holguín y cercanías.",
    color: "#2c5b2e", salesCount: 1520, blocked: true,
    owner: { fullName: "Ramón Ochoa", email: "ramon.ochoa@zeudin.com", phone: "+5350010006" },
  },
  // --- Nuevas (Bloque 53) ----------------------------------------------------
  {
    slug: "electro-moron", companyName: "Electro Morón", categorySlug: "hogar", businessCategorySlug: "hogar-y-decoracion",
    province: "cav", municipality: "Morón", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010007", timezone: "America/Havana",
    description: "Paneles solares, neveras y equipos eléctricos para el hogar en Morón, Ciego de Ávila.",
    color: "#8A5100", salesCount: 640,
    paymentMethods: ["usdt", "zelle"],
    owner: { fullName: "Idelsis Perdomo", email: "idelsis.perdomo@zeudin.com", phone: "+5350010007" },
  },
  {
    slug: "ferreteria-camaguey", companyName: "Ferretería Camagüey", categorySlug: "servicios", businessCategorySlug: "ferreteria",
    province: "cmg", municipality: "Camagüey", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010008", timezone: "America/Havana",
    description: "Herramientas y materiales de construcción para el hogar y el taller.",
    color: "#643900", salesCount: 175,
    owner: { fullName: "Ernesto Villar", email: "ernesto.villar@zeudin.com", phone: "+5350010008" },
  },
  {
    slug: "pizzeria-varadero", companyName: "Pizzería Varadero", categorySlug: "restaurante", businessCategorySlug: "pizzeria",
    province: "mat", municipality: "Varadero", plan: "business", verified: true,
    isRestaurant: true, tables: 6, whatsapp: "+5350010009", timezone: "America/Havana",
    description: "Pizzas al horno de leña y pastas, a metros de la playa.",
    color: "#ba1a1a", salesCount: 980,
    paymentMethods: ["visa", "mastercard", "cashapp"],
    owner: { fullName: "Roberto Alonso", email: "roberto.alonso@zeudin.com", phone: "+5350010009" },
  },
  {
    slug: "farmacia-natural-cienfuegos", companyName: "Farmacia Natural Cienfuegos", categorySlug: "belleza", businessCategorySlug: "salud-y-farmacia",
    province: "cfg", municipality: "Cienfuegos", plan: "regular", verified: true,
    isRestaurant: false, whatsapp: "+5350010010", timezone: "America/Havana",
    description: "Productos naturales, cosmética y cuidado personal.",
    color: "#2c5b2e", salesCount: 320,
    owner: { fullName: "Yusleidy Cárdenas", email: "yusleidy.cardenas@zeudin.com", phone: "+5350010010" },
  },
  {
    slug: "boutique-guantanamo", companyName: "Boutique Guantánamo", categorySlug: "moda", businessCategorySlug: "ropa",
    province: "gtm", municipality: "Guantánamo", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010011", timezone: "America/Havana",
    description: "Ropa, calzado y accesorios de temporada — actualmente cerrada temporalmente.",
    color: "#001d1e", salesCount: 60, closedAllWeek: true,
    owner: { fullName: "Suyén Matos", email: "suyen.matos@zeudin.com", phone: "+5350010011" },
  },
  {
    slug: "autopartes-tunas", companyName: "AutoPartes Las Tunas", categorySlug: "servicios", businessCategorySlug: "automotriz",
    province: "ltu", municipality: "Las Tunas", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010012", timezone: "America/Havana",
    description: "Piezas, baterías y accesorios para autos y motos.",
    color: "#0e1a28", salesCount: 505,
    paymentMethods: ["usdt", "card"],
    owner: { fullName: "Maikel Suárez", email: "maikel.suarez@zeudin.com", phone: "+5350010012" },
  },
];

// Usuario admin de prueba (rol ADMIN, no asociado a ninguna tienda).
export const adminUser = { fullName: "Admin ZeuDin", email: "admin@zeudin.com", phone: "+5350000000" };

// Campañas ya "enviadas" (histórico de ejemplo, no se reenvían al sembrar).
export const campaignHistory = [
  { subject: "Semana del vendedor: 0% comisión", segment: "all_vendors", sentCount: 312, openCount: 190, daysAgo: 8 },
  { subject: "Nuevos restaurantes con menú QR", segment: "all_customers", sentCount: 1420, openCount: 682, daysAgo: 12 },
  { subject: "Recordatorio: verificá tu tienda", segment: "regular_vendors", sentCount: 198, openCount: 109, daysAgo: 20 },
];

// Integraciones de ejemplo (claves dummy — se cifran al sembrar, nunca en texto plano).
// Bloque 25: Stripe queda afuera a propósito — sus credenciales son 3
// campos (pública/secreta/webhook secret) con su propio endpoint de guardado
// (ver integrations.controller.js upsertStripeIntegration), y el único
// origen válido pasa a ser lo que el admin cargue de verdad desde
// AdminIntegrations.jsx. Sembrar una dummy acá dejaba "sk_test_..." activa
// sin que nadie la hubiera cargado — justo lo que este bloque corrige.
export const integrationSeeds = [
  { name: "gemini", credential: "dummy_gemini_key_sandbox", isActive: true },
  { name: "groq", credential: "dummy_groq_key_sandbox", isActive: false },
  { name: "resend", credential: "re_dummy_sandbox_key_000000", isActive: true },
];

// Horario semanal por defecto para todos los vendedores (lun-sáb 8:00-20:00,
// domingo cerrado) — no hay horarios específicos por tienda en el dataset de
// referencia, así que se aplica el mismo a todos para poder calcular
// "abierto ahora" de forma real en vez de un booleano fijo.
export const defaultWeeklySchedule = [
  { dayOfWeek: 0, opensAt: "08:00", closesAt: "20:00", isClosed: true }, // domingo
  { dayOfWeek: 1, opensAt: "08:00", closesAt: "20:00", isClosed: false },
  { dayOfWeek: 2, opensAt: "08:00", closesAt: "20:00", isClosed: false },
  { dayOfWeek: 3, opensAt: "08:00", closesAt: "20:00", isClosed: false },
  { dayOfWeek: 4, opensAt: "08:00", closesAt: "20:00", isClosed: false },
  { dayOfWeek: 5, opensAt: "08:00", closesAt: "20:00", isClosed: false },
  { dayOfWeek: 6, opensAt: "09:00", closesAt: "14:00", isClosed: false }, // sábado medio día
];

// Bloque 53: horario de una tienda permanentemente cerrada (boutique-guantanamo)
// — todos los días isClosed:true, para poder probar el estado "cerrado
// ahora" en Store.jsx sin depender de en qué día/hora corra el seed.
export const closedWeeklySchedule = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opensAt: "08:00", closesAt: "20:00", isClosed: true }));

// Productos (price en CUP, entero). paymentMethods: whatsapp | cod | prepaid.
// isFeatured/badge/oldPrice: para que Home ("Destacados en tu provincia") y
// Shop se vean poblados con variedad real, no vacíos.
// images: Bloque 53 (pedido explícito) — SOLO referenciales (picsum con
// semilla estable por slug), nunca la foto real del artículo.
export const products = [
  { slug: "cargador-usbc-25w", vendorSlug: "tecnohabana", categorySlug: "tech", name: "Cargador rápido USB-C 25W", price: 1800, stock: 34, barcode: "7501234567890", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Nuevo" },
  { slug: "audifonos-inalambricos-pro", vendorSlug: "tecnohabana", categorySlug: "tech", name: "Audífonos inalámbricos Pro", price: 4900, oldPrice: 6900, stock: 12, barcode: "7501234567891", paymentMethods: ["whatsapp", "cod", "prepaid"], isFeatured: true, badge: "-29%" },
  { slug: "reparacion-pantallas-celular", vendorSlug: "tecnohabana", categorySlug: "servicios", name: "Reparación de pantalla de celular", price: 1200, stock: 0, barcode: "7501234567899", paymentMethods: ["whatsapp"], isFeatured: true, badge: "Servicio" },
  { slug: "set-sabanas-algodon", vendorSlug: "casa-verde", categorySlug: "hogar", name: "Set de sábanas de algodón", price: 3200, stock: 8, barcode: "7501234567892", paymentMethods: ["whatsapp"], isFeatured: true },
  { slug: "instalacion-aires-acondicionados", vendorSlug: "casa-verde", categorySlug: "servicios", name: "Instalación de aires acondicionados", price: 2500, stock: 0, barcode: "7501234567900", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "crema-hidratante-200ml", vendorSlug: "bella-piel", categorySlug: "belleza", name: "Crema hidratante facial 200ml", price: 1500, oldPrice: 1900, stock: 40, barcode: "7501234567893", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "-21%" },
  { slug: "camiseta-algodon-unisex", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Camiseta de algodón unisex", price: 1200, stock: 60, barcode: "7501234567894", paymentMethods: ["whatsapp"], isFeatured: true, badge: "Nuevo" },
  { slug: "malanga-fresca-libra", vendorSlug: "agro-holguin", categorySlug: "alimentos", name: "Malanga fresca (libra)", price: 90, stock: 200, barcode: "7501234567895", paymentMethods: ["whatsapp", "cod"], isFeatured: true },
  { slug: "funda-protectora-premium", vendorSlug: "tecnohabana", categorySlug: "tech", name: "Funda protectora premium", price: 650, stock: 50, barcode: "7501234567901", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "power-bank-20000mah", vendorSlug: "tecnohabana", categorySlug: "tech", name: "Power bank 20000mAh", price: 3600, oldPrice: 4200, stock: 5, barcode: "7501234567902", paymentMethods: ["whatsapp", "cod", "prepaid"], isFeatured: true, badge: "Agotándose" },
  { slug: "lampara-mesa-decorativa", vendorSlug: "casa-verde", categorySlug: "hogar", name: "Lámpara de mesa decorativa", price: 1900, stock: 15, barcode: "7501234567903", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "shampoo-natural-aloe", vendorSlug: "bella-piel", categorySlug: "belleza", name: "Shampoo natural de aloe", price: 980, stock: 1, barcode: "7501234567904", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Última unidad" },
  { slug: "zapatillas-deportivas-unisex", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Zapatillas deportivas unisex", price: 3800, oldPrice: 4500, stock: 22, barcode: "7501234567905", paymentMethods: ["whatsapp"], isFeatured: true, badge: "-16%" },
  { slug: "gorra-ajustable-bordada", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Gorra ajustable bordada", price: 550, stock: 40, barcode: "7501234567906", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "platano-burro-raciamo", vendorSlug: "agro-holguin", categorySlug: "alimentos", name: "Plátano burro (racimo)", price: 320, stock: 0, barcode: "7501234567907", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "miel-pura-abeja-pomo", vendorSlug: "agro-holguin", categorySlug: "alimentos", name: "Miel pura de abeja (pomo)", price: 450, stock: 60, barcode: "7501234567908", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Nuevo" },
  // Moda Caribe (Plan Regular) con catálogo cerca del límite de 20 productos,
  // para poder probar el bloqueo del producto #21 en el panel de vendedor.
  { slug: "vestido-verano-floral", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Vestido de verano floral", price: 1900, stock: 18, barcode: "7501234567909", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "pantalon-jean-recto", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Pantalón jean recto", price: 1650, stock: 25, barcode: "7501234567910", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "short-deportivo-hombre", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Short deportivo hombre", price: 850, stock: 30, barcode: "7501234567911", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "blusa-manga-corta", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Blusa manga corta", price: 950, stock: 20, barcode: "7501234567912", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "chancletas-goma-unisex", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Chancletas de goma unisex", price: 450, stock: 45, barcode: "7501234567913", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "correa-cuero-hombre", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Correa de cuero hombre", price: 700, stock: 16, barcode: "7501234567914", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "medias-pack-x3", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Medias pack x3", price: 380, stock: 50, barcode: "7501234567915", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "sueter-cuello-redondo", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Suéter cuello redondo", price: 2100, oldPrice: 2500, stock: 9, barcode: "7501234567916", paymentMethods: ["whatsapp"], isFeatured: false, badge: "-16%" },
  { slug: "falda-lapiz-negra", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Falda lápiz negra", price: 1400, stock: 12, barcode: "7501234567917", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "camisa-vestir-hombre", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Camisa de vestir hombre", price: 1750, stock: 14, barcode: "7501234567918", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "traje-bano-mujer", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Traje de baño mujer", price: 1300, stock: 10, barcode: "7501234567919", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "gorro-lana-invierno", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Gorro de lana", price: 320, stock: 28, barcode: "7501234567920", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "cartera-mano-mujer", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Cartera de mano mujer", price: 1550, stock: 7, barcode: "7501234567921", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "lentes-sol-unisex", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Lentes de sol unisex", price: 600, stock: 33, barcode: "7501234567922", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "pijama-algodon-dama", vendorSlug: "moda-caribe", categorySlug: "moda", name: "Pijama de algodón dama", price: 1100, stock: 11, barcode: "7501234567923", paymentMethods: ["whatsapp"], isFeatured: false },

  // --- Electro Morón (Bloque 53, pedido explícito): paneles solares y neveras ---
  { slug: "panel-solar-100w-monocristalino", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Panel solar 100W monocristalino", price: 8500, stock: 25, barcode: "7502234500001", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Nuevo" },
  { slug: "panel-solar-200w-regulador", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Panel solar 200W con regulador de carga", price: 15500, stock: 14, barcode: "7502234500002", paymentMethods: ["whatsapp", "cod"], isFeatured: true },
  { slug: "kit-solar-300w-completo", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Kit solar 300W completo (panel + batería + inversor)", price: 42000, stock: 6, barcode: "7502234500003", paymentMethods: ["whatsapp", "prepaid"], isFeatured: true, badge: "Más vendido" },
  { slug: "bateria-gel-12v-100ah", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Batería de gel 12V 100Ah (uso solar)", price: 18000, stock: 10, barcode: "7502234500004", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "inversor-corriente-1000w", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Inversor de corriente 1000W", price: 12000, stock: 18, barcode: "7502234500005", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "refrigerador-7-pies-electrico", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Refrigerador 7 pies eléctrico", price: 55000, stock: 4, barcode: "7502234500006", paymentMethods: ["whatsapp", "prepaid"], isFeatured: true, badge: "Bestseller" },
  { slug: "nevera-compacta-3-pies", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Nevera compacta 3 pies", price: 22000, oldPrice: 26000, stock: 9, barcode: "7502234500007", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "-15%" },
  { slug: "refrigerador-industrial-dos-puertas", vendorSlug: "electro-moron", categorySlug: "hogar", name: "Refrigerador industrial de dos puertas", price: 95000, stock: 2, barcode: "7502234500008", paymentMethods: ["prepaid"], isFeatured: false, badge: "Últimas unidades" },

  // --- Ferretería Camagüey ---
  { slug: "taladro-percutor-750w", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Taladro percutor 750W", price: 9800, stock: 11, barcode: "7502234600001", paymentMethods: ["whatsapp", "cod"], isFeatured: true },
  { slug: "juego-llaves-combinadas-12pz", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Juego de llaves combinadas 12 piezas", price: 3200, stock: 20, barcode: "7502234600002", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "pintura-latex-blanca-galon", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Pintura látex blanca 1 galón", price: 2600, stock: 30, barcode: "7502234600003", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Nuevo" },
  { slug: "cemento-gris-saco-42kg", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Cemento gris 42.5kg (saco)", price: 1400, stock: 50, barcode: "7502234600004", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "cinta-metrica-5m", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Cinta métrica 5m", price: 450, stock: 40, barcode: "7502234600005", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "candado-seguridad-50mm", vendorSlug: "ferreteria-camaguey", categorySlug: "hogar", name: "Candado de seguridad 50mm", price: 800, stock: 0, barcode: "7502234600006", paymentMethods: ["whatsapp"], isFeatured: false },

  // --- Farmacia Natural Cienfuegos ---
  { slug: "jabon-sabila-artesanal", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Jabón de sábila artesanal", price: 380, stock: 55, barcode: "7502234700001", paymentMethods: ["whatsapp", "cod"], isFeatured: true, badge: "Nuevo" },
  { slug: "aceite-coco-virgen-250ml", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Aceite de coco virgen 250ml", price: 950, stock: 22, barcode: "7502234700002", paymentMethods: ["whatsapp", "cod"], isFeatured: true },
  { slug: "te-manzanilla-organico", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Té de manzanilla orgánico", price: 420, stock: 34, barcode: "7502234700003", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "crema-para-varices", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Crema para várices", price: 1100, stock: 18, barcode: "7502234700004", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "multivitaminico-natural", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Multivitamínico natural (frasco)", price: 1300, stock: 3, barcode: "7502234700005", paymentMethods: ["whatsapp"], isFeatured: true, badge: "Agotándose" },
  { slug: "repelente-mosquitos-natural", vendorSlug: "farmacia-natural-cienfuegos", categorySlug: "belleza", name: "Repelente de mosquitos natural", price: 500, stock: 40, barcode: "7502234700006", paymentMethods: ["whatsapp", "cod"], isFeatured: false },

  // --- Boutique Guantánamo ---
  { slug: "vestido-casual-verano-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Vestido casual de verano", price: 1650, stock: 14, barcode: "7502234800001", paymentMethods: ["whatsapp"], isFeatured: true },
  { slug: "camisa-lino-hombre-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Camisa de lino hombre", price: 1400, stock: 10, barcode: "7502234800002", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "sandalias-cuero-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Sandalias de cuero", price: 1200, stock: 16, barcode: "7502234800003", paymentMethods: ["whatsapp"], isFeatured: true, badge: "Nuevo" },
  { slug: "bolso-artesanal-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Bolso artesanal", price: 900, stock: 8, barcode: "7502234800004", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "pantalon-capri-mujer-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Pantalón capri mujer", price: 1050, stock: 12, barcode: "7502234800005", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "collar-coral-bisuteria-gtm", vendorSlug: "boutique-guantanamo", categorySlug: "moda", name: "Collar de coral (bisutería)", price: 480, stock: 20, barcode: "7502234800006", paymentMethods: ["whatsapp"], isFeatured: false },

  // --- AutoPartes Las Tunas ---
  { slug: "bateria-auto-12v-60ah", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Batería de auto 12V 60Ah", price: 14500, stock: 7, barcode: "7502234900001", paymentMethods: ["whatsapp", "prepaid"], isFeatured: true, badge: "Bestseller" },
  { slug: "aceite-motor-4l-sintetico", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Aceite de motor 4L sintético", price: 2800, stock: 25, barcode: "7502234900002", paymentMethods: ["whatsapp", "cod"], isFeatured: true },
  { slug: "filtro-aire-universal", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Filtro de aire universal", price: 650, stock: 30, barcode: "7502234900003", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "pastillas-freno-delanteras", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Pastillas de freno delanteras", price: 1900, stock: 15, barcode: "7502234900004", paymentMethods: ["whatsapp", "cod"], isFeatured: false },
  { slug: "bombillo-led-h4", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Bombillo LED H4", price: 750, stock: 40, barcode: "7502234900005", paymentMethods: ["whatsapp"], isFeatured: false },
  { slug: "limpiaparabrisas-universal-20", vendorSlug: "autopartes-tunas", categorySlug: "servicios", name: "Limpiaparabrisas universal 20\"", price: 550, stock: 0, barcode: "7502234900006", paymentMethods: ["whatsapp"], isFeatured: false },
];

// Reseñas y comentarios de prueba. Si llevan productSlug, son la reseña con
// estrellas que se muestra en Product.jsx; si no, son el comentario público
// de "Comentarios de compradores" en Store.jsx (sin rating).
export const reviews = [
  { vendorSlug: "tecnohabana", productSlug: "audifonos-inalambricos-pro", authorName: "Yanet Pérez", rating: 5, comment: "Excelente calidad y el vendedor respondió rápido por WhatsApp.", daysAgo: 6 },
  { vendorSlug: "tecnohabana", productSlug: "cargador-usbc-25w", authorName: "Reinier Cruz", rating: 5, comment: "Muy buen precio para La Habana. Coordinamos la entrega sin problema.", daysAgo: 9 },
  { vendorSlug: "tecnohabana", productSlug: "audifonos-inalambricos-pro", authorName: "Dailín Gómez", rating: 4, comment: "Todo tal cual la foto. Lo recomiendo.", daysAgo: 14 },
  { vendorSlug: "sabor-criollo", productSlug: "ropa-vieja-con-congri", authorName: "Osmany Ruiz", rating: 5, comment: "La mejor ropa vieja que probé en Centro Habana, llegó calentita.", daysAgo: 3 },
  { vendorSlug: "sabor-criollo", productSlug: "cerdo-asado", authorName: "Claudia Font", rating: 5, comment: "Porciones generosas y muy sabrosas, pedimos por WhatsApp sin problema.", daysAgo: 8 },
  { vendorSlug: "bella-piel", productSlug: "crema-hidratante-200ml", authorName: "Yanet Pérez", rating: 5, comment: "Me encantó la crema, no es grasosa y dura mucho.", daysAgo: 5 },
  { vendorSlug: "bella-piel", productSlug: "crema-hidratante-200ml", authorName: "Osmany Ruiz", rating: 4, comment: "Buena calidad, el envío a Santiago tardó un poco más.", daysAgo: 11 },
  { vendorSlug: "casa-verde", productSlug: "set-sabanas-algodon", authorName: "Claudia Font", rating: 4, comment: "Tela suave, tal cual la descripción.", daysAgo: 15 },
  { vendorSlug: "moda-caribe", productSlug: "camiseta-algodon-unisex", authorName: "Reinier Cruz", rating: 4, comment: "Buena tela, llegó rápido coordinando por WhatsApp.", daysAgo: 12 },
  { vendorSlug: "tecnohabana", authorName: "Yanet Pérez", comment: "Muy buena atención, respondieron enseguida por WhatsApp.", daysAgo: 5 },
  { vendorSlug: "tecnohabana", authorName: "Osmany Ruiz", comment: "Productos tal cual la descripción. Volveré a comprar.", daysAgo: 8 },
  { vendorSlug: "sabor-criollo", authorName: "Reinier Cruz", comment: "El servicio en mesa con QR es súper cómodo, pedimos sin esperar al mesero.", daysAgo: 2 },
  { vendorSlug: "bella-piel", authorName: "Dailín Gómez", comment: "Tienda verificada y seria, coordinamos todo por WhatsApp sin problema.", daysAgo: 7 },
  { vendorSlug: "agro-holguin", authorName: "Claudia Font", comment: "Los productos llegan frescos, se nota que son del campo.", daysAgo: 4 },
  // Bloque 53: reseñas para las tiendas nuevas
  { vendorSlug: "electro-moron", productSlug: "kit-solar-300w-completo", authorName: "Damaris Leyva", rating: 5, comment: "El kit solar funciona perfecto, ya no me afectan los apagones. Muy buena atención.", daysAgo: 4 },
  { vendorSlug: "electro-moron", productSlug: "nevera-compacta-3-pies", authorName: "Frank Miranda", rating: 5, comment: "Llegó bien empacada y funciona de maravilla. Recomendado.", daysAgo: 9 },
  { vendorSlug: "electro-moron", authorName: "Yoel Prieto", comment: "Buena tienda, responden rápido y explican bien las especificaciones técnicas.", daysAgo: 2 },
  { vendorSlug: "pizzeria-varadero", productSlug: "pizza-especial", authorName: "Frank Miranda", rating: 5, comment: "La mejor pizza cerca de la playa, siempre pedimos la especial.", daysAgo: 3 },
  { vendorSlug: "farmacia-natural-cienfuegos", productSlug: "jabon-sabila-artesanal", authorName: "Yoel Prieto", rating: 4, comment: "Muy buen jabón, natural de verdad y rinde bastante.", daysAgo: 10 },
  { vendorSlug: "autopartes-tunas", productSlug: "bateria-auto-12v-60ah", authorName: "Maité Reyes", rating: 5, comment: "Batería original y con garantía, mejor precio que en otras tiendas.", daysAgo: 6 },
];

// Menú del restaurante Sabor Criollo, con variantes (product_options)
export const restaurantMenu = [
  { vendorSlug: "sabor-criollo", name: "Ropa vieja con congrí", category: "Platos fuertes", price: 850, isFeatured: true, badge: "Bestseller", options: [{ name: "Guarnición", values: ["Congrí", "Arroz blanco", "Puré"] }] },
  { vendorSlug: "sabor-criollo", name: "Cerdo asado", category: "Platos fuertes", price: 950, isFeatured: true, options: [{ name: "Punto", values: ["Normal", "Bien cocido"] }] },
  { vendorSlug: "sabor-criollo", name: "Tostones", category: "Entrantes", price: 250, isFeatured: false, options: [{ name: "Extra", values: ["Sin salsa", "Con mojo", "Con queso (+80)"] }] },
  { vendorSlug: "sabor-criollo", name: "Batido de mamey", category: "Bebidas", price: 180, isFeatured: false, options: [{ name: "Tamaño", values: ["Vaso", "Jarra (+120)"] }] },
  // Bloque 53: menú de Pizzería Varadero (2do restaurante) — cubre el
  // pedido de "al menos 2 restaurantes con menú y mesas".
  { vendorSlug: "pizzeria-varadero", name: "Pizza Margarita", category: "Pizzas", price: 650, isFeatured: true, options: [{ name: "Tamaño", values: ["Mediana", "Grande (+250)"] }] },
  { vendorSlug: "pizzeria-varadero", name: "Pizza Especial", category: "Pizzas", price: 850, isFeatured: true, badge: "Bestseller", options: [{ name: "Tamaño", values: ["Mediana", "Grande (+250)"] }] },
  { vendorSlug: "pizzeria-varadero", name: "Pizza Hawaiana", category: "Pizzas", price: 780, isFeatured: false, options: [{ name: "Tamaño", values: ["Mediana", "Grande (+250)"] }] },
  { vendorSlug: "pizzeria-varadero", name: "Ensalada César", category: "Entrantes", price: 380, isFeatured: false, options: [{ name: "Con pollo", values: ["Sí (+150)", "No"] }] },
  { vendorSlug: "pizzeria-varadero", name: "Refresco Tropicola", category: "Bebidas", price: 150, isFeatured: false, options: [{ name: "Tamaño", values: ["Lata", "Botella 1L (+100)"] }] },
];

// Clientes de prueba (role: CUSTOMER)
// country ISO en los últimos 2 (Bloque 9): datos de prueba con teléfono no
// cubano para probar el selector de país (EE.UU./México), el resto asume Cuba.
// Bloque 53: dominio de correo unificado a @zeudin.com (antes @correo.cu/
// .us/.mx) y se agregan 3 clientes más (10 en total) — al menos uno sin
// ningún pedido (damaris.leyva) para probar el estado vacío de "Mis pedidos".
export const customers = [
  { fullName: "Yanet Pérez", email: "yanet.perez@zeudin.com", phone: "+5350020001", province: "hab", country: "CU" },
  { fullName: "Reinier Cruz", email: "reinier.cruz@zeudin.com", phone: "+5350020002", province: "hab", country: "CU" },
  { fullName: "Dailín Gómez", email: "dailin.gomez@zeudin.com", phone: "+5350020003", province: "hlg", country: "CU" },
  { fullName: "Osmany Ruiz", email: "osmany.ruiz@zeudin.com", phone: "+5350020004", province: "stg", country: "CU" },
  { fullName: "Claudia Font", email: "claudia.font@zeudin.com", phone: "+5350020005", province: "vcl", country: "CU" },
  { fullName: "John Smith", email: "john.smith@zeudin.com", phone: "+13055550101", province: "hab", country: "US" },
  { fullName: "María González", email: "maria.gonzalez@zeudin.com", phone: "+525555550102", province: "hab", country: "MX" },
  { fullName: "Damaris Leyva", email: "damaris.leyva@zeudin.com", phone: "+5350020006", province: "cav", country: "CU" },
  { fullName: "Frank Miranda", email: "frank.miranda@zeudin.com", phone: "+5350020007", province: "mat", country: "CU" },
  { fullName: "Yoel Prieto", email: "yoel.prieto@zeudin.com", phone: "+5350020008", province: "cfg", country: "CU" },
  { fullName: "Maité Reyes", email: "maite.reyes@zeudin.com", phone: "+5350020009", province: "ltu", country: "CU" },
];

// Pedidos de prueba. channel: whatsapp | cod | transfer | table. status según flujo.
// items (Bloque 12): productSlug + quantity, resuelve precio real del
// producto al sembrar (nunca un total inventado) — arma OrderItem reales así
// "producto más vendido" en AdminVendors.jsx tiene datos de verdad para
// agregar, no una lista vacía. Bloque 53: se agregan pedidos "ready" (antes
// ningún pedido de prueba pasaba por ese estado) y pedidos para las 6
// tiendas nuevas — 22 pedidos en total, todos los estados/canales reales
// de la plataforma representados.
export const orders = [
  { code: "Z-2041", vendorSlug: "tecnohabana", customerEmail: "yanet.perez@zeudin.com", total: 4900, status: "new", channel: "whatsapp" },
  { code: "Z-2042", vendorSlug: "sabor-criollo", customerEmail: "reinier.cruz@zeudin.com", total: 1850, status: "preparing", channel: "table", tableNumber: 4 },
  { code: "Z-2043", vendorSlug: "agro-holguin", customerEmail: "dailin.gomez@zeudin.com", total: 720, status: "delivered", channel: "cod" },
  { code: "Z-2044", vendorSlug: "bella-piel", customerEmail: "osmany.ruiz@zeudin.com", total: 3000, status: "new", channel: "whatsapp" },
  { code: "Z-2045", vendorSlug: "casa-verde", customerEmail: "claudia.font@zeudin.com", total: 3200, status: "cancelled", channel: "whatsapp" },
  {
    code: "Z-2046", vendorSlug: "moda-caribe", customerEmail: "yanet.perez@zeudin.com", total: 4350, status: "delivered", channel: "transfer",
    items: [{ productSlug: "zapatillas-deportivas-unisex", quantity: 1 }, { productSlug: "gorra-ajustable-bordada", quantity: 1 }],
  },
  { code: "Z-2047", vendorSlug: "tecnohabana", customerEmail: "dailin.gomez@zeudin.com", total: 1800, status: "preparing", channel: "cod" },
  {
    code: "Z-2048", vendorSlug: "tecnohabana", customerEmail: "claudia.font@zeudin.com", total: 650, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "funda-protectora-premium", quantity: 1 }],
  },
  {
    code: "Z-2049", vendorSlug: "tecnohabana", customerEmail: "osmany.ruiz@zeudin.com", total: 10800, status: "delivered", channel: "transfer",
    items: [{ productSlug: "power-bank-20000mah", quantity: 3 }],
  },
  {
    code: "Z-2050", vendorSlug: "tecnohabana", customerEmail: "claudia.font@zeudin.com", total: 4900, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "audifonos-inalambricos-pro", quantity: 1 }],
  },
  {
    code: "Z-2051", vendorSlug: "tecnohabana", customerEmail: "yanet.perez@zeudin.com", total: 1850, status: "delivered", channel: "cod",
    items: [{ productSlug: "reparacion-pantallas-celular", quantity: 1 }, { productSlug: "funda-protectora-premium", quantity: 1 }],
  },
  {
    code: "Z-2052", vendorSlug: "moda-caribe", customerEmail: "dailin.gomez@zeudin.com", total: 2400, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "camiseta-algodon-unisex", quantity: 2 }],
  },
  {
    code: "Z-2053", vendorSlug: "moda-caribe", customerEmail: "reinier.cruz@zeudin.com", total: 5000, status: "delivered", channel: "cod",
    items: [{ productSlug: "zapatillas-deportivas-unisex", quantity: 1 }, { productSlug: "camiseta-algodon-unisex", quantity: 1 }],
  },
  {
    code: "Z-2054", vendorSlug: "sabor-criollo", customerEmail: "osmany.ruiz@zeudin.com", total: 1700, status: "delivered", channel: "cod",
    items: [{ productSlug: "ropa-vieja-con-congri", quantity: 2 }],
  },
  {
    code: "Z-2055", vendorSlug: "sabor-criollo", customerEmail: "claudia.font@zeudin.com", total: 1630, status: "delivered", channel: "whatsapp",
    items: [
      { productSlug: "cerdo-asado", quantity: 1 },
      { productSlug: "tostones", quantity: 2 },
      { productSlug: "batido-de-mamey", quantity: 1 },
    ],
  },
  // --- Nuevos (Bloque 53) ----------------------------------------------------
  {
    code: "Z-2056", vendorSlug: "electro-moron", customerEmail: "damaris.leyva@zeudin.com", total: 42000, status: "ready", channel: "transfer",
    items: [{ productSlug: "kit-solar-300w-completo", quantity: 1 }],
  },
  {
    code: "Z-2057", vendorSlug: "electro-moron", customerEmail: "frank.miranda@zeudin.com", total: 22000, status: "preparing", channel: "cod",
    items: [{ productSlug: "nevera-compacta-3-pies", quantity: 1 }],
  },
  {
    code: "Z-2058", vendorSlug: "electro-moron", customerEmail: "yoel.prieto@zeudin.com", total: 8500, status: "new", channel: "whatsapp",
    items: [{ productSlug: "panel-solar-100w-monocristalino", quantity: 1 }],
  },
  {
    code: "Z-2059", vendorSlug: "pizzeria-varadero", customerEmail: "frank.miranda@zeudin.com", total: 1700, status: "ready", channel: "table", tableNumber: 2,
  },
  {
    code: "Z-2060", vendorSlug: "farmacia-natural-cienfuegos", customerEmail: "yoel.prieto@zeudin.com", total: 1330, status: "delivered", channel: "cod",
    items: [{ productSlug: "jabon-sabila-artesanal", quantity: 1 }, { productSlug: "aceite-coco-virgen-250ml", quantity: 1 }],
  },
  {
    code: "Z-2061", vendorSlug: "autopartes-tunas", customerEmail: "maite.reyes@zeudin.com", total: 14500, status: "delivered", channel: "transfer",
    items: [{ productSlug: "bateria-auto-12v-60ah", quantity: 1 }],
  },
  {
    code: "Z-2062", vendorSlug: "ferreteria-camaguey", customerEmail: "maite.reyes@zeudin.com", total: 9800, status: "new", channel: "whatsapp",
    items: [{ productSlug: "taladro-percutor-750w", quantity: 1 }],
  },
];

// Buzón de sugerencias (Bloque 12) — mezcla de vendedor/cliente, una ya
// revisada para probar el filtro de estado en AdminSuggestions.jsx.
export const suggestions = [
  {
    authorEmail: "julio.ramirez@zeudin.com", authorType: "vendor",
    message: "Estaría buenísimo poder programar la publicación de un producto para una fecha y hora específica, en vez de que salga apenas lo cargo.",
    status: "new",
  },
  {
    authorEmail: "yanet.perez@zeudin.com", authorType: "customer",
    message: "Me gustaría poder guardar más de una dirección de envío como favorita para no escribirla de nuevo en cada pedido.",
    status: "new",
  },
  {
    authorEmail: "marta.nunez@zeudin.com", authorType: "vendor",
    message: "Un resumen semanal por WhatsApp con las ventas de la semana me ahorraría tener que entrar al panel todos los días.",
    status: "reviewed",
  },
  {
    authorEmail: "idelsis.perdomo@zeudin.com", authorType: "vendor",
    message: "Me gustaría poder marcar productos como 'solo bajo pedido' para los paneles solares que no siempre tengo en existencia.",
    status: "new",
  },
];

// Verificaciones KYC (status: pending_review | approved | rejected) — las 3
// variantes representadas (Bloque 10), ampliado en el Bloque 53 con 2 casos
// más (approved automático y pending_review "limpio" en tiendas nuevas)
// para tener al menos 2-3 ejemplos por estado:
//  - moda-caribe / ferreteria-camaguey: pending_review "limpio" (nunca
//    envió documentos, cola normal).
//  - bella-piel: pending_review con notes de validación automática fallida —
//    simula la cámara capturando algo ilegible y cayendo a revisión humana.
//  - casa-verde / boutique-guantanamo: rejected manualmente por un admin.
//  - tecnohabana / electro-moron / pizzeria-varadero: approved SIN
//    reviewedById → aprobación 100% automática, cero intervención humana
//    (AdminVerifications.jsx la marca "Automática").
export const verifications = [
  { vendorSlug: "moda-caribe", status: "pending_review" },
  { vendorSlug: "ferreteria-camaguey", status: "pending_review" },
  {
    vendorSlug: "bella-piel",
    status: "pending_review",
    notes: "Validación automática: documento (resolución insuficiente (140x96px)).",
  },
  { vendorSlug: "casa-verde", status: "rejected", notes: "La foto del documento de identidad está borrosa. Volvé a subirla con buena luz y los 4 bordes visibles." },
  { vendorSlug: "boutique-guantanamo", status: "rejected", notes: "El selfie no coincide con la foto del documento. Repetí la captura asegurándote de que la cara se vea completa." },
  { vendorSlug: "tecnohabana", status: "approved" },
  { vendorSlug: "electro-moron", status: "approved" },
  { vendorSlug: "pizzeria-varadero", status: "approved" },
];

export const seedData = {
  provinces, municipalities, provinceAdjacency, categories, businessCategories, plans,
  vendors, defaultWeeklySchedule, closedWeeklySchedule, products, restaurantMenu, reviews, customers, orders, verifications,
  adminUser, campaignHistory, integrationSeeds, suggestions,
  imgSeed,
};
