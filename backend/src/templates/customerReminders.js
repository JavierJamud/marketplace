import { currencyLabel } from "../lib/catalog.js";
import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, smallNote, resolveAssetUrl, pickVariant, esc } from "./_shared.js";

// Recordatorios automáticos al cliente (jobs/customerReminders.job.js). Los dos llevan al pie el enlace para no recibir más.
const fmt = (n, currency) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currencyLabel(currency ?? "CUP")}`;

function unsubscribeFooter(url) {
  return `Te escribimos porque tienes cuenta y miraste esta tienda. <a href="${url}" style="color:#75777c;text-decoration:underline;">No quiero recibir estos recordatorios</a>.`;
}

function pointsLine(points) {
  if (!points?.balance) return "";
  return paragraph(
    `Tienes <strong>${points.balance.toLocaleString("es-CU")} puntos</strong> en esta tienda, que valen <strong>${fmt(points.value, points.currency)}</strong>.${points.usable ? " Puedes usarlos al confirmar el pedido." : ""}`
  );
}

// items: [{ name, quantity, price, currency, size }] tal como los guarda CartSnapshot.
export async function cartReminderEmail({ customer, vendor, items, points, unsubscribeUrl }) {
  const subject = pickVariant(`${vendor.id}${customer.email}cart`, [
    `Tu carrito en ${vendor.companyName} te espera`,
    `Dejaste productos en ${vendor.companyName}`,
    `¿Terminamos tu pedido en ${vendor.companyName}?`,
  ]);
  const shown = items.slice(0, 5);
  const rows = shown
    .map((i) => `${Number(i.quantity)}× ${esc(i.name)}${i.size ? ` (talla ${esc(i.size)})` : ""}`)
    .join("<br/>");
  const more = items.length > shown.length ? `<br/>y ${items.length - shown.length} más` : "";
  const html = await emailShell({
    preview: `Tus productos siguen en el carrito de ${vendor.companyName}`,
    title: "Tu carrito sigue guardado",
    storeName: vendor.companyName,
    storeLogoUrl: resolveAssetUrl(vendor.logoUrl),
    accentColor: vendor.color || undefined,
    footerNote: unsubscribeFooter(unsubscribeUrl),
    bodyMjml: `
      ${paragraph(`Hola ${esc(customer.fullName ?? "")}, guardamos lo que dejaste en tu carrito de <strong>${esc(vendor.companyName)}</strong>:`)}
      ${paragraph(rows + more, { color: "#1b1b1d" })}
      ${pointsLine(points)}
      ${smallNote("Los precios y el stock se revisan de nuevo al confirmar, por si cambiaron.")}
      ${ctaButton("Terminar mi pedido", `${env.frontendUrl}/checkout`)}
    `,
  });
  return { subject, html };
}

// Volvió a mirar la tienda y no compró: se le recuerda lo que tiene ahí (puntos sin usar, una oferta activa o las dos cosas).
export async function storeReminderEmail({ customer, vendor, points, offer, unsubscribeUrl }) {
  const subject = points?.balance && offer
    ? `Tus puntos y una oferta te esperan en ${vendor.companyName}`
    : points?.balance
      ? pickVariant(`${vendor.id}${customer.email}pts`, [`Tienes ${points.balance} puntos en ${vendor.companyName}`, `Tus puntos en ${vendor.companyName} siguen ahí`])
      : pickVariant(`${vendor.id}${customer.email}off`, [`${vendor.companyName} tiene una oferta activa`, `Oferta en ${vendor.companyName}`]);
  const offerBlock = offer
    ? paragraph(
        `<strong>${esc(offer.title)}</strong>${offer.discountLabel ? ` · ${esc(offer.discountLabel)}` : ""}${offer.code ? `<br/>Usa el código <strong>${esc(offer.code)}</strong> al pagar.` : ""}${offer.expiresAt ? `<br/>Vale hasta el ${new Date(offer.expiresAt).toLocaleDateString("es-CU", { day: "numeric", month: "long" })}.` : ""}`,
        { color: "#1b1b1d" }
      )
    : "";
  const html = await emailShell({
    preview: points?.balance ? `Tus puntos valen ${fmt(points.value, points.currency)} en ${vendor.companyName}` : `${vendor.companyName} tiene una oferta activa`,
    title: points?.balance ? "Tus puntos siguen esperando" : "Hay una oferta en una tienda que miraste",
    storeName: vendor.companyName,
    storeLogoUrl: resolveAssetUrl(vendor.logoUrl),
    accentColor: vendor.color || undefined,
    footerNote: unsubscribeFooter(unsubscribeUrl),
    bodyMjml: `
      ${paragraph(`Hola ${esc(customer.fullName ?? "")}, hace unos días miraste <strong>${esc(vendor.companyName)}</strong>.`)}
      ${pointsLine(points)}
      ${offerBlock}
      ${ctaButton("Ver la tienda", `${env.frontendUrl}/tienda/${vendor.slug}`)}
    `,
  });
  return { subject, html };
}
