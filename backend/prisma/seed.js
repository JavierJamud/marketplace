// ============================================================================
// Seed: carga cuba-seed-data.js (raíz del proyecto de diseño) en Postgres.
// Ejecutar con: npm run prisma:seed
// ============================================================================
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedData } from "../../cuba-seed-data.js";
import { encryptSecret } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

// Password de prueba compartida por TODAS las cuentas sembradas (dueños de
// tienda y clientes). Solo para desarrollo — nunca usar en producción.
const DEV_PASSWORD = "Zeudin2026!";

function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const devPasswordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // --- País (Cuba) ------------------------------------------------------------
  // Fix (AUDITORIA.md, Crítico #2): sin ningún país cargado, ninguna
  // provincia puede tener countryId poblado, y el checkout no puede resolver
  // "Provincia / Estado" para direcciones cubanas. En producción esto se
  // carga a mano desde /admin/ubicaciones (dato real de negocio, no algo que
  // el seed deba decidir) — acá solo se asegura que el entorno de desarrollo
  // arranque completo, sin el mismo hueco.
  console.log("Sembrando país (Cuba)...");
  const cuba = await prisma.country.upsert({
    where: { code: "CU" },
    update: { name: "Cuba" },
    create: { code: "CU", name: "Cuba" },
  });

  // --- Provincias -----------------------------------------------------------
  console.log("Sembrando provincias...");
  const provinceIdByCode = {};
  for (const p of seedData.provinces) {
    const province = await prisma.province.upsert({
      where: { code: p.code },
      update: { name: p.name, countryId: cuba.id },
      create: { code: p.code, name: p.name, countryId: cuba.id },
    });
    provinceIdByCode[p.code] = province.id;
  }

  // --- Municipios (muestra por provincia) ------------------------------------
  console.log("Sembrando municipios...");
  const municipalityIdByProvinceAndName = {};
  for (const [code, names] of Object.entries(seedData.municipalities)) {
    const provinceId = provinceIdByCode[code];
    if (!provinceId) continue;
    for (const name of names) {
      const muni = await prisma.municipality.upsert({
        where: { provinceId_name: { provinceId, name } },
        update: {},
        create: { provinceId, name },
      });
      municipalityIdByProvinceAndName[`${code}:${name}`] = muni.id;
    }
  }

  // --- Adyacencias entre provincias ------------------------------------------
  console.log("Sembrando adyacencias entre provincias...");
  for (const [code, neighbors] of Object.entries(seedData.provinceAdjacency)) {
    const provinceAId = provinceIdByCode[code];
    if (!provinceAId) continue;
    for (const neighborCode of neighbors) {
      const provinceBId = provinceIdByCode[neighborCode];
      if (!provinceBId) continue;
      await prisma.provinceAdjacency.upsert({
        where: { provinceAId_provinceBId: { provinceAId, provinceBId } },
        update: {},
        create: { provinceAId, provinceBId },
      });
    }
  }

  // --- Categorías --------------------------------------------------------
  console.log("Sembrando categorías...");
  const categoryIdBySlug = {};
  for (const c of seedData.categories) {
    const category = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { slug: c.slug, name: c.name },
    });
    categoryIdBySlug[c.slug] = category.id;
  }

  // --- Categorías de tipo de negocio (Bloque 18) -----------------------------
  console.log("Sembrando categorías de tipo de negocio...");
  const businessCategoryIdBySlug = {};
  for (const [i, c] of seedData.businessCategories.entries()) {
    const businessCategory = await prisma.businessCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, icon: c.icon, sortOrder: i },
      create: { slug: c.slug, name: c.name, icon: c.icon, sortOrder: i },
    });
    businessCategoryIdBySlug[c.slug] = businessCategory.id;
  }

  // Subcategorías de menú de restaurante (hijas de "restaurante"), derivadas
  // directamente de restaurantMenu[].category — sin inventar nombres nuevos.
  const restauranteCategoryId = categoryIdBySlug["restaurante"];
  const menuCategoryIdByName = {};
  if (restauranteCategoryId) {
    const menuCategoryNames = [...new Set(seedData.restaurantMenu.map((m) => m.category))];
    for (const name of menuCategoryNames) {
      const slug = `restaurante-${slugify(name)}`;
      const category = await prisma.category.upsert({
        where: { slug },
        update: { name, parentId: restauranteCategoryId },
        create: { slug, name, parentId: restauranteCategoryId },
      });
      menuCategoryIdByName[name] = category.id;
    }
  }

  // --- Vendedores (tiendas) + dueños (KYC) -----------------------------------
  console.log("Sembrando vendedores y sus dueños...");
  const vendorIdBySlug = {};
  for (const v of seedData.vendors) {
    const owner = await prisma.user.upsert({
      where: { email: v.owner.email },
      update: { fullName: v.owner.fullName, phone: v.owner.phone, role: "VENDOR", country: v.owner.country ?? "CU" },
      create: {
        email: v.owner.email,
        passwordHash: devPasswordHash,
        fullName: v.owner.fullName,
        phone: v.owner.phone,
        role: "VENDOR",
        country: v.owner.country ?? "CU",
      },
    });

    const municipalityId = municipalityIdByProvinceAndName[`${v.province}:${v.municipality}`] ?? null;

    const vendor = await prisma.vendor.upsert({
      where: { slug: v.slug },
      update: {
        companyName: v.companyName,
        ownerName: v.owner.fullName,
        description: v.description,
        whatsapp: v.whatsapp,
        isRestaurant: v.isRestaurant,
        tableCount: v.tables ?? null,
        planType: v.plan === "business" ? "BUSINESS" : "REGULAR",
        // Fix: Vendor.isVerified se eliminó en el bloque 64 (ahora
        // verificationStatus es la única fuente de verdad).
        verificationStatus: v.verified ? "VERIFIED" : "NOT_STARTED",
        isBlocked: v.blocked ?? false,
        timezone: v.timezone,
        categoryId: categoryIdBySlug[v.categorySlug] ?? null,
        // Bloque 53 (gap real encontrado al ampliar el seed): businessCategoryId
        // nunca se sembraba — sin esto, ninguna tienda de prueba aparecía al
        // filtrar por el marquee "Explorá por categoría" del Home.
        businessCategoryId: businessCategoryIdBySlug[v.businessCategorySlug] ?? null,
        color: v.color ?? null,
        salesCount: v.salesCount ?? 0,
        orderDestination: v.orderDestination === "panel" ? "PANEL" : "WHATSAPP",
        acceptedPaymentMethods: v.paymentMethods ?? [],
      },
      create: {
        userId: owner.id,
        companyName: v.companyName,
        ownerName: v.owner.fullName,
        slug: v.slug,
        description: v.description,
        whatsapp: v.whatsapp,
        isRestaurant: v.isRestaurant,
        tableCount: v.tables ?? null,
        planType: v.plan === "business" ? "BUSINESS" : "REGULAR",
        verificationStatus: v.verified ? "VERIFIED" : "NOT_STARTED",
        isBlocked: v.blocked ?? false,
        timezone: v.timezone,
        categoryId: categoryIdBySlug[v.categorySlug] ?? null,
        businessCategoryId: businessCategoryIdBySlug[v.businessCategorySlug] ?? null,
        color: v.color ?? null,
        salesCount: v.salesCount ?? 0,
        orderDestination: v.orderDestination === "panel" ? "PANEL" : "WHATSAPP",
        acceptedPaymentMethods: v.paymentMethods ?? [],
        locations: {
          create: [{ provinceId: provinceIdByCode[v.province], municipalityId }],
        },
      },
    });
    vendorIdBySlug[v.slug] = vendor.id;

    // Mesas + QR para restaurantes
    if (v.isRestaurant && v.tables) {
      for (let n = 1; n <= v.tables; n++) {
        await prisma.table.upsert({
          where: { vendorId_tableNumber: { vendorId: vendor.id, tableNumber: n } },
          update: {},
          create: { vendorId: vendor.id, tableNumber: n },
        });
      }
    }

    // Horario semanal (para calcular "abierto ahora" en Store.jsx). Bloque 53:
    // closedAllWeek (boutique-guantanamo) usa closedWeeklySchedule en vez del
    // horario normal — para probar el estado "cerrado ahora" sin depender de
    // en qué día/hora corra el seed.
    const schedule = v.closedAllWeek ? seedData.closedWeeklySchedule : seedData.defaultWeeklySchedule;
    for (const day of schedule) {
      await prisma.vendorSchedule.upsert({
        where: { vendorId_dayOfWeek: { vendorId: vendor.id, dayOfWeek: day.dayOfWeek } },
        update: { opensAt: day.opensAt, closesAt: day.closesAt, isClosed: day.isClosed },
        create: { vendorId: vendor.id, dayOfWeek: day.dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt, isClosed: day.isClosed },
      });
    }
  }

  // --- Productos ---------------------------------------------------------
  console.log("Sembrando productos...");
  for (const p of seedData.products) {
    const vendorId = vendorIdBySlug[p.vendorSlug];
    if (!vendorId) continue;
    // Bloque 53 (pedido explícito): imágenes SOLO referenciales — picsum con
    // semilla estable por slug de producto, nunca la foto real del artículo.
    // Solo se sacan al reseedear si el producto no tiene ya imágenes reales
    // subidas/enlazadas por el vendedor (ver "update" abajo).
    const images = seedData.imgSeed(p.slug);
    const existingProduct = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId, slug: p.slug } }, select: { images: true } });
    await prisma.product.upsert({
      where: { vendorId_slug: { vendorId, slug: p.slug } },
      update: {
        name: p.name,
        price: p.price,
        oldPrice: p.oldPrice ?? null,
        stock: p.stock,
        barcode: p.barcode,
        paymentMethods: p.paymentMethods,
        categoryId: categoryIdBySlug[p.categorySlug] ?? null,
        isFeatured: p.isFeatured ?? false,
        badge: p.badge ?? null,
        // Re-seedear nunca pisa imágenes reales que un vendedor ya haya
        // subido/enlazado a mano — solo rellena si el producto sigue sin
        // ninguna (recién creado, o nunca se le cargó nada).
        images: existingProduct?.images?.length ? undefined : images,
      },
      create: {
        vendorId,
        categoryId: categoryIdBySlug[p.categorySlug] ?? null,
        name: p.name,
        slug: p.slug,
        price: p.price,
        oldPrice: p.oldPrice ?? null,
        stock: p.stock,
        barcode: p.barcode,
        paymentMethods: p.paymentMethods,
        isFeatured: p.isFeatured ?? false,
        badge: p.badge ?? null,
        images,
      },
    });
  }

  // --- Menú del restaurante (productos con variantes) -------------------
  console.log("Sembrando menú de restaurante...");
  for (const item of seedData.restaurantMenu) {
    const vendorId = vendorIdBySlug[item.vendorSlug];
    if (!vendorId) continue;
    const slug = slugify(item.name);

    const existing = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId, slug } } });
    const product = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: {
            name: item.name,
            price: item.price,
            categoryId: menuCategoryIdByName[item.category] ?? null,
            isFeatured: item.isFeatured ?? false,
            badge: item.badge ?? null,
          },
        })
      : await prisma.product.create({
          data: {
            vendorId,
            categoryId: menuCategoryIdByName[item.category] ?? null,
            name: item.name,
            isFeatured: item.isFeatured ?? false,
            badge: item.badge ?? null,
            slug,
            price: item.price,
            paymentMethods: ["table"],
          },
        });

    // Reemplaza variantes existentes por las del dataset (idempotente)
    await prisma.productOption.deleteMany({ where: { productId: product.id } });
    for (const opt of item.options ?? []) {
      await prisma.productOption.create({ data: { productId: product.id, name: opt.name, values: opt.values } });
    }
  }

  // --- Clientes ------------------------------------------------------------
  console.log("Sembrando clientes...");
  const userIdByEmail = {};
  for (const c of seedData.customers) {
    const provinceId = provinceIdByCode[c.province] ?? null;
    const user = await prisma.user.upsert({
      where: { email: c.email },
      update: { fullName: c.fullName, phone: c.phone, provinceId, country: c.country ?? "CU" },
      create: { email: c.email, passwordHash: devPasswordHash, fullName: c.fullName, phone: c.phone, role: "CUSTOMER", provinceId, country: c.country ?? "CU" },
    });
    userIdByEmail[c.email] = user.id;
  }

  // --- Admin ------------------------------------------------------------
  console.log("Sembrando usuario admin...");
  if (seedData.adminUser) {
    await prisma.user.upsert({
      where: { email: seedData.adminUser.email },
      update: { fullName: seedData.adminUser.fullName, phone: seedData.adminUser.phone, role: "ADMIN" },
      create: {
        email: seedData.adminUser.email,
        passwordHash: devPasswordHash,
        fullName: seedData.adminUser.fullName,
        phone: seedData.adminUser.phone,
        role: "ADMIN",
      },
    });
  }

  // --- Pedidos ---------------------------------------------------------------
  console.log("Sembrando pedidos...");
  const statusMap = { new: "NEW", preparing: "PREPARING", ready: "READY", delivered: "DELIVERED", cancelled: "CANCELLED" };
  // Bloque 14: mismo mapeo que aplicó la migración de datos sobre pedidos ya
  // existentes (whatsapp->CASH, transfer->ONLINE) — así un reseed desde cero
  // en una DB nueva llega al mismo estado final que "datos viejos + migración".
  const channelMap = { whatsapp: "CASH", cod: "COD", transfer: "ONLINE", table: "TABLE" };
  // Snapshot histórico: cada pedido de prueba refleja el orderDestination que
  // su tienda tenía configurado (no siempre WhatsApp — TecnoHabana usa Panel).
  const orderDestinationBySlug = Object.fromEntries(
    seedData.vendors.map((v) => [v.slug, v.orderDestination === "panel" ? "PANEL" : "WHATSAPP"])
  );
  for (const o of seedData.orders) {
    const vendorId = vendorIdBySlug[o.vendorSlug];
    const customerId = userIdByEmail[o.customerEmail] ?? null;
    if (!vendorId) continue;
    const customer = seedData.customers.find((c) => c.email === o.customerEmail);
    const notificationChannel = orderDestinationBySlug[o.vendorSlug] ?? "WHATSAPP";
    const order = await prisma.order.upsert({
      where: { code: o.code },
      update: { status: statusMap[o.status] ?? "NEW", total: o.total, notificationChannel, customerEmail: customer?.email },
      create: {
        code: o.code,
        vendorId,
        customerId,
        customerName: customer?.fullName,
        customerPhone: customer?.phone,
        customerEmail: customer?.email,
        total: o.total,
        status: statusMap[o.status] ?? "NEW",
        channel: channelMap[o.channel] ?? "WHATSAPP",
        notificationChannel,
        tableNumber: o.tableNumber ?? null,
      },
    });

    // OrderItem reales (Bloque 12) — el precio se resuelve del producto en
    // DB al sembrar, nunca inventado, igual que hace el endpoint real de
    // creación de pedidos. Reemplaza los ítems existentes (idempotente).
    if (o.items?.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      for (const it of o.items) {
        const product = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId, slug: it.productSlug } } });
        if (!product) continue;
        await prisma.orderItem.create({
          data: { orderId: order.id, productId: product.id, name: product.name, price: product.price, quantity: it.quantity },
        });
      }
    }
  }

  // --- Historial de emails manuales (para probar el límite del Plan Regular) -
  console.log("Sembrando historial de emails manuales...");
  await prisma.emailLog.deleteMany({ where: { type: "MANUAL" } });
  const modaCaribeOrder = await prisma.order.findUnique({ where: { code: "Z-2046" } });
  if (modaCaribeOrder) {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      vendorId: vendorIdBySlug["moda-caribe"],
      orderId: modaCaribeOrder.id,
      type: "MANUAL",
      to: modaCaribeOrder.customerEmail ?? "yanet@correo.cu",
      subject: `Sobre tu pedido ${modaCaribeOrder.code} — consulta ${i + 1}`,
      status: "SENT",
      createdAt: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000),
    }));
    await prisma.emailLog.createMany({ data: rows });
  }

  // --- Reseñas / comentarios ------------------------------------------------
  // Con productSlug: reseña con estrellas (Product.jsx). Sin productSlug:
  // comentario público sin rating (Store.jsx "Comentarios de compradores").
  console.log("Sembrando reseñas y comentarios...");
  await prisma.review.deleteMany({});
  for (const r of seedData.reviews ?? []) {
    const vendorId = vendorIdBySlug[r.vendorSlug];
    if (!vendorId) continue;
    let productId = null;
    if (r.productSlug) {
      const product = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId, slug: r.productSlug } } });
      productId = product?.id ?? null;
    }
    const createdAt = new Date(Date.now() - (r.daysAgo ?? 0) * 24 * 60 * 60 * 1000);
    await prisma.review.create({
      data: {
        vendorId,
        productId,
        authorName: r.authorName,
        rating: r.rating ?? null,
        comment: r.comment,
        createdAt,
      },
    });
  }

  // Recalcula Vendor.rating como promedio real de sus reseñas con estrellas
  // (no un número fijo copiado del mockup).
  console.log("Recalculando rating promedio por vendedor...");
  for (const slug of Object.keys(vendorIdBySlug)) {
    const vendorId = vendorIdBySlug[slug];
    const agg = await prisma.review.aggregate({ where: { vendorId, rating: { not: null } }, _avg: { rating: true } });
    const avg = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
    await prisma.vendor.update({ where: { id: vendorId }, data: { rating: avg } });
  }

  // --- Verificaciones KYC ------------------------------------------------
  // Fix: VerificationRequest.status se eliminó en el bloque 64 (ahora
  // Vendor.verificationStatus es la única fuente de verdad, seteada arriba
  // al sembrar cada vendedor). Este registro solo guarda notas/documentos.
  console.log("Sembrando solicitudes de verificación...");
  for (const v of seedData.verifications) {
    const vendorId = vendorIdBySlug[v.vendorSlug];
    if (!vendorId) continue;
    await prisma.verificationRequest.upsert({
      where: { vendorId },
      update: { notes: v.notes ?? null },
      create: { vendorId, notes: v.notes ?? null },
    });
  }

  // --- Sugerencias (buzón vendedor/cliente -> admin) ----------------------
  console.log("Sembrando sugerencias de ejemplo...");
  const suggestionStatusMap = { new: "NEW", reviewed: "REVIEWED" };
  for (const s of seedData.suggestions ?? []) {
    // authorEmail puede ser un cliente (userIdByEmail) o el dueño de una
    // tienda (no está en ese mapa, que solo cubre clientes) — se resuelve
    // directo contra User por si acaso.
    const author = userIdByEmail[s.authorEmail] ? { id: userIdByEmail[s.authorEmail] } : await prisma.user.findUnique({ where: { email: s.authorEmail } });
    if (!author) continue;
    const existing = await prisma.suggestion.findFirst({ where: { authorId: author.id, message: s.message } });
    if (existing) continue;
    await prisma.suggestion.create({
      data: {
        authorId: author.id,
        authorType: s.authorType === "vendor" ? "VENDOR" : "CUSTOMER",
        message: s.message,
        status: suggestionStatusMap[s.status] ?? "NEW",
      },
    });
  }

  // --- Campañas (histórico de ejemplo) ------------------------------------
  console.log("Sembrando histórico de campañas...");
  for (const c of seedData.campaignHistory ?? []) {
    const existing = await prisma.campaign.findFirst({ where: { subject: c.subject } });
    if (existing) continue;
    await prisma.campaign.create({
      data: {
        title: c.subject,
        subject: c.subject,
        segment: c.segment,
        status: "SENT",
        sentCount: c.sentCount,
        openCount: c.openCount,
        createdAt: new Date(Date.now() - c.daysAgo * 24 * 60 * 60 * 1000),
        sentAt: new Date(Date.now() - c.daysAgo * 24 * 60 * 60 * 1000),
      },
    });
  }

  // --- Integraciones (claves cifradas) ------------------------------------
  console.log("Sembrando integraciones (cifradas)...");
  for (const s of seedData.integrationSeeds ?? []) {
    const enc = encryptSecret(s.credential);
    await prisma.integration.upsert({
      where: { name: s.name },
      update: { credentialsCiphertext: enc.ciphertext, credentialsIv: enc.iv, credentialsAuthTag: enc.authTag, isActive: s.isActive },
      create: { name: s.name, credentialsCiphertext: enc.ciphertext, credentialsIv: enc.iv, credentialsAuthTag: enc.authTag, isActive: s.isActive },
    });
  }

  console.log(`\nListo. Password de prueba para TODAS las cuentas sembradas: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
