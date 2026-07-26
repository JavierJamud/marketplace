import PDFDocument from "pdfkit";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 29: generador de factura/garantía en PDF — pdfkit dibuja el
// documento a mano (rectángulos, texto, líneas) en vez de renderizar HTML,
// así que no hace falta un motor de browser (Puppeteer) solo para esto.
// Ningún vendedor de este sitio tiene todavía un logoUrl real subido (el
// campo existe pero no hay UI de upload en ningún lado) — el mismo criterio
// que StoreChatWidget.jsx/Store.jsx ya usa para el avatar (círculo de color
// de marca con la inicial de la empresa) se replica acá para que el PDF se
// sienta consistente con el resto del sitio en vez de quedar en blanco.

const PAGE_MARGIN = 50;

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-CU", { year: "numeric", month: "long", day: "numeric" });
}

function renderToBuffer(draw) {
  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
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

function drawHeader(doc, { vendor, title, code, date, siteName }) {
  const color = vendor.color || "#232F3E";
  const pageWidth = doc.page.width;

  doc.rect(0, 0, pageWidth, 90).fill(color);

  // Círculo con la inicial de la empresa — mismo patrón de avatar que el
  // resto del sitio (Store.jsx, StoreChatWidget.jsx) cuando no hay logoUrl.
  doc.circle(PAGE_MARGIN + 20, 45, 20).fill("#ffffff");
  doc
    .fillColor(color)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(vendor.companyName[0].toUpperCase(), PAGE_MARGIN, 34, { width: 40, align: "center" });

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(vendor.companyName, PAGE_MARGIN + 52, 28, { width: pageWidth - PAGE_MARGIN * 2 - 52 });
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(`Tienda verificada en ${siteName} · Cuba`, PAGE_MARGIN + 52, 50);

  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(title, pageWidth - PAGE_MARGIN - 200, 28, { width: 200, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(`N.º ${code}`, pageWidth - PAGE_MARGIN - 200, 48, { width: 200, align: "right" })
    .text(fmtDate(date), pageWidth - PAGE_MARGIN - 200, 61, { width: 200, align: "right" });

  doc.fillColor("#000000");
  doc.y = 112;
}

function drawTwoColumnInfo(doc, { leftTitle, leftLines, rightTitle, rightLines }) {
  const pageWidth = doc.page.width;
  const colWidth = (pageWidth - PAGE_MARGIN * 2 - 20) / 2;
  const startY = doc.y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#666666").text(leftTitle.toUpperCase(), PAGE_MARGIN, startY, { width: colWidth });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text(leftLines.filter(Boolean).join("\n"), PAGE_MARGIN, startY + 14, { width: colWidth, lineGap: 3 });

  const rightX = PAGE_MARGIN + colWidth + 20;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#666666").text(rightTitle.toUpperCase(), rightX, startY, { width: colWidth });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#111111")
    .text(rightLines.filter(Boolean).join("\n"), rightX, startY + 14, { width: colWidth, lineGap: 3 });

  doc.y = Math.max(doc.y, startY + 14 + rightLines.filter(Boolean).length * 14) + 20;
}

// items: [{ name, quantity, price }] — price ya es el unitario en CUP.
// showTotal: la garantía no necesariamente quiere mostrar precio (pero se
// deja igual, es información legítima del producto cubierto).
function drawItemsTable(doc, items) {
  const pageWidth = doc.page.width;
  const tableWidth = pageWidth - PAGE_MARGIN * 2;
  const cols = { name: tableWidth * 0.46, qty: tableWidth * 0.14, price: tableWidth * 0.2, subtotal: tableWidth * 0.2 };
  const startX = PAGE_MARGIN;
  let y = doc.y;

  doc.rect(startX, y, tableWidth, 22).fill("#f2f2f2");
  doc.fillColor("#333333").font("Helvetica-Bold").fontSize(9);
  let x = startX + 8;
  doc.text("Producto", x, y + 7, { width: cols.name - 8 });
  x += cols.name;
  doc.text("Cant.", x, y + 7, { width: cols.qty - 8, align: "right" });
  x += cols.qty;
  doc.text("Precio unit.", x, y + 7, { width: cols.price - 8, align: "right" });
  x += cols.price;
  doc.text("Subtotal", x, y + 7, { width: cols.subtotal - 16, align: "right" });
  y += 22;

  doc.font("Helvetica").fontSize(10).fillColor("#111111");
  let total = 0;
  for (const item of items) {
    const subtotal = Number(item.price) * item.quantity;
    total += subtotal;
    const rowHeight = 22;
    x = startX + 8;
    doc.text(item.name, x, y + 6, { width: cols.name - 8 });
    x += cols.name;
    doc.text(String(item.quantity), x, y + 6, { width: cols.qty - 8, align: "right" });
    x += cols.qty;
    doc.text(fmtCUP(item.price), x, y + 6, { width: cols.price - 8, align: "right" });
    x += cols.price;
    doc.text(fmtCUP(subtotal), x, y + 6, { width: cols.subtotal - 16, align: "right" });
    doc
      .strokeColor("#e5e5e5")
      .lineWidth(0.5)
      .moveTo(startX, y + rowHeight)
      .lineTo(startX + tableWidth, y + rowHeight)
      .stroke();
    y += rowHeight;
  }

  doc.font("Helvetica-Bold").fontSize(11);
  doc.text("TOTAL", startX + cols.name + cols.qty, y + 10, { width: cols.price - 8, align: "right" });
  doc.text(fmtCUP(total), startX + cols.name + cols.qty + cols.price, y + 10, { width: cols.subtotal - 16, align: "right" });
  y += 34;

  doc.y = y;
  return total;
}

function drawFooter(doc, siteName) {
  const pageWidth = doc.page.width;
  // Bloque 29: tiene que quedar DENTRO de la caja de márgenes de pdfkit
  // (page.height - margins.bottom) — probado en vivo: una coordenada apenas
  // más abajo que eso hace que pdfkit interprete el texto como "no entra" y
  // agregue una página 2 en blanco solo para el footer, aunque se le pase
  // una posición (x,y) absoluta.
  const bottomBoundary = doc.page.height - doc.page.margins.bottom;
  doc
    .strokeColor("#e5e5e5")
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, bottomBoundary - 22)
    .lineTo(pageWidth - PAGE_MARGIN, bottomBoundary - 22)
    .stroke();
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#999999")
    .text(`Documento generado por ${siteName} el ${fmtDate(new Date())}`, PAGE_MARGIN, bottomBoundary - 14, {
      width: pageWidth - PAGE_MARGIN * 2,
      align: "center",
      lineBreak: false,
    });
}

// customer: { name, idNumber, phone, email }
export async function generateInvoicePdf({ vendor, order, items, customer }) {
  const { siteName } = await getBrandSettings();
  return renderToBuffer((doc) => {
    drawHeader(doc, { vendor, title: "FACTURA DE COMPRA", code: order.code, date: order.createdAt, siteName });

    drawTwoColumnInfo(doc, {
      leftTitle: "Datos de la empresa",
      leftLines: [
        vendor.ownerName && `Responsable: ${vendor.ownerName}`,
        vendor.ownerIdNumber && `Identificación: ${vendor.ownerIdNumber}`,
        vendor.companyAddress,
        vendor.whatsapp && `Tel: ${vendor.whatsapp}`,
        vendor.email,
      ],
      rightTitle: "Datos del cliente",
      rightLines: [customer.name && `Nombre: ${customer.name}`, customer.idNumber && `Identificación: ${customer.idNumber}`, customer.phone && `Tel: ${customer.phone}`, customer.email],
    });

    drawItemsTable(doc, items);

    drawFooter(doc, siteName);
  });
}

// items para garantía: solo los productos que el vendedor seleccionó de ese
// pedido (no necesariamente todos) — warrantyDays define la vigencia desde
// HOY (fecha de emisión del certificado, no la fecha del pedido: la garantía
// cubre desde que el cliente efectivamente recibe/retira el producto).
export async function generateWarrantyPdf({ vendor, order, items, warrantyDays, customer }) {
  const { siteName } = await getBrandSettings();
  return renderToBuffer((doc) => {
    drawHeader(doc, { vendor, title: "CERTIFICADO DE GARANTÍA", code: order.code, date: new Date(), siteName });

    drawTwoColumnInfo(doc, {
      leftTitle: "Datos de la empresa",
      leftLines: [
        vendor.ownerName && `Responsable: ${vendor.ownerName}`,
        vendor.ownerIdNumber && `Identificación: ${vendor.ownerIdNumber}`,
        vendor.companyAddress,
        vendor.whatsapp && `Tel: ${vendor.whatsapp}`,
        vendor.email,
      ],
      rightTitle: "Datos del cliente",
      rightLines: [customer.name && `Nombre: ${customer.name}`, customer.idNumber && `Identificación: ${customer.idNumber}`, customer.phone && `Tel: ${customer.phone}`, customer.email],
    });

    drawItemsTable(doc, items);

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + warrantyDays * 24 * 60 * 60 * 1000);

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text("Condiciones de la garantía", PAGE_MARGIN, doc.y);
    doc.moveDown(0.4);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#333333")
      .text(
        `${vendor.companyName} garantiza el/los producto(s) detallados arriba por un período de ${warrantyDays} día(s) corridos ` +
          `a partir de la fecha de emisión de este certificado.\n\n` +
          `Vigencia: desde el ${fmtDate(startDate)} hasta el ${fmtDate(endDate)}.`,
        { width: doc.page.width - PAGE_MARGIN * 2, lineGap: 3 }
      );

    // Términos y condiciones propios del negocio (sección "Garantías" de
    // VendorSettings.jsx) — invoices.controller.js ya exige que esto exista
    // antes de generar el certificado, así que acá siempre viene con texto
    // real, nunca el hueco que antes quedaba con un párrafo genérico igual
    // para todas las tiendas.
    doc.moveDown(0.6);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#333333")
      .text(vendor.warrantyTerms, { width: doc.page.width - PAGE_MARGIN * 2, lineGap: 3 });

    drawFooter(doc, siteName);
  });
}
