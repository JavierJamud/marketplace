// zeudin-data.js — Datos de prueba compartidos (contexto Cuba real)
// Marketplace multivendedor ZeuDin · Moneda CUP · Pedidos por WhatsApp

// ── Provincias (oeste → este) + Isla de la Juventud ──────────────────────────
export const provinces = [
  { id: 'pri', name: 'Pinar del Río' },
  { id: 'art', name: 'Artemisa' },
  { id: 'hab', name: 'La Habana' },
  { id: 'may', name: 'Mayabeque' },
  { id: 'mat', name: 'Matanzas' },
  { id: 'cfg', name: 'Cienfuegos' },
  { id: 'vcl', name: 'Villa Clara' },
  { id: 'ssp', name: 'Sancti Spíritus' },
  { id: 'cav', name: 'Ciego de Ávila' },
  { id: 'cmg', name: 'Camagüey' },
  { id: 'ltu', name: 'Las Tunas' },
  { id: 'grm', name: 'Granma' },
  { id: 'hlg', name: 'Holguín' },
  { id: 'stg', name: 'Santiago de Cuba' },
  { id: 'gtm', name: 'Guantánamo' },
  { id: 'ijv', name: 'Isla de la Juventud' },
];

// Municipios de muestra (los más usados en el prototipo)
export const municipalities = {
  hab: ['Playa', 'Plaza de la Revolución', 'Centro Habana', 'Habana Vieja', 'Marianao', 'Diez de Octubre', 'Cerro', 'Boyeros'],
  stg: ['Santiago de Cuba', 'Palma Soriano', 'Contramaestre', 'San Luis'],
  vcl: ['Santa Clara', 'Sagua la Grande', 'Caibarién', 'Remedios'],
  hlg: ['Holguín', 'Banes', 'Moa', 'Gibara'],
  mat: ['Matanzas', 'Cárdenas', 'Varadero', 'Colón'],
};

// Provincias adyacentes (para recomendar "cercanas" sin stock local)
export const adjacency = {
  hab: ['art', 'may'], art: ['pri', 'hab', 'may'], may: ['hab', 'art', 'mat'],
  mat: ['may', 'cfg', 'vcl'], vcl: ['mat', 'cfg', 'ssp'], stg: ['grm', 'hlg', 'gtm'],
  hlg: ['ltu', 'grm', 'stg'], gtm: ['stg'],
};

// ── Planes ───────────────────────────────────────────────────────────────────
export const plans = {
  regular: {
    id: 'regular', name: 'Regular', price: 0, priceLabel: 'Gratis',
    tagline: 'Empezá a vender sin costo',
    features: ['Hasta 20 productos', 'Venta por WhatsApp', 'Categorías limitadas', 'Perfil de tienda básico'],
    limits: ['Sin badge de verificación', 'Sin destacados en la home', 'Sin IA de empresa'],
  },
  business: {
    id: 'business', name: 'Business', price: 2500, priceLabel: '$2 500 CUP/mes',
    tagline: 'Verificate y vendé sin límites',
    features: ['Badge de verificación', 'Productos ilimitados', 'Destacados + aparición en home', 'IA de empresa (chatbot)', 'Horarios "Abierto/Cerrado"', 'Estadísticas avanzadas'],
    limits: [],
  },
};

// ── Categorías ────────────────────────────────────────────────────────────────
export const categories = [
  { id: 'tech', name: 'Tecnología' },
  { id: 'hogar', name: 'Hogar' },
  { id: 'moda', name: 'Moda' },
  { id: 'alimentos', name: 'Alimentos' },
  { id: 'restaurante', name: 'Restaurantes' },
  { id: 'belleza', name: 'Belleza' },
  { id: 'servicios', name: 'Servicios' },
];

// ── Vendedores (tiendas) ───────────────────────────────────────────────────────
export const vendors = [
  { id: 'tecnohabana', name: 'TecnoHabana', category: 'Tecnología', province: 'hab', municipality: 'Playa', plan: 'business', verified: true, restaurant: false, rating: 4.8, sales: 1240, whatsapp: '5350010001', color: '#232F3E', joined: '2023', open: true, desc: 'Repuestos, celulares y accesorios con garantía en La Habana.' },
  { id: 'sabor-criollo', name: 'Sabor Criollo', category: 'Restaurantes', province: 'hab', municipality: 'Centro Habana', plan: 'business', verified: true, restaurant: true, rating: 4.9, sales: 3200, whatsapp: '5350010002', color: '#8A5100', joined: '2022', open: true, desc: 'Comida cubana casera. Servicio en mesa con QR y para llevar.' },
  { id: 'casa-verde', name: 'Casa Verde', category: 'Hogar', province: 'vcl', municipality: 'Santa Clara', plan: 'regular', verified: false, restaurant: false, rating: 4.6, sales: 410, whatsapp: '5350010003', color: '#003435', joined: '2024', open: false, desc: 'Decoración y artículos para el hogar, hechos en Villa Clara.' },
  { id: 'bella-piel-cuba', name: 'Bella Piel', category: 'Belleza', province: 'stg', municipality: 'Santiago de Cuba', plan: 'business', verified: true, restaurant: false, rating: 4.7, sales: 890, whatsapp: '5350010004', color: '#643900', joined: '2023', open: true, desc: 'Cosmética natural y cuidado de la piel del oriente cubano.' },
  { id: 'moda-caribe', name: 'Moda Caribe', category: 'Moda', province: 'hab', municipality: 'Plaza de la Revolución', plan: 'regular', verified: false, restaurant: false, rating: 4.4, sales: 260, whatsapp: '5350010005', color: '#337475', joined: '2024', open: true, desc: 'Ropa y accesorios de temporada. Solo por WhatsApp.' },
  { id: 'agro-holguin', name: 'AgroHolguín', category: 'Alimentos', province: 'hlg', municipality: 'Holguín', plan: 'business', verified: true, restaurant: false, rating: 4.8, sales: 1520, whatsapp: '5350010006', color: '#2c5b2e', joined: '2022', open: true, desc: 'Productos agrícolas frescos, entrega en Holguín y cercanías.' },
];

// ── Productos (precios en CUP) ─────────────────────────────────────────────────
export const products = [
  { id: 'p1', name: 'Cargador rápido USB-C 25W', vendorId: 'tecnohabana', category: 'tech', price: 1800, oldPrice: 2200, stock: 34, barcode: '7501234567890', rating: 4.7, reviews: 62, badge: 'Nuevo', payment: ['whatsapp', 'cod'] },
  { id: 'p2', name: 'Audífonos inalámbricos Pro', vendorId: 'tecnohabana', category: 'tech', price: 4900, oldPrice: null, stock: 12, barcode: '7501234567891', rating: 4.6, reviews: 48, badge: 'Bestseller', payment: ['whatsapp', 'cod', 'prepaid'] },
  { id: 'p3', name: 'Set de sábanas de algodón', vendorId: 'casa-verde', category: 'hogar', price: 3200, oldPrice: 3900, stock: 8, barcode: '7501234567892', rating: 4.6, reviews: 21, badge: '-18%', payment: ['whatsapp'] },
  { id: 'p4', name: 'Crema hidratante facial 200ml', vendorId: 'bella-piel-cuba', category: 'belleza', price: 1500, oldPrice: null, stock: 40, barcode: '7501234567893', rating: 4.7, reviews: 33, badge: null, payment: ['whatsapp', 'cod'] },
  { id: 'p5', name: 'Camiseta de algodón unisex', vendorId: 'moda-caribe', category: 'moda', price: 1200, oldPrice: 1600, stock: 60, barcode: '7501234567894', rating: 4.4, reviews: 18, badge: '-25%', payment: ['whatsapp'] },
  { id: 'p6', name: 'Malanga fresca (libra)', vendorId: 'agro-holguin', category: 'alimentos', price: 90, oldPrice: null, stock: 200, barcode: '7501234567895', rating: 4.8, reviews: 44, badge: null, payment: ['whatsapp', 'cod'] },
];

// ── Menú de restaurante (Sabor Criollo) con variantes ──────────────────────────
export const restaurantMenu = [
  { id: 'm1', name: 'Ropa vieja con congrí', category: 'Platos fuertes', price: 850, desc: 'Carne de res desmechada, arroz congrí y plátano maduro.', options: [{ name: 'Guarnición', values: ['Congrí', 'Arroz blanco', 'Puré'] }] },
  { id: 'm2', name: 'Cerdo asado', category: 'Platos fuertes', price: 950, desc: 'Cerdo asado a la cubana con yuca con mojo.', options: [{ name: 'Punto', values: ['Normal', 'Bien cocido'] }] },
  { id: 'm3', name: 'Tostones', category: 'Entrantes', price: 250, desc: 'Plátano verde frito, crujiente.', options: [{ name: 'Extra', values: ['Sin salsa', 'Con mojo', 'Con queso (+80)'] }] },
  { id: 'm4', name: 'Batido de mamey', category: 'Bebidas', price: 180, desc: 'Batido natural de temporada.', options: [{ name: 'Tamaño', values: ['Vaso', 'Jarra (+120)'] }] },
];

// ── Pedidos (dashboard vendedor / admin) ────────────────────────────────────────
export const orders = [
  { id: '#Z-2041', date: '06 Jul 2026', customer: 'Yanet Pérez', vendor: 'TecnoHabana', total: 4900, status: 'Nuevo', channel: 'WhatsApp' },
  { id: '#Z-2042', date: '06 Jul 2026', customer: 'Reinier Cruz', vendor: 'Sabor Criollo', total: 1850, status: 'Preparando', channel: 'Mesa 4' },
  { id: '#Z-2043', date: '05 Jul 2026', customer: 'Dailín Gómez', vendor: 'AgroHolguín', total: 720, status: 'Entregado', channel: 'Contra entrega' },
  { id: '#Z-2044', date: '05 Jul 2026', customer: 'Osmany Ruiz', vendor: 'Bella Piel', total: 3000, status: 'Nuevo', channel: 'WhatsApp' },
  { id: '#Z-2045', date: '04 Jul 2026', customer: 'Claudia Font', vendor: 'Casa Verde', total: 3200, status: 'Cancelado', channel: 'WhatsApp' },
];

// Solicitudes de verificación KYC (panel admin)
export const verifications = [
  { id: 'v1', vendor: 'Moda Caribe', owner: 'Laura Fdez.', province: 'La Habana', submitted: '06 Jul 2026', status: 'pending' },
  { id: 'v2', vendor: 'Casa Verde', owner: 'Pedro Sosa', province: 'Villa Clara', submitted: '05 Jul 2026', status: 'pending' },
  { id: 'v3', vendor: 'TecnoHabana', owner: 'Julio Ramírez', province: 'La Habana', submitted: '02 Jul 2026', status: 'approved' },
];

export const statusColors = {
  'Nuevo': '#337475', 'Preparando': '#8A5100', 'Listo': '#0CAE53',
  'En camino': '#2A6FDB', 'Entregado': '#0CAE53', 'Cancelado': '#ba1a1a',
  'Procesando': '#8A5100',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
export function fmtCUP(n) { return n.toLocaleString('es-CU') + ' CUP'; }
export function provinceName(id) { const p = provinces.find(x => x.id === id); return p ? p.name : ''; }
export function vendorById(id) { return vendors.find(v => v.id === id); }
export function productById(id) { return products.find(p => p.id === id); }
// Arma el enlace de pedido por WhatsApp con el detalle
export function waLink(phone, text) {
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
}
