import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, smallNote, resolveAssetUrl, esc } from "./_shared.js";
import { currencyLabel } from "../lib/catalog.js";

// Correos al cliente sobre sus puntos en una tienda (services/loyaltyNotify.service.js): ganados al recibir un pedido (con el
// bono si lo hubo), regalados o quitados por la tienda, y devueltos o quitados cuando se anula un pedido. Son avisos de la
// plataforma sobre su saldo, no publicidad: le llegan aunque tenga apagados los recordatorios.

const fmtPts = (n) => `${Number(n).toLocaleString("es-CU")} ${Math.abs(n) === 1 ? "punto" : "puntos"}`;
const fmtMoney = (n, c) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currencyLabel(c ?? "CUP")}`;
const storeUrl = (vendor) => `${String(env.frontendUrl).replace(/\/$/, "")}/tienda/${vendor.slug}`;
const pointsUrl = () => `${String(env.frontendUrl).replace(/\/$/, "")}/cuenta/panel?tab=points`;

// Saldo y si ya se puede usar: lo que más le importa al cliente después de cada movimiento.
function balanceBlock({ balance, value, currency, minRedeemPoints, maxRedeemPercent, programActive }) {
  // Sin un valor en dinero válido (programa sin tasa, o un dato que no llegó) se dice solo el saldo: antes salía "valen NaN CUP".
  const hasValue = Number.isFinite(Number(value));
  const lines = [`Tu saldo en esta tienda: <strong>${fmtPts(balance)}</strong>${hasValue ? `, que valen <strong>${fmtMoney(value, currency)}</strong>` : ""}.`];
  if (!programActive) lines.push("La tienda pausó su programa por ahora: tus puntos se guardan y los podrás usar cuando lo vuelva a activar.");
  else if (balance >= minRedeemPoints) lines.push(`Ya puedes usarlos al confirmar tu próximo pedido aquí, para pagar hasta el ${maxRedeemPercent} % del total.`);
  else lines.push(`Te faltan <strong>${fmtPts(minRedeemPoints - balance)}</strong> para poder usarlos (se usan desde ${fmtPts(minRedeemPoints)}).`);
  return paragraph(lines.join("<br/>"), { padding: "6px 0 8px" });
}

async function shell({ vendor, title, preview, badge, body, cta }) {
  return emailShell({
    preview,
    title,
    storeName: vendor.companyName,
    storeLogoUrl: resolveAssetUrl(vendor.logoUrl),
    accentColor: "#337475",
    // Sin esto el pie decía "desde tu pedido" también en los puntos regalados o quitados, que no tienen pedido.
    footerNote: "Este es un correo automático: si tienes dudas sobre tus puntos, escríbele a la tienda desde su página.",
    badge,
    bodyMjml: `
      ${body}
      ${ctaButton(cta ?? `Ir a ${esc(vendor.companyName)}`, storeUrl(vendor))}
      ${smallNote(`Puedes ver todos tus puntos y sus movimientos en <a href="${pointsUrl()}" style="color:#337475;">Mis puntos</a>. Los puntos de cada tienda solo se usan en esa tienda.`)}
    `,
  });
}

// kind: earned | gift | removed | reversed
export async function loyaltyPointsEmail({ kind, customerName, vendor, orderCode, points, bonus, note, removed, refunded, account }) {
  const hello = `Hola${customerName ? ` ${esc(customerName)}` : ""},`;
  if (kind === "earned") {
    const extra = bonus > 0 ? ` Incluye un <strong>bono de ${fmtPts(bonus)}</strong> por tu compra grande.` : "";
    return {
      subject: `Ganaste ${fmtPts(points)} en ${vendor.companyName}`,
      html: await shell({
        vendor,
        title: `Ganaste ${fmtPts(points)}`,
        preview: `Por tu pedido ${orderCode} en ${vendor.companyName}.${Number.isFinite(Number(account.value)) ? ` Tu saldo ya vale ${fmtMoney(account.value, account.currency)}.` : ""}`,
        badge: { label: `+${fmtPts(points)}`, color: "#1f7a4d" },
        body: `${paragraph(`${hello} recibiste tu pedido <strong>${esc(orderCode)}</strong> y <strong>${esc(vendor.companyName)}</strong> te dio <strong>${fmtPts(points)}</strong>.${extra}`)}${balanceBlock(account)}`,
      }),
    };
  }
  if (kind === "gift") {
    return {
      subject: `${vendor.companyName} te regaló ${fmtPts(points)}`,
      html: await shell({
        vendor,
        title: `Te regalaron ${fmtPts(points)}`,
        preview: note ? `Motivo: ${note}` : `${vendor.companyName} sumó puntos a tu saldo.`,
        badge: { label: `+${fmtPts(points)}`, color: "#1f7a4d" },
        body: `${paragraph(`${hello} <strong>${esc(vendor.companyName)}</strong> sumó <strong>${fmtPts(points)}</strong> a tu saldo.${note ? `<br/>Motivo: ${esc(note)}` : ""}`)}${balanceBlock(account)}`,
      }),
    };
  }
  if (kind === "removed") {
    return {
      subject: `${vendor.companyName} ajustó tus puntos`,
      html: await shell({
        vendor,
        title: "Se ajustó tu saldo de puntos",
        preview: note ? `Motivo: ${note}` : `${vendor.companyName} corrigió tu saldo.`,
        badge: { label: `-${fmtPts(Math.abs(points))}`, color: "#65676c" },
        body: `${paragraph(`${hello} <strong>${esc(vendor.companyName)}</strong> quitó <strong>${fmtPts(Math.abs(points))}</strong> de tu saldo.${note ? `<br/>Motivo: ${esc(note)}` : ""} Si crees que es un error, escríbele a la tienda.`)}${balanceBlock(account)}`,
        cta: "Escribir a la tienda",
      }),
    };
  }
  // reversed: el pedido se anuló; se devuelven los puntos usados y se quitan los ganados.
  const parts = [];
  if (refunded > 0) parts.push(`te devolvimos los <strong>${fmtPts(refunded)}</strong> que usaste`);
  if (removed > 0) parts.push(`quitamos los <strong>${fmtPts(removed)}</strong> que te había dado`);
  return {
    subject: `Tus puntos del pedido ${orderCode} en ${vendor.companyName}`,
    html: await shell({
      vendor,
      title: "Actualizamos tus puntos",
      preview: `El pedido ${orderCode} se anuló y tu saldo se ajustó.`,
      badge: { label: "Pedido anulado", color: "#65676c" },
      body: `${paragraph(`${hello} el pedido <strong>${esc(orderCode)}</strong> en <strong>${esc(vendor.companyName)}</strong> se anuló, así que ${parts.join(" y ")}.`)}${balanceBlock(account)}`,
    }),
  };
}
