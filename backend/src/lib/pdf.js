import PDFDocument from "pdfkit";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { env } from "../config/env.js";
import { ORDER_EVENT_LABEL } from "./orderEvents.js";

// Facturas y certificados de garantía en PDF. pdfkit dibuja el documento a mano (sin motor de navegador).
//
// Qué lleva cada documento:
//  - Datos de la EMPRESA (nombre comercial, dirección, contacto y enlace a su tienda). Nunca los datos privados de quien la
//    dirige (nombre ni identificación del responsable).
//  - Datos del cliente (titular de la compra o de la garantía).
//  - Registro del pedido con fecha y hora de cada movimiento (recibido, confirmado, entregado, documentos enviados).
//  - Productos con su detalle, enlaces a la tienda y al sitio, numeración de páginas y marca de agua en cada hoja.

const MARGIN = 50;
const BOTTOM_MARGIN = 64;
const INK = "#1b1b1d";
const MUTED = "#6b6e73";
const LINE = "#e3e4e6";
const SOFT = "#f4f5f6";

const tz = "America/Havana";

function fmtMoney(n, currency = "CUP") {
  return `${Number(n).toLocaleString("es-CU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-CU", { year: "numeric", month: "long", day: "numeric", timeZone: tz });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("es-CU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: tz });
}

function optionsText(selected) {
  if (!selected) return "";
  try {
    if (Array.isArray(selected)) {
      return selected
        .map((o) => (typeof o === "string" ? o : o?.name ? `${o.name}: ${Array.isArray(o.values) ? o.values.join(", ") : (o.value ?? o.values ?? "")}` : ""))
        .filter(Boolean)
        .join(" · ");
    }
    if (typeof selected === "object") return Object.entries(selected).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ");
  } catch {
    /* sin detalle */
  }
  return "";
}

function storeUrl(vendor) {
  return `${env.frontendUrl.replace(/\/$/, "")}/tienda/${vendor.slug}`;
}
function siteUrl() {
  return env.frontendUrl.replace(/\/$/, "");
}

function renderToBuffer(draw) {
  const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: BOTTOM_MARGIN }, bufferPages: true });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  draw(doc);
  doc.end();
  return done;
}

const contentWidth = (doc) => doc.page.width - MARGIN * 2;
const bottomLimit = (doc) => doc.page.height - BOTTOM_MARGIN - 6;

// Pasa a una hoja nueva si lo que sigue no entra. En las hojas siguientes va una banda delgada con el nombre y el número.
function ensureSpace(doc, height, ctx) {
  if (doc.y + height <= bottomLimit(doc)) return;
  doc.addPage();
  drawSlimHeader(doc, ctx);
}

function drawSlimHeader(doc, { vendor, title, code }) {
  const color = vendor.color || "#232F3E";
  doc.rect(0, 0, doc.page.width, 34).fill(color);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(vendor.companyName, MARGIN, 12, { width: contentWidth(doc) * 0.6, lineBreak: false });
  doc.font("Helvetica").fontSize(9).text(`${title} · N.º ${code}`, MARGIN, 12, { width: contentWidth(doc), align: "right", lineBreak: false });
  doc.fillColor(INK);
  doc.y = 54;
}

function drawHeader(doc, { vendor, title, code, date, siteName }) {
  const color = vendor.color || "#232F3E";
  const w = doc.page.width;
  doc.rect(0, 0, w, 96).fill(color);

  doc.circle(MARGIN + 22, 48, 22).fill("#ffffff");
  doc.fillColor(color).font("Helvetica-Bold").fontSize(21).text((vendor.companyName[0] ?? "?").toUpperCase(), MARGIN, 37, { width: 44, align: "center", lineBreak: false });

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text(vendor.companyName, MARGIN + 58, 31, { width: w - MARGIN * 2 - 58 - 200, lineBreak: false, ellipsis: true });
  doc.font("Helvetica").fontSize(9).text(`Tienda en ${siteName}`, MARGIN + 58, 53, { lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(13).text(title, w - MARGIN - 200, 30, { width: 200, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(9).text(`N.º ${code}`, w - MARGIN - 200, 50, { width: 200, align: "right", lineBreak: false });
  doc.text(`Emitido: ${fmtDateTime(date)}`, w - MARGIN - 200, 63, { width: 200, align: "right", lineBreak: false });

  doc.fillColor(INK);
  doc.y = 118;
}

function sectionTitle(doc, text, ctx) {
  ensureSpace(doc, 40, ctx);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED).text(text.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.6 });
  const y = doc.y + 3;
  doc.strokeColor(LINE).lineWidth(0.8).moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).stroke();
  doc.y = y + 8;
  doc.fillColor(INK);
}

// Bloque de pares "Etiqueta: valor" en una columna. Devuelve la altura que ocupó.
function drawFacts(doc, rows, x, y, width) {
  let cy = y;
  for (const [label, value, link] of rows.filter((r) => r[1])) {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(label, x, cy, { width });
    cy = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(link ? "#1a5d8f" : INK).text(String(value), x, cy, { width, link: link || undefined, underline: !!link });
    cy = doc.y + 5;
  }
  return cy - y;
}

function twoColumns(doc, left, right, ctx) {
  const colW = (contentWidth(doc) - 24) / 2;
  const estimate = Math.max(left.rows.length, right.rows.length) * 30 + 24;
  ensureSpace(doc, Math.min(estimate, 220), ctx);
  const startY = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED).text(left.title.toUpperCase(), MARGIN, startY, { width: colW, characterSpacing: 0.6 });
  doc.text(right.title.toUpperCase(), MARGIN + colW + 24, startY, { width: colW, characterSpacing: 0.6 });
  const lineY = startY + 14;
  doc.strokeColor(LINE).lineWidth(0.8).moveTo(MARGIN, lineY).lineTo(MARGIN + colW, lineY).stroke();
  doc.moveTo(MARGIN + colW + 24, lineY).lineTo(MARGIN + colW * 2 + 24, lineY).stroke();
  const hl = drawFacts(doc, left.rows, MARGIN, lineY + 8, colW);
  const hr = drawFacts(doc, right.rows, MARGIN + colW + 24, lineY + 8, colW);
  doc.y = lineY + 8 + Math.max(hl, hr) + 8;
  doc.fillColor(INK);
}

function companyRows(vendor, province) {
  return [
    ["Nombre comercial", vendor.companyName],
    ["Identificación fiscal", vendor.companyTaxId],
    ["Dirección", vendor.companyAddress],
    ["Teléfono / WhatsApp", vendor.whatsapp],
    ["Correo", vendor.email],
    ["Tienda en línea", storeUrl(vendor), storeUrl(vendor)],
  ];
}

function drawItemsTable(doc, items, ctx, { discount } = {}) {
  const tableW = contentWidth(doc);
  const cols = { name: tableW * 0.48, qty: tableW * 0.1, price: tableW * 0.21, subtotal: tableW * 0.21 };
  const header = () => {
    const y = doc.y;
    doc.rect(MARGIN, y, tableW, 22).fill(SOFT);
    doc.fillColor("#333333").font("Helvetica-Bold").fontSize(9);
    let x = MARGIN + 8;
    doc.text("Producto", x, y + 7, { width: cols.name - 8, lineBreak: false });
    x += cols.name;
    doc.text("Cant.", x, y + 7, { width: cols.qty - 8, align: "right", lineBreak: false });
    x += cols.qty;
    doc.text("Precio unit.", x, y + 7, { width: cols.price - 8, align: "right", lineBreak: false });
    x += cols.price;
    doc.text("Subtotal", x, y + 7, { width: cols.subtotal - 12, align: "right", lineBreak: false });
    doc.y = y + 22;
  };
  ensureSpace(doc, 60, ctx);
  header();

  const totals = new Map();
  for (const item of items) {
    const currency = item.currency ?? "CUP";
    const subtotal = Number(item.price) * item.quantity;
    totals.set(currency, (totals.get(currency) ?? 0) + subtotal);
    const detail = [item.size ? `Talla: ${item.size}` : null, optionsText(item.selectedOptions) || null].filter(Boolean).join(" · ");
    doc.font("Helvetica-Bold").fontSize(10);
    const nameH = doc.heightOfString(item.name, { width: cols.name - 8 });
    doc.font("Helvetica").fontSize(8.5);
    const detailH = detail ? doc.heightOfString(detail, { width: cols.name - 8 }) : 0;
    const rowH = Math.max(24, nameH + detailH + 12);
    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      drawSlimHeader(doc, ctx);
      header();
    }
    const y = doc.y;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(item.name, MARGIN + 8, y + 6, { width: cols.name - 8 });
    if (detail) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(detail, MARGIN + 8, y + 6 + nameH, { width: cols.name - 8 });
    doc.fillColor(INK).font("Helvetica").fontSize(10);
    let x = MARGIN + cols.name;
    doc.text(String(item.quantity), x, y + 6, { width: cols.qty - 8, align: "right", lineBreak: false });
    x += cols.qty;
    doc.text(fmtMoney(item.price, currency), x, y + 6, { width: cols.price - 8, align: "right", lineBreak: false });
    x += cols.price;
    doc.text(fmtMoney(subtotal, currency), x, y + 6, { width: cols.subtotal - 12, align: "right", lineBreak: false });
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(MARGIN, y + rowH).lineTo(MARGIN + tableW, y + rowH).stroke();
    doc.y = y + rowH;
  }

  const units = items.reduce((s, i) => s + i.quantity, 0);
  ensureSpace(doc, 24 + totals.size * 18 + (discount ? 18 : 0), ctx);
  doc.y += 8;
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${items.length} ${items.length === 1 ? "producto" : "productos"} · ${units} ${units === 1 ? "unidad" : "unidades"}`, MARGIN, doc.y, { width: tableW * 0.5, lineBreak: false });
  let ty = doc.y;
  if (discount && Number(discount.amount) > 0 && totals.size === 1) {
    const [cur] = [...totals.keys()];
    doc.font("Helvetica").fontSize(10).fillColor("#2a7a4b").text(`Descuento${discount.code ? ` (${discount.code})` : ""}: -${fmtMoney(discount.amount, cur)}`, MARGIN + tableW * 0.45, ty, { width: tableW * 0.55, align: "right", lineBreak: false });
    ty += 16;
  }
  for (const [cur, sum] of totals) {
    const final = discount && totals.size === 1 ? Math.max(0, sum - Number(discount.amount ?? 0)) : sum;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(`TOTAL ${fmtMoney(final, cur)}`, MARGIN + tableW * 0.45, ty, { width: tableW * 0.55, align: "right", lineBreak: false });
    ty += 18;
  }
  doc.y = ty + 8;
}

function drawTimeline(doc, events, ctx) {
  sectionTitle(doc, "Registro del pedido (fecha y hora)", ctx);
  const tableW = contentWidth(doc);
  const cols = { when: tableW * 0.27, what: tableW * 0.4, detail: tableW * 0.33 };
  for (const ev of events) {
    const label = ORDER_EVENT_LABEL[ev.type] ?? ev.type;
    doc.font("Helvetica").fontSize(9.5);
    const detailH = ev.detail ? doc.heightOfString(ev.detail, { width: cols.detail - 6 }) : 0;
    const rowH = Math.max(20, detailH + 10);
    ensureSpace(doc, rowH, ctx);
    const y = doc.y;
    doc.fillColor(MUTED).font("Helvetica").fontSize(9.5).text(fmtDateTime(ev.createdAt), MARGIN, y + 5, { width: cols.when - 6 });
    doc.fillColor(INK).font("Helvetica-Bold").text(label, MARGIN + cols.when, y + 5, { width: cols.what - 6 });
    if (ev.detail) doc.fillColor(MUTED).font("Helvetica").text(ev.detail, MARGIN + cols.when + cols.what, y + 5, { width: cols.detail - 6 });
    doc.strokeColor(LINE).lineWidth(0.5).moveTo(MARGIN, y + rowH).lineTo(MARGIN + tableW, y + rowH).stroke();
    doc.y = y + rowH;
  }
  doc.y += 10;
  doc.fillColor(INK);
}

// Marca de agua y pie en cada hoja, una vez que se sabe cuántas hojas son.
function finishPages(doc, { vendor, siteName, code }) {
  const range = doc.bufferedPageRange();
  const color = vendor.color || "#232F3E";
  const link = storeUrl(vendor);
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const w = doc.page.width;
    const h = doc.page.height;

    doc.save();
    doc.rotate(-35, { origin: [w / 2, h / 2] });
    doc.fillColor(color).fillOpacity(0.055);
    const name = vendor.companyName.toUpperCase();
    doc.font("Helvetica-Bold").fontSize(Math.max(26, Math.min(66, 760 / Math.max(8, name.length)))).text(name, 0, h / 2 - 34, { width: w, align: "center", lineBreak: false });
    doc.fontSize(20).text(`${siteName.toUpperCase()} · DOCUMENTO N.º ${code}`, 0, h / 2 + 22, { width: w, align: "center", lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);

    // El pie vive dentro del margen inferior: se desactiva un momento para que pdfkit no agregue una hoja más.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = h - 44;
    doc.strokeColor(LINE).lineWidth(0.6).moveTo(MARGIN, y - 6).lineTo(w - MARGIN, y - 6).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(`Documento generado por ${siteName} el ${fmtDateTime(new Date())}`, MARGIN, y, { width: w - MARGIN * 2, align: "left", lineBreak: false });
    doc.fillColor("#1a5d8f").text(link.replace(/^https?:\/\//, ""), MARGIN, y + 11, { width: (w - MARGIN * 2) * 0.6, align: "left", lineBreak: false, link, underline: true });
    doc.text(siteUrl().replace(/^https?:\/\//, ""), MARGIN, y + 11, { width: w - MARGIN * 2, align: "center", lineBreak: false, link: siteUrl(), underline: true });
    doc.fillColor(MUTED).text(`Página ${i + 1} de ${range.count}`, MARGIN, y + 11, { width: w - MARGIN * 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

// Si el pedido todavía no tiene movimientos guardados (pedidos anteriores), se arma el mínimo con la fecha de creación.
function withBaseEvents(order, events) {
  const list = [...(events ?? [])];
  if (!list.some((e) => e.type === "CREATED")) list.push({ type: "CREATED", createdAt: order.createdAt, detail: null });
  return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const CHANNEL_LABEL = { COD: "Pago contra entrega", ONLINE: "Pago en línea con la tienda", CASH: "Efectivo", TABLE: "Pedido de mesa" };
const STATUS_LABEL = { NEW: "Recibido", PREPARING: "En preparación", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Cancelado" };

function orderRows(order, province, deliveredAt) {
  return [
    ["Número de pedido", order.code],
    ["Fecha del pedido", fmtDateTime(order.createdAt)],
    ["Estado actual", STATUS_LABEL[order.status] ?? order.status],
    ["Entregado", deliveredAt ? fmtDateTime(deliveredAt) : order.status === "DELIVERED" ? "Entregado (sin hora registrada)" : "Aún sin entregar"],
    ["Forma de pago", CHANNEL_LABEL[order.channel] ?? null],
    ["Lugar de entrega", [order.shippingAddress, province?.name].filter(Boolean).join(", ") || null],
  ];
}

// customer: { name, idNumber, phone, email }
export async function generateInvoicePdf({ vendor, order, items, customer, events, province }) {
  const { siteName } = await getBrandSettings();
  const ctx = { vendor, title: "FACTURA", code: order.code };
  const timeline = withBaseEvents(order, events);
  const deliveredAt = timeline.find((e) => e.type === "DELIVERED")?.createdAt;
  return renderToBuffer((doc) => {
    drawHeader(doc, { vendor, title: "FACTURA DE COMPRA", code: order.code, date: new Date(), siteName });

    twoColumns(
      doc,
      { title: "Datos de la empresa", rows: companyRows(vendor, province) },
      {
        title: "Datos del cliente",
        rows: [
          ["Nombre", customer.name],
          ["Identificación", customer.idNumber],
          ["Teléfono", customer.phone],
          ["Correo", customer.email],
        ],
      },
      ctx
    );

    sectionTitle(doc, "Datos del pedido", ctx);
    const colW = (contentWidth(doc) - 24) / 2;
    const rows = orderRows(order, province, deliveredAt).filter((r) => r[1]);
    const half = Math.ceil(rows.length / 2);
    ensureSpace(doc, half * 30 + 10, ctx);
    const y0 = doc.y;
    const h1 = drawFacts(doc, rows.slice(0, half), MARGIN, y0, colW);
    const h2 = drawFacts(doc, rows.slice(half), MARGIN + colW + 24, y0, colW);
    doc.y = y0 + Math.max(h1, h2) + 6;

    sectionTitle(doc, "Productos", ctx);
    drawItemsTable(doc, items, ctx, { discount: order.discountAmount ? { amount: order.discountAmount, code: order.discountCode?.code } : null });

    drawTimeline(doc, timeline, ctx);

    ensureSpace(doc, 50, ctx);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(
      `Este documento resume la compra registrada en ${siteName} con el número ${order.code}. Para consultar el estado del pedido o contactar a la tienda visita su página en línea.`,
      MARGIN,
      doc.y,
      { width: contentWidth(doc), lineGap: 2 }
    );

    finishPages(doc, { vendor, siteName, code: order.code });
  });
}

// La garantía corre desde la fecha de emisión del certificado. Si el pedido ya tiene registrada su entrega, se muestra para
// que ambas partes vean desde cuándo se entregó el producto.
export async function generateWarrantyPdf({ vendor, order, items, warrantyDays, customer, events, province }) {
  const { siteName } = await getBrandSettings();
  const ctx = { vendor, title: "GARANTÍA", code: order.code };
  const timeline = withBaseEvents(order, events);
  const deliveredAt = timeline.find((e) => e.type === "DELIVERED")?.createdAt;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + warrantyDays * 24 * 60 * 60 * 1000);
  const units = items.reduce((s, i) => s + i.quantity, 0);

  return renderToBuffer((doc) => {
    drawHeader(doc, { vendor, title: "CERTIFICADO DE GARANTÍA", code: order.code, date: startDate, siteName });

    twoColumns(
      doc,
      { title: "Datos de la empresa", rows: companyRows(vendor, province) },
      {
        title: "Titular de la garantía",
        rows: [
          ["Nombre", customer.name],
          ["Identificación", customer.idNumber],
          ["Teléfono", customer.phone],
          ["Correo", customer.email],
        ],
      },
      ctx
    );

    sectionTitle(doc, "Resumen de la garantía", ctx);
    const colW = (contentWidth(doc) - 24) / 2;
    const summary = [
      ["Período de garantía", `${warrantyDays} ${warrantyDays === 1 ? "día corrido" : "días corridos"}`],
      ["Vigente desde", fmtDate(startDate)],
      ["Vence el", fmtDate(endDate)],
      ["Cobertura", `${items.length} ${items.length === 1 ? "producto" : "productos"} · ${units} ${units === 1 ? "unidad" : "unidades"}`],
    ];
    ensureSpace(doc, 80, ctx);
    const ys = doc.y;
    const s1 = drawFacts(doc, summary.slice(0, 2), MARGIN, ys, colW);
    const s2 = drawFacts(doc, summary.slice(2), MARGIN + colW + 24, ys, colW);
    doc.y = ys + Math.max(s1, s2) + 6;

    sectionTitle(doc, "Registro de la orden", ctx);
    const orderInfo = orderRows(order, province, deliveredAt).filter((r) => r[1]);
    const half = Math.ceil(orderInfo.length / 2);
    ensureSpace(doc, half * 30 + 10, ctx);
    const y0 = doc.y;
    const h1 = drawFacts(doc, orderInfo.slice(0, half), MARGIN, y0, colW);
    const h2 = drawFacts(doc, orderInfo.slice(half), MARGIN + colW + 24, y0, colW);
    doc.y = y0 + Math.max(h1, h2) + 6;

    sectionTitle(doc, "Productos cubiertos", ctx);
    drawItemsTable(doc, items, ctx);

    drawTimeline(doc, timeline, ctx);

    sectionTitle(doc, "Condiciones de la garantía", ctx);
    doc.font("Helvetica").fontSize(10).fillColor("#333333");
    const intro = `${vendor.companyName} garantiza el/los producto(s) detallados por un período de ${warrantyDays} día(s) corridos a partir de la fecha de emisión de este certificado. Vigencia: desde el ${fmtDate(startDate)} hasta el ${fmtDate(endDate)}.`;
    ensureSpace(doc, doc.heightOfString(intro, { width: contentWidth(doc) }) + 12, ctx);
    doc.text(intro, MARGIN, doc.y, { width: contentWidth(doc), lineGap: 3 });
    doc.moveDown(0.6);
    // Términos propios del negocio (Configuración > Garantías): el controlador exige que existan antes de generar el certificado.
    const terms = String(vendor.warrantyTerms ?? "");
    for (const para of terms.split(/\n{1,}/).filter(Boolean)) {
      ensureSpace(doc, doc.heightOfString(para, { width: contentWidth(doc) }) + 8, ctx);
      doc.text(para, MARGIN, doc.y, { width: contentWidth(doc), lineGap: 3 });
      doc.moveDown(0.4);
    }

    finishPages(doc, { vendor, siteName, code: order.code });
  });
}
