-- Corrige el texto de las ventajas de cada plan (erratas, duplicados y una línea de mesas que el plan Regular no tiene
-- activada). Solo cambia la fila si su lista sigue siendo exactamente la que tenía producción el 25 oct 2026: si alguien
-- ya la editó desde el admin, no se toca. No cambia ningún límite ni función del plan.

UPDATE "PlanConfig"
SET "features" = ARRAY[
  'Pedidos por WhatsApp',
  'Perfil de tienda público',
  'Sin comisiones por venta',
  'Hasta 5 productos',
  'Tienda activa en tu provincia'
]::TEXT[],
"updatedAt" = CURRENT_TIMESTAMP
WHERE "planType" = 'REGULAR'
  AND "features" = ARRAY[
    'Pedidos por WhatsApp',
    'Perfil de tienda público',
    'Sin comisiones por venta',
    'Hasta 5 productos',
    'Tienda activa en su provincia',
    'Hasta 5 mesas con Menus digitales'
  ]::TEXT[];

UPDATE "PlanConfig"
SET "features" = ARRAY[
  'Productos ilimitados',
  'Sello de tienda verificada',
  'Destacada en la portada',
  'Recomendaciones con IA',
  'Horarios de atención',
  'Correos ilimitados a tus clientes con el nombre de tu tienda',
  'Ofertas dentro de tu tienda',
  'Chatbot con IA para tus clientes, sin límite',
  'Códigos de descuento',
  'Programa de puntos para tus clientes',
  'Avisos de gestión por correo'
]::TEXT[],
"updatedAt" = CURRENT_TIMESTAMP
WHERE "planType" = 'BUSINESS'
  AND "features" = ARRAY[
    'Productos ilimitados',
    'Sello de tienda verificada',
    'Destacada en la home',
    'Recomendaciones con IA',
    'Horarios de atención',
    'Corrreos empresariales ilimitados',
    'Ofertas dentro de su tienda',
    'hatbot con IA para clientes ilimitado',
    'Códigos de descuento',
    'Horarios de atencion',
    'Destacada en la Home / búsqueda',
    'Programa de fidelidad (puntos) para sus clientes',
    'Correos a clientes y avisos de gestión por correo'
  ]::TEXT[];
