import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { productPriceTiersInclude } from "./products.controller.js";

// Bloque 54: "Compartir carrito" — genera un link público de un solo
// vendedor (mismo carrito de un solo vendedor que el resto del sitio) que
// cualquiera (logueado o no) puede abrir para agregarlo al suyo. A
// diferencia de CartSnapshot (que sí guarda precio/nombre, porque es del
// dueño de la cuenta y se restaura tal cual), acá NUNCA se guarda precio ni
// nombre — se resuelven contra el Product real recién al leerse (ver
// getSharedCart), así un link compartido hace tiempo nunca muestra un
// precio vencido ni deja "comprar" más de lo que hay de stock hoy.

// Los topes existen porque el endpoint es público: sin ellos cualquiera podía guardar un "carrito" de miles de líneas.
// 100 líneas y 99999 unidades quedan muy por encima de un carrito real (un producto "disponible siempre" no tiene techo
// de stock, pero sí uno de sentido común).
const createSharedCartSchema = z.object({
  vendorId: z.string().min(1).max(64),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().positive().max(99999),
        // Mismo tope que createOrder: las tallas propias del vendedor no tienen un largo fijo ("Talla única ajustable"),
        // y con uno más corto el botón Compartir fallaba con el carrito entero.
        size: z.string().max(100).optional(),
      })
    )
    .min(1, "El carrito está vacío.")
    .max(100, "El carrito tiene demasiados productos para compartirlo."),
});

// Lo que el público puede ver de un producto: los mismos filtros que la ficha (getProductBySlug) y que
// lib/publicVisibility.js. El enlace lo abre cualquiera, así que nunca debe mostrar nombre, precio, foto ni stock de algo
// pausado, suspendido por un reporte, "solo para pedidos de mesa" o fuera del cupo del plan.
const SHAREABLE_PRODUCT_WHERE = { isActive: true, hiddenFromStore: false, overQuota: false, suspendedAt: null };

const vendorIsPublic = (vendor) => !!vendor && !vendor.isBlocked && vendor.status === "ACTIVE" && !vendor.deletedAt;

// Con el menú oculto, los platos del menú de mesa solo se ven escaneando el QR (igual que en getVendorBySlug y la ficha).
const hiddenByTableMenu = (product, vendor) => product.availableForTableMenu && vendor.menuPublic === false;

export async function createSharedCart(req, res) {
  const data = createSharedCartSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendorIsPublic(vendor)) throw new AppError("Tienda no encontrada.", 404);

  const productIds = [...new Set(data.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, vendorId: true, isActive: true, hiddenFromStore: true, overQuota: true, suspendedAt: true, availableForTableMenu: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  // El carrito es siempre de una sola tienda, así que un producto de otra no sale de un carrito real: se rechaza en vez
  // de guardarlo (antes se aceptaba cualquier id y el enlace mostraba productos ajenos bajo el nombre de esta tienda).
  if (products.some((p) => p.vendorId !== data.vendorId)) {
    throw new AppError("El carrito tiene productos que no son de esta tienda.", 400);
  }
  // Lo que ya no se ve (borrado, pausado, oculto) no se guarda: quien abra el enlace tampoco podría pedirlo. Un carrito
  // puede tener algo así unos segundos, hasta que CartContext vuelve a consultar el stock.
  const isShareable = (p) =>
    !!p && p.isActive && !p.hiddenFromStore && !p.overQuota && !p.suspendedAt && !hiddenByTableMenu(p, vendor);
  const items = data.items.filter((i) => isShareable(productById.get(i.productId)));
  if (items.length === 0) throw new AppError("Ninguno de los productos de tu carrito está disponible ahora.", 400);

  const shared = await prisma.sharedCart.create({
    data: {
      vendorId: data.vendorId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, size: i.size ?? null })),
    },
  });
  res.status(201).json({ id: shared.id });
}

// Público — se resuelve SIEMPRE contra el catálogo vigente: productos
// borrados, desactivados o que el público no ve (SHAREABLE_PRODUCT_WHERE) se
// descartan, la cantidad se topea al stock actual (por talla si aplica). `droppedCount` le avisa al frontend si algo del
// carrito original ya no está disponible, para poder mostrar un aviso.
export async function getSharedCart(req, res) {
  const { id } = req.params;

  const shared = await prisma.sharedCart.findUnique({ where: { id } });
  if (!shared) throw new AppError("Este carrito compartido ya no existe.", 404);

  const vendor = await prisma.vendor.findUnique({ where: { id: shared.vendorId } });
  if (!vendorIsPublic(vendor)) throw new AppError("Esta tienda ya no está disponible.", 404);

  const productIds = [...new Set(shared.items.map((i) => i.productId))];
  // vendorId también filtra: un enlace guardado antes de que createSharedCart lo comprobara puede traer ids de otra tienda.
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, vendorId: shared.vendorId, ...SHAREABLE_PRODUCT_WHERE },
    include: productPriceTiersInclude,
  });
  const productById = Object.fromEntries(products.filter((p) => !hiddenByTableMenu(p, vendor)).map((p) => [p.id, p]));

  // Bloque 55: se manda `priceTiers` tal cual (no un precio ya resuelto) —
  // así el carrito de quien recibe el link sigue recalculando el precio por
  // unidad si más adelante cambia la cantidad, igual que cualquier ítem
  // agregado normalmente desde la ficha de producto.
  const items = shared.items
    .map((i) => {
      const product = productById[i.productId];
      if (!product) return null;
      // Una talla que la tienda quitó (o un producto que ahora pide talla) no se podría pedir: placeOrder la rechaza.
      const hasSizes = product.sizes?.length > 0;
      if (hasSizes && !product.sizes.includes(i.size)) return null;
      const size = hasSizes ? i.size : null;
      // "Disponible siempre" no tiene techo: se respeta la cantidad compartida y `stock: null` es el centinela que
      // CartContext.resolveStockCap entiende como "sin límite" (igual que placeOrder, que no le mira el stock). Antes se
      // trataba como uno con stock y, con stock 0, el enlace decía que ya no estaba disponible.
      const unlimited = !!product.unlimitedStock;
      const availableStock = unlimited ? null : size ? Number(product.sizeStock?.[size] ?? 0) : product.stock;
      if (!unlimited && availableStock <= 0) return null;
      return {
        productId: product.id,
        name: product.name,
        image: product.images?.[0] ?? null,
        // Bloque 147: hace falta para que el carrito (CartDrawer.jsx/
        // Cart.jsx) pueda linkear este ítem a su ficha real una vez
        // importado — mismo campo que ya usan todos los demás puntos de
        // entrada al carrito.
        slug: product.slug,
        price: product.price,
        priceTiers: product.priceTiers,
        currency: product.currency,
        size,
        quantity: unlimited ? i.quantity : Math.min(i.quantity, availableStock),
        stock: availableStock,
      };
    })
    .filter(Boolean);

  res.json({
    vendor: {
      id: vendor.id,
      slug: vendor.slug,
      companyName: vendor.companyName,
      color: vendor.color,
      isVerified: vendor.verificationStatus === "VERIFIED",
      whatsapp: vendor.whatsapp,
    },
    items,
    droppedCount: shared.items.length - items.length,
  });
}
