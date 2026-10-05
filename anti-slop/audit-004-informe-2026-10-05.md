# antislop · Informe de cierre de la auditoría 004 · 2026-10-05

Los 19 hallazgos de `audit-004-2026-10-04.md` quedan resueltos (el #7 ya estaba). Aprobación: el dueño pidió corregir todos los que faltaban.
Verificado en vivo con Playwright a 390×844 y a 1280×900, con mediciones en el DOM.

## Antes y después (celular 390×844)

| Medida | Antes | Después |
|---|---|---|
| Alto total de la página | 6917px | 3792px |
| Hero | 1168px | 452px |
| Categorías visibles sin scroll | no (empezaban en 1168px) | sí (empiezan en 452px) |
| Tiendas verificadas empiezan en | 5891px | 592px |
| Productos destacados en la grilla | 20 (3333px) | 8 en celular, 9, 12 y 20 según el ancho |
| Alto de la tarjeta de producto | ~330px | 257px |
| Tarjeta "Abre tu tienda" | 705px | 479px |
| Desborde horizontal | no | no (375 = 375) |
| Raya larga en texto visible de la página | 1 | 0 |

## Hallazgo por hallazgo

| # | Resultado | Evidencia |
|---|---|---|
| 1 | Resuelto | Hero compacto: sin pastilla, sin slider de imágenes en celular (queda en escritorio), un solo botón principal. 452px. |
| 2 | Resuelto | Se midieron todos los `a` y `button` visibles de la página: ninguno bajo 44px salvo el enlace en línea "Más información" del aviso de cookies. Carrito, cuenta, buscar, botón de agregar al carrito, pills de categoría, "Ver todo", enlaces del footer, cerrar carrito y "Estoy de acuerdo" pasan a 44px. Los puntos del slider miden 8px a la vista y 24px de área táctil. |
| 3 | Resuelto | El contador de la oferta va en la misma fila que el nombre de la tienda y el texto no puede subir sobre la franja del descuento. En celular se ocultan tagline y descripción. |
| 4 | Resuelto | El texto legal del footer reserva 96px abajo en celular (el botón del chat mide 52 a 60px más 20px de margen). |
| 5 | Resuelto | La raya larga de la tarjeta de vendedores y la del globo del chat pasan a punto. |
| 6 | Resuelto | Subtítulos de sección y descripción de producto pasan a `on-surface-variant` (9,33:1 sobre blanco). El texto legal del footer sube de 40% a 60% de opacidad. |
| 7 | Hecho antes | Pastilla "Marketplace multi vendedor" eliminada (commit 2a6ce23). |
| 8 | Resuelto | Pastilla "PARA DUEÑOS DE NEGOCIO" eliminada. |
| 9 | Resuelto | Categorías: fila deslizable con el dedo en celular (sin animación). Con "reducir movimiento" no hay marquee ni autoplay en ningún slider. Botón real "Pausar ofertas" / "Pausar tiendas". El autoplay de tiendas se detiene al tocar. |
| 10 | Resuelto | Sin el mockup de 3 teléfonos en celular: la tarjeta pasa de 705px a 479px. Escritorio sin cambios. |
| 11 | Resuelto | La flecha queda solo en "Ver todo" de las secciones. Sin flecha en el CTA del hero, "Ver catálogo", "Crear mi tienda" ni "Ver catálogo completo". |
| 12 | Resuelto | Icono de tienda en "Ver tiendas en Baznova". |
| 13 | Resuelto | "Ofertas de la semana" aparece una sola vez. |
| 14 | Resuelto | Orden: hero, categorías, tiendas verificadas, ofertas, destacados, abre tu tienda. |
| 15 | Resuelto | 8 destacados en celular, 9 desde sm, 12 desde md, 20 desde lg (siempre filas completas), y botón ancho "Ver todo el catálogo". |
| 16 | Resuelto | En celular se quitan la descripción y el chip de rubro; "...leer más" se elimina en todos los tamaños. |
| 17 | Resuelto | Título de sección de 20px en celular: ninguno se parte en dos líneas. |
| 18 | Resuelto | "Explora por categoría", "cerca de ti". Además se eliminó el voseo y el "acá" de todo el sitio (commit aparte). |
| 19 | Resuelto | El hero le habla al comprador; "Sin comisiones por venta" y la mención a restaurantes y comercios viven en la tarjeta "Abre tu tienda". |

## Fuera del alcance de esta auditoría

Fotos de producto que no corresponden (datos de prueba del entorno de desarrollo).
