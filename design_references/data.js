// Datos mock compartidos para el prototipo Apex Marketplace
export const categories = [
  { id: 'tech', name: 'Tecnología', icon: '💻', count: 128 },
  { id: 'moda', name: 'Moda', icon: '👕', count: 214 },
  { id: 'hogar', name: 'Hogar', icon: '🛋️', count: 97 },
  { id: 'deportes', name: 'Deportes', icon: '🏋️', count: 152 },
  { id: 'belleza', name: 'Belleza', icon: '💄', count: 76 },
  { id: 'accesorios', name: 'Accesorios', icon: '👜', count: 88 },
];

export const vendors = [
  { id: 'novatek', name: 'NovaTek', category: 'Tecnología', rating: 4.8, sales: 3200, verified: true, location: 'CDMX, México', color: '#232F3E', joined: '2021' },
  { id: 'urbanwear', name: 'Urban Wear', category: 'Moda', rating: 4.6, sales: 1850, verified: true, location: 'Bogotá, Colombia', color: '#337475', joined: '2022' },
  { id: 'casanova', name: 'Casa Nova', category: 'Hogar', rating: 4.9, sales: 980, verified: true, location: 'Buenos Aires, Argentina', color: '#8A5100', joined: '2020' },
  { id: 'fitzone', name: 'FitZone', category: 'Deportes', rating: 4.7, sales: 2400, verified: false, location: 'Lima, Perú', color: '#003435', joined: '2023' },
  { id: 'bellapiel', name: 'Bella Piel', category: 'Belleza', rating: 4.5, sales: 640, verified: true, location: 'Santiago, Chile', color: '#643900', joined: '2022' },
];

export const products = [
  { id: 'p1', name: 'Auriculares NovaSound Pro', vendorId: 'novatek', category: 'tech', price: 89900, oldPrice: 119900, rating: 4.7, reviews: 128, badge: 'Nuevo', stock: 'Disponible', img: '🎧' },
  { id: 'p2', name: 'Smartwatch Orbit X3', vendorId: 'novatek', category: 'tech', price: 149900, oldPrice: null, rating: 4.6, reviews: 96, badge: 'Bestseller', stock: 'Disponible', img: '⌚' },
  { id: 'p3', name: 'Laptop AirLine 14"', vendorId: 'novatek', category: 'tech', price: 899900, oldPrice: 999900, rating: 4.8, reviews: 76, badge: '-10%', stock: 'Últimas unidades', img: '💻' },
  { id: 'p4', name: 'Campera Urban Bomber', vendorId: 'urbanwear', category: 'moda', price: 45900, oldPrice: 62900, rating: 4.5, reviews: 64, badge: '-27%', stock: 'Disponible', img: '🧥' },
  { id: 'p5', name: 'Zapatillas Street Runner', vendorId: 'urbanwear', category: 'moda', price: 38900, oldPrice: null, rating: 4.4, reviews: 152, badge: 'Nuevo', stock: 'Disponible', img: '👟' },
  { id: 'p6', name: 'Set de Vasos Nórdicos', vendorId: 'casanova', category: 'hogar', price: 15900, oldPrice: 19900, rating: 4.9, reviews: 41, badge: null, stock: 'Disponible', img: '🥃' },
  { id: 'p7', name: 'Lámpara de Piso Nordic', vendorId: 'casanova', category: 'hogar', price: 67900, oldPrice: null, rating: 4.8, reviews: 33, badge: null, stock: 'Bajo stock', img: '💡' },
  { id: 'p8', name: 'Mancuernas Ajustables 20kg', vendorId: 'fitzone', category: 'deportes', price: 129900, oldPrice: 159900, rating: 4.7, reviews: 88, badge: '-19%', stock: 'Disponible', img: '🏋️' },
  { id: 'p9', name: 'Bolso Deportivo Pro', vendorId: 'fitzone', category: 'deportes', price: 29900, oldPrice: null, rating: 4.6, reviews: 121, badge: null, stock: 'Disponible', img: '🎒' },
  { id: 'p10', name: 'Set Skincare Hidratante', vendorId: 'bellapiel', category: 'belleza', price: 24900, oldPrice: 31900, rating: 4.5, reviews: 57, badge: 'Bestseller', stock: 'Disponible', img: '🧴' },
  { id: 'p11', name: 'Perfume Essence 100ml', vendorId: 'bellapiel', category: 'belleza', price: 42900, oldPrice: null, rating: 4.6, reviews: 39, badge: null, stock: 'Disponible', img: '🌸' },
  { id: 'p12', name: 'Mochila Urban Explorer', vendorId: 'urbanwear', category: 'accesorios', price: 33900, oldPrice: 39900, rating: 4.7, reviews: 74, badge: null, stock: 'Disponible', img: '🎒' },
];

export const testimonials = [
  { name: 'Camila R.', location: 'CDMX, México', rating: 5, text: 'Compré en tres tiendas distintas y todo llegó junto y a tiempo. La plataforma es súper clara.' },
  { name: 'Diego M.', location: 'Bogotá, Colombia', rating: 5, text: 'Como vendedor, el panel me permite gestionar pedidos de forma muy simple. Recomendado.' },
  { name: 'Valentina S.', location: 'Buenos Aires, Argentina', rating: 5, text: 'Excelente variedad de vendedores y precios. El seguimiento del pedido es muy transparente.' },
];

export const orders = [
  { id: '#A-10234', date: '02 Jul 2026', customer: 'Camila Rodríguez', vendor: 'NovaTek', total: 149900, status: 'Entregado' },
  { id: '#A-10235', date: '03 Jul 2026', customer: 'Diego Martínez', vendor: 'Urban Wear', total: 45900, status: 'En camino' },
  { id: '#A-10236', date: '04 Jul 2026', customer: 'Valentina Suárez', vendor: 'FitZone', total: 129900, status: 'Procesando' },
  { id: '#A-10237', date: '05 Jul 2026', customer: 'Martín López', vendor: 'Casa Nova', total: 67900, status: 'Entregado' },
  { id: '#A-10238', date: '06 Jul 2026', customer: 'Sofía Gómez', vendor: 'Bella Piel', total: 24900, status: 'Cancelado' },
];

export function formatPrice(n) {
  return '$' + n.toLocaleString('es-AR');
}

export function vendorById(id) {
  return vendors.find(v => v.id === id);
}
