# Baznova: guía de marca para crear las imágenes del Hero

Resumen de referencia para escribir los prompts de Nano Banana (u otra IA de imágenes) que crearán las imágenes del Hero de la página principal. Todo lo que dice este documento sale de la plataforma tal como funciona hoy.

---

## 1. Qué es Baznova

Baznova es un **marketplace cubano de tiendas locales**. Reúne en un solo sitio a tiendas, restaurantes, cafeterías y comercios de todas las provincias de Cuba, para que la gente compre cerca de casa y para que cualquier negocio tenga su tienda en línea sin pagar por empezar.

- **Frase del Hero:** "Compra cerca de ti, a vendedores de tu provincia."
- **Apoyo:** "Productos, comida y servicios de tiendas locales. Pide directo por WhatsApp, paga contra entrega o por transferencia."
- **Para vendedores:** "Abre tu tienda online gratis, hoy mismo."

## 2. Para quién es

- **Compradores:** personas en Cuba que quieren encontrar productos, comida y servicios en su provincia y pedirlos fácil, desde el celular.
- **Vendedores:** tiendas, restaurantes, cafeterías, bares y comercios pequeños y medianos que quieren vender en línea sin conocimientos técnicos.

## 3. Qué ofrece la plataforma

**Para comprar**
- Catálogo de productos y tiendas filtrado por provincia.
- Pedido directo por WhatsApp o desde el sitio, con pago contra entrega, por transferencia o por adelantado, según la tienda.
- Tiendas verificadas con sello verde (la plataforma revisa su identidad).
- Ofertas de la semana y códigos de descuento de cada tienda.
- Asistente de compras con IA: se le pregunta qué se busca, por texto o por voz, y recomienda productos.
- Favoritos, reseñas, carrito compartido y "Venta rápida" (anuncios de clientes para vender cosas propias).

**Para vender**
- Tienda propia con catálogo, logo y enlace para compartir.
- Pedidos por WhatsApp o en el panel del vendedor.
- Restaurantes: menú digital y un código QR por mesa para pedir desde la mesa.
- Usuarios de sistema para el equipo (agentes de ventas y meseros) y cierre de caja.
- Asistente de negocio con IA que lee las ventas, los clientes y el algoritmo y da consejos.
- Ofertas, códigos de descuento y estadísticas de la tienda.

**Planes**
- **Regular (gratis):** hasta 20 productos, pedidos por WhatsApp, perfil de tienda público, sin comisiones por venta.
- **Premium:** productos ilimitados, sello de tienda verificada, tienda destacada en la página principal, recomendaciones con IA y horarios de atención.

## 4. Ventajas

**Comprar en Baznova**
- Todo lo de tu provincia en un solo lugar.
- Pides directo a la tienda, sin intermediarios, por WhatsApp.
- Pagas como prefieras: al recibir o por transferencia.
- Sabes en quién confiar gracias al sello de tienda verificada y a las reseñas.
- Funciona bien en el celular, que es como se usa en Cuba.

**Vender en Baznova**
- Abrir la tienda es gratis y toma minutos.
- Sin comisión por venta.
- Los pedidos llegan por WhatsApp o al panel, como el negocio prefiera.
- Los restaurantes reciben pedidos desde la mesa con QR.
- Las tiendas verificadas con plan de pago salen destacadas y en la publicidad de la plataforma.

---

## 5. Colores

Los valores salen del tema del código (`frontend/tailwind.config.js`).

| Color | Hex | Dónde se usa |
| --- | --- | --- |
| Azul marino (principal) | `#0E1A28` | Fondo del Hero, barra de menú, pie de página, botones oscuros, cabeceras de tablas |
| Azul pizarra | `#232F3E` | Degradados junto al azul marino (tarjeta "Abre tu tienda", paneles de acceso) |
| Naranja (acento) | `#FE9800` | Botón principal ("Explorar el catálogo", "Crear mi tienda gratis"), palabra destacada del Hero, insignias |
| Marrón tostado | `#643900` | Texto sobre los botones naranjas |
| Ámbar oscuro | `#8A5100` | Acento secundario en texto |
| Verde azulado | `#337475` | Enlaces, iconos y estados activos del panel |
| Verde azulado claro | `#61A0A1` | Detalles y acentos suaves |
| Verde verificado | `#0CAE53` | Sello de tienda verificada y estados correctos |
| Fondo claro | `#FBF9FA` | Fondo general de las páginas |
| Blanco | `#FFFFFF` | Tarjetas y texto sobre el azul marino |
| Gris de superficie | `#F0EDEE` | Fondos de bloques y campos |
| Texto principal | `#1B1B1D` | Títulos y textos sobre fondo claro |
| Texto secundario | `#44474C` | Descripciones |
| Rojo de error | `#BA1A1A` | Avisos de error y acciones de borrar |

**La combinación de marca** es el azul marino con el naranja: el Hero es azul marino con una palabra en naranja, y los botones principales son naranjas.

## 6. Tipografía

- **Montserrat** (títulos), en negrita.
- **Inter** (textos y botones).

## 7. Estilo y tono

- Cercano, local y práctico. Habla de tú, en español de Cuba.
- Esquinas redondeadas y tarjetas limpias sobre fondo claro.
- Personas reales de Cuba, negocios reales de barrio, luz natural cálida.
- Nada de estética futurista, robots, brillos de "IA" ni lujo exagerado.

---

## 8. Cómo se ven las imágenes del Hero

- Van en un **carrusel con fundido** a la derecha del texto del Hero en computadora, y debajo del texto en celular.
- **Formato:** horizontal **3:2**, recomendado **1200 × 800 px** o más grande. Una imagen con otra proporción se ve completa pero con bandas a los lados.
- **Fondo de la sección:** azul marino `#0E1A28`. La imagen debe verse bien sobre ese color: bordes limpios, sin fondo blanco que choque.
- **El texto del Hero va aparte**, en la página. **La imagen no debe llevar texto, logos ni marcas de agua.**
- Se pueden subir varias. El panel las carga en Configuración (Marca de la plataforma, "Imagen principal del sitio").

---

## 9. Prompt base para Nano Banana

Copia el prompt base y cambia solo la escena de cada imagen.

> Fotografía realista, horizontal 3:2 (1200×800), de una escena cotidiana en Cuba relacionada con comprar y vender en una tienda local. **[ESCENA]**. Luz natural cálida de tarde, colores vivos pero naturales, con acentos de naranja (#FE9800) y azul marino (#0E1A28) en objetos de la escena (ropa, bolsas, toldo, cajas), sin que dominen. Personas cubanas reales, de distintas edades, con expresión natural y amable. Composición limpia con espacio libre en un lado, profundidad de campo suave. Estilo de fotografía documental comercial, nítida, sin filtros exagerados. Sin texto, sin letras, sin logos, sin marcas de agua, sin pantallas con texto legible, sin estética futurista ni elementos de inteligencia artificial.

**Escenas sugeridas (una por imagen):**

1. **Comprar desde el celular:** una mujer joven en un portal colonial de La Habana mira su celular sonriendo mientras elige qué pedir; detrás, una calle con fachadas de colores.
2. **Pedido entregado:** un repartidor en bicicleta entrega una bolsa de compras a una señora en la puerta de su casa; ambos sonríen.
3. **La tienda de barrio:** el dueño de una pequeña tienda de ropa o artesanía acomoda productos en su mostrador y toma una foto con el celular para subirla a su tienda en línea.
4. **Restaurante con QR:** en una mesa de una paladar acogedora, una pareja escanea con el celular un pequeño soporte con código QR (el código borroso, sin texto legible); platos cubanos sobre la mesa.
5. **Vender desde casa:** una emprendedora en su cocina prepara dulces caseros en cajas, listos para entregar; luz de ventana.
6. **Mercado local:** un puesto de frutas y vegetales frescos con colores vivos; un cliente paga en efectivo al recibir su pedido.

**Evitar en todas:** texto o carteles legibles, logos de otras marcas, banderas o símbolos políticos, estética de lujo o de turismo de postal, robots o brillos de "tecnología", fondos blancos de estudio.
