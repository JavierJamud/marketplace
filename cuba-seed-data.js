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
// -----------------------------------------------------------------------------

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
export const municipalities = {
  hab: ["Playa", "Plaza de la Revolución", "Centro Habana", "Habana Vieja", "Marianao", "Diez de Octubre", "Cerro", "Boyeros", "Regla", "Guanabacoa", "San Miguel del Padrón", "Cotorro", "La Lisa", "Arroyo Naranjo", "Habana del Este"],
  stg: ["Santiago de Cuba", "Palma Soriano", "Contramaestre", "San Luis", "Songo-La Maya", "Mella", "Guamá", "Segundo Frente", "Tercer Frente"],
  vcl: ["Santa Clara", "Sagua la Grande", "Caibarién", "Remedios", "Camajuaní", "Placetas", "Manicaragua", "Cifuentes"],
  hlg: ["Holguín", "Banes", "Moa", "Gibara", "Mayarí", "Antilla", "Báguanos", "Calixto García"],
  mat: ["Matanzas", "Cárdenas", "Varadero", "Colón", "Jovellanos", "Jagüey Grande", "Los Arabos"],
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
export const vendors = [
  {
    slug: "tecnohabana", companyName: "TecnoHabana", categorySlug: "tech",
    province: "hab", municipality: "Playa", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010001", timezone: "America/Havana",
    description: "Repuestos, celulares y accesorios con garantía en La Habana.",
    color: "#232F3E", salesCount: 1240, orderDestination: "panel",
    paymentMethods: ["usdt", "zelle", "card"],
    owner: { fullName: "Julio Ramírez", email: "julio@tecnohabana.cu", phone: "+5350010001" },
  },
  {
    slug: "sabor-criollo", companyName: "Sabor Criollo", categorySlug: "restaurante",
    province: "hab", municipality: "Centro Habana", plan: "business", verified: true,
    isRestaurant: true, tables: 8, whatsapp: "+5350010002", timezone: "America/Havana",
    description: "Comida cubana casera. Servicio en mesa con QR y para llevar.",
    color: "#8A5100", salesCount: 3200,
    paymentMethods: ["iban", "cashapp", "Transferencia bancaria nacional"],
    owner: { fullName: "Marta Nuñez", email: "marta@saborcriollo.cu", phone: "+5350010002" },
  },
  {
    slug: "casa-verde", companyName: "Casa Verde", categorySlug: "hogar",
    province: "vcl", municipality: "Santa Clara", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010003", timezone: "America/Havana",
    description: "Decoración y artículos para el hogar, hechos en Villa Clara.",
    color: "#003435", salesCount: 410, blocked: true,
    owner: { fullName: "Pedro Sosa", email: "pedro@casaverde.cu", phone: "+5350010003" },
  },
  {
    slug: "bella-piel", companyName: "Bella Piel", categorySlug: "belleza",
    province: "stg", municipality: "Santiago de Cuba", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010004", timezone: "America/Havana",
    description: "Cosmética natural y cuidado de la piel del oriente cubano.",
    color: "#643900", salesCount: 890,
    paymentMethods: ["paypal", "visa", "mastercard"],
    owner: { fullName: "Yaima Terry", email: "yaima@bellapiel.cu", phone: "+5350010004" },
  },
  {
    slug: "moda-caribe", companyName: "Moda Caribe", categorySlug: "moda",
    province: "hab", municipality: "Plaza de la Revolución", plan: "regular", verified: false,
    isRestaurant: false, whatsapp: "+5350010005", timezone: "America/Havana",
    description: "Ropa y accesorios de temporada. Solo por WhatsApp.",
    color: "#337475", salesCount: 260,
    owner: { fullName: "Laura Fernández", email: "laura@modacaribe.cu", phone: "+5350010005" },
  },
  {
    slug: "agro-holguin", companyName: "AgroHolguín", categorySlug: "alimentos",
    province: "hlg", municipality: "Holguín", plan: "business", verified: true,
    isRestaurant: false, whatsapp: "+5350010006", timezone: "America/Havana",
    description: "Productos agrícolas frescos, entrega en Holguín y cercanías.",
    color: "#2c5b2e", salesCount: 1520, blocked: true,
    owner: { fullName: "Ramón Ochoa", email: "ramon@agroholguin.cu", phone: "+5350010006" },
  },
];

// Usuario admin de prueba (rol ADMIN, no asociado a ninguna tienda).
export const adminUser = { fullName: "Admin ZeuDin", email: "admin@zeudin.cu", phone: "+5350000000" };

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

// Productos (price en CUP, entero). paymentMethods: whatsapp | cod | prepaid.
// isFeatured/badge/oldPrice: para que Home ("Destacados en tu provincia") y
// Shop se vean poblados con variedad real, no vacíos.
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
];

// Reseñas y comentarios de prueba. Si llevan productSlug, son la reseña con
// estrellas que se muestra en Product.jsx; si no, son el comentario público
// de "Comentarios de compradores" en Store.jsx (sin rating).
export const reviews = [
  { vendorSlug: "tecnohabana", productSlug: "audifonos-inalambricos-pro", authorName: "Yanet Pérez", rating: 5, comment: "Excelente calidad y el vendedor respondió rápido por WhatsApp.", daysAgo: 6 },
  { vendorSlug: "tecnohabana", productSlug: "cargador-usbc-25w", authorName: "Reinier Cruz", rating: 5, comment: "Muy buen precio para La Habana. Coordinamos la entrega sin problema.", daysAgo: 9 },
  { vendorSlug: "tecnohabana", productSlug: "audifonos-inalambricos-pro", authorName: "Dailín Gómez", rating: 4, comment: "Todo tal cual la foto. Lo recomiendo.", daysAgo: 14 },
  { vendorSlug: "sabor-criollo", productSlug: "ropa-vieja-con-congri", authorName: "Osmany Ruiz", rating: 5, comment: "La mejor ropa vieja que probé en Centro Habana, llegó calentita.", daysAgo: 3 },
  { vendorSlug: "sabor-criollo", productSlug: "cerdo-asado", authorName: "Claudia Font", rating: 5, comment: "Porciones generosas y muy sabroso, pedimos por WhatsApp sin problema.", daysAgo: 8 },
  { vendorSlug: "bella-piel", productSlug: "crema-hidratante-200ml", authorName: "Yanet Pérez", rating: 5, comment: "Me encantó la crema, no es grasosa y dura mucho.", daysAgo: 5 },
  { vendorSlug: "bella-piel", productSlug: "crema-hidratante-200ml", authorName: "Osmany Ruiz", rating: 4, comment: "Buena calidad, el envío a Santiago tardó un poco más.", daysAgo: 11 },
  { vendorSlug: "casa-verde", productSlug: "set-sabanas-algodon", authorName: "Claudia Font", rating: 4, comment: "Tela suave, tal cual la descripción.", daysAgo: 15 },
  { vendorSlug: "moda-caribe", productSlug: "camiseta-algodon-unisex", authorName: "Reinier Cruz", rating: 4, comment: "Buena tela, llegó rápido coordinando por WhatsApp.", daysAgo: 12 },
  { vendorSlug: "tecnohabana", authorName: "Yanet Pérez", comment: "Muy buena atención, respondieron enseguida por WhatsApp.", daysAgo: 5 },
  { vendorSlug: "tecnohabana", authorName: "Osmany Ruiz", comment: "Productos tal cual la descripción. Volveré a comprar.", daysAgo: 8 },
  { vendorSlug: "sabor-criollo", authorName: "Reinier Cruz", comment: "El servicio en mesa con QR es súper cómodo, pedimos sin esperar al mesero.", daysAgo: 2 },
  { vendorSlug: "bella-piel", authorName: "Dailín Gómez", comment: "Tienda verificada y seria, coordinamos todo por WhatsApp sin problema.", daysAgo: 7 },
  { vendorSlug: "agro-holguin", authorName: "Claudia Font", comment: "Los productos llegan frescos, se nota que son del campo.", daysAgo: 4 },
];

// Menú del restaurante Sabor Criollo, con variantes (product_options)
export const restaurantMenu = [
  { vendorSlug: "sabor-criollo", name: "Ropa vieja con congrí", category: "Platos fuertes", price: 850, isFeatured: true, badge: "Bestseller", options: [{ name: "Guarnición", values: ["Congrí", "Arroz blanco", "Puré"] }] },
  { vendorSlug: "sabor-criollo", name: "Cerdo asado", category: "Platos fuertes", price: 950, isFeatured: true, options: [{ name: "Punto", values: ["Normal", "Bien cocido"] }] },
  { vendorSlug: "sabor-criollo", name: "Tostones", category: "Entrantes", price: 250, isFeatured: false, options: [{ name: "Extra", values: ["Sin salsa", "Con mojo", "Con queso (+80)"] }] },
  { vendorSlug: "sabor-criollo", name: "Batido de mamey", category: "Bebidas", price: 180, isFeatured: false, options: [{ name: "Tamaño", values: ["Vaso", "Jarra (+120)"] }] },
];

// Clientes de prueba (role: CUSTOMER)
// country ISO en los últimos 2 (Bloque 9): datos de prueba con teléfono no
// cubano para probar el selector de país (EE.UU./México), el resto asume Cuba.
export const customers = [
  { fullName: "Yanet Pérez", email: "yanet@correo.cu", phone: "+5350020001", province: "hab", country: "CU" },
  { fullName: "Reinier Cruz", email: "reinier@correo.cu", phone: "+5350020002", province: "hab", country: "CU" },
  { fullName: "Dailín Gómez", email: "dailin@correo.cu", phone: "+5350020003", province: "hlg", country: "CU" },
  { fullName: "Osmany Ruiz", email: "osmany@correo.cu", phone: "+5350020004", province: "stg", country: "CU" },
  { fullName: "Claudia Font", email: "claudia@correo.cu", phone: "+5350020005", province: "vcl", country: "CU" },
  { fullName: "John Smith", email: "john@correo.us", phone: "+13055550101", province: "hab", country: "US" },
  { fullName: "María González", email: "maria@correo.mx", phone: "+525555550102", province: "hab", country: "MX" },
];

// Pedidos de prueba. channel: whatsapp | cod | transfer | table. status según flujo.
// items (Bloque 12): productSlug + quantity, resuelve precio real del
// producto al sembrar (nunca un total inventado) — arma OrderItem reales así
// "producto más vendido" en AdminVendors.jsx tiene datos de verdad para
// agregar, no una lista vacía. Ampliado con más pedidos delivered para
// tecnohabana/moda-caribe/sabor-criollo (Datos de prueba del bloque).
export const orders = [
  { code: "Z-2041", vendorSlug: "tecnohabana", customerEmail: "yanet@correo.cu", total: 4900, status: "new", channel: "whatsapp" },
  { code: "Z-2042", vendorSlug: "sabor-criollo", customerEmail: "reinier@correo.cu", total: 1850, status: "preparing", channel: "table", tableNumber: 4 },
  { code: "Z-2043", vendorSlug: "agro-holguin", customerEmail: "dailin@correo.cu", total: 720, status: "delivered", channel: "cod" },
  { code: "Z-2044", vendorSlug: "bella-piel", customerEmail: "osmany@correo.cu", total: 3000, status: "new", channel: "whatsapp" },
  { code: "Z-2045", vendorSlug: "casa-verde", customerEmail: "claudia@correo.cu", total: 3200, status: "cancelled", channel: "whatsapp" },
  {
    code: "Z-2046", vendorSlug: "moda-caribe", customerEmail: "yanet@correo.cu", total: 4350, status: "delivered", channel: "transfer",
    items: [{ productSlug: "zapatillas-deportivas-unisex", quantity: 1 }, { productSlug: "gorra-ajustable-bordada", quantity: 1 }],
  },
  { code: "Z-2047", vendorSlug: "tecnohabana", customerEmail: "dailin@correo.cu", total: 1800, status: "preparing", channel: "cod" },
  {
    code: "Z-2048", vendorSlug: "tecnohabana", customerEmail: "claudia@correo.cu", total: 650, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "funda-protectora-premium", quantity: 1 }],
  },
  {
    code: "Z-2049", vendorSlug: "tecnohabana", customerEmail: "osmany@correo.cu", total: 10800, status: "delivered", channel: "transfer",
    items: [{ productSlug: "power-bank-20000mah", quantity: 3 }],
  },
  {
    code: "Z-2050", vendorSlug: "tecnohabana", customerEmail: "claudia@correo.cu", total: 4900, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "audifonos-inalambricos-pro", quantity: 1 }],
  },
  {
    code: "Z-2051", vendorSlug: "tecnohabana", customerEmail: "yanet@correo.cu", total: 1850, status: "delivered", channel: "cod",
    items: [{ productSlug: "reparacion-pantallas-celular", quantity: 1 }, { productSlug: "funda-protectora-premium", quantity: 1 }],
  },
  {
    code: "Z-2052", vendorSlug: "moda-caribe", customerEmail: "dailin@correo.cu", total: 2400, status: "delivered", channel: "whatsapp",
    items: [{ productSlug: "camiseta-algodon-unisex", quantity: 2 }],
  },
  {
    code: "Z-2053", vendorSlug: "moda-caribe", customerEmail: "reinier@correo.cu", total: 5000, status: "delivered", channel: "cod",
    items: [{ productSlug: "zapatillas-deportivas-unisex", quantity: 1 }, { productSlug: "camiseta-algodon-unisex", quantity: 1 }],
  },
  {
    code: "Z-2054", vendorSlug: "sabor-criollo", customerEmail: "osmany@correo.cu", total: 1700, status: "delivered", channel: "cod",
    items: [{ productSlug: "ropa-vieja-con-congri", quantity: 2 }],
  },
  {
    code: "Z-2055", vendorSlug: "sabor-criollo", customerEmail: "claudia@correo.cu", total: 1630, status: "delivered", channel: "whatsapp",
    items: [
      { productSlug: "cerdo-asado", quantity: 1 },
      { productSlug: "tostones", quantity: 2 },
      { productSlug: "batido-de-mamey", quantity: 1 },
    ],
  },
];

// Buzón de sugerencias (Bloque 12) — mezcla de vendedor/cliente, una ya
// revisada para probar el filtro de estado en AdminSuggestions.jsx.
export const suggestions = [
  {
    authorEmail: "julio@tecnohabana.cu", authorType: "vendor",
    message: "Estaría buenísimo poder programar la publicación de un producto para una fecha y hora específica, en vez de que salga apenas lo cargo.",
    status: "new",
  },
  {
    authorEmail: "yanet@correo.cu", authorType: "customer",
    message: "Me gustaría poder guardar más de una dirección de envío como favorita para no escribirla de nuevo en cada pedido.",
    status: "new",
  },
  {
    authorEmail: "marta@saborcriollo.cu", authorType: "vendor",
    message: "Un resumen semanal por WhatsApp con las ventas de la semana me ahorraría tener que entrar al panel todos los días.",
    status: "reviewed",
  },
];

// Verificaciones KYC (status: pending_review | approved | rejected) — las 3
// variantes representadas (Bloque 10):
//  - moda-caribe: pending_review "limpio" (nunca envió documentos, cola normal).
//  - bella-piel: pending_review con notes de validación automática fallida —
//    simula la cámara capturando algo ilegible y cayendo a revisión humana.
//  - casa-verde: rejected manualmente por un admin.
//  - tecnohabana: approved SIN reviewedById → aprobación 100% automática,
//    cero intervención humana (AdminVerifications.jsx la marca "Automática").
export const verifications = [
  { vendorSlug: "moda-caribe", status: "pending_review" },
  {
    vendorSlug: "bella-piel",
    status: "pending_review",
    notes: "Validación automática: documento (resolución insuficiente (140x96px)).",
  },
  { vendorSlug: "casa-verde", status: "rejected", notes: "La foto del documento de identidad está borrosa. Volvé a subirla con buena luz y los 4 bordes visibles." },
  { vendorSlug: "tecnohabana", status: "approved" },
];

export const seedData = {
  provinces, municipalities, provinceAdjacency, categories, businessCategories, plans,
  vendors, defaultWeeklySchedule, products, restaurantMenu, reviews, customers, orders, verifications,
  adminUser, campaignHistory, integrationSeeds, suggestions,
};
