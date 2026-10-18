/**
 * toast.jsx: avisos de todo el sitio, dibujados con Sileo (https://sileo.aaryan.design).
 *
 * La API es la misma de siempre, así que ninguna pantalla cambió:
 *
 *   import toast from "../lib/toast.jsx";
 *
 *   toast.success("Guardado.");
 *   toast.error("No se pudo guardar.");
 *   toast.warning("Revisa tu conexión.");
 *   toast.info("Proceso iniciado.");
 *   const id = toast.loading("Cargando...");  // queda abierto hasta toast.dismiss(id)
 *
 *   toast.success("Producto agregado", "Revisa tu carrito.");          // con descripción
 *   toast.success("Agregado", null, { icon: "cart" });                 // ícono explícito
 *   toast.warning("Sin conexión", "...", { action: { label: "Reintentar", onClick } });
 *   toast.dismiss(id);
 *
 * Íconos: cart · delete · trash · save · user · payment · card · upload · download · star · review · message · chat · copy
 * link · mail · email · bell · order · store · favorite · heart · shield · lock · phone · settings · image · calendar
 * location · package · shipping · check. Sin `icon`, success e info lo eligen solos según el texto (ver ICON_KEYWORDS).
 */

import React from "react";
import { sileo } from "sileo";
import { ToastIcon } from "../components/ui/Toast.jsx";
import { FRIENDLY_TITLE, FRIENDLY_HINT, getRecentFailure, shouldShowFriendlyToast, openErrorReport } from "./errorReport.js";

const DURATION_TITLE = 2800;
const DURATION_WITH_DESC = 5000;
const DURATION_WITH_ACTION = 9000;
// El título de Sileo va en una sola línea, en la pastilla de arriba. Un texto más largo pasa a la descripción, que sí se ajusta.
const TITLE_MAX = 34;
const SHORT_TITLE = { success: "Listo", error: "No se pudo", warning: "Atención", info: "Aviso", loading: "Un momento" };

// Bloque 216: el ícono se elige leyendo el propio texto, así los cientos de avisos ya escritos son específicos sin tocar cada
// pantalla. Los verbos de acción van antes que los sustantivos ("Producto eliminado" es papelera, no paquete).
const ICON_KEYWORDS = [
  [/elimin|borr|quit|remov|sacad[oa]|descart|cancelad[oa]|cancel[oó]|rechaz|revoc/i, "delete"],
  [/carrito/i, "cart"],
  [/favorit/i, "heart"],
  [/contraseñ|password/i, "lock"],
  [/correo|email/i, "mail"],
  [/pago|pagó|pagad[oa]|pagar|cobr/i, "payment"],
  [/pedido|orden(?!ar)/i, "order"],
  [/reseñ|comentari|calificaci|opinion/i, "review"],
  [/mensaje|chat|respuesta/i, "message"],
  [/foto|imagen|logo/i, "image"],
  [/usuario|perfil|cuenta/i, "user"],
  [/tienda/i, "store"],
  [/env[ií]o|entreg/i, "shipping"],
  [/producto|stock|inventario|catálogo|catalogo/i, "package"],
  [/copiad|enlace|link/i, "link"],
  [/subid|cargad|subi[oó]/i, "upload"],
  [/descarg/i, "download"],
  [/notificaci|aviso/i, "bell"],
  [/ubicaci|direcci|provincia|municipio|país|pais/i, "location"],
  [/tel[ée]fono|whatsapp|llamad/i, "phone"],
  [/configuraci|ajuste/i, "settings"],
  [/calendario|horario|fecha|agend/i, "calendar"],
  [/verificad|verificaci|aprobad|confirmad[oa]|reactivad/i, "shield"],
  [/guardad|actualizad|creado|creada|publicad|activ[oó]|desactiv/i, "save"],
];

// En error y advertencia el ícono es siempre el de Sileo: "algo salió mal" se reconoce de un vistazo, sin glifos distintos.
function inferIcon(type, title, description) {
  if (type !== "success" && type !== "info") return null;
  const text = `${title ?? ""} ${description ?? ""}`;
  for (const [re, icon] of ICON_KEYWORDS) if (re.test(text)) return icon;
  return null;
}

function parseArgs(second, third) {
  if (second == null || typeof second === "string") return { description: second ?? undefined, options: third ?? {} };
  return { description: undefined, options: second ?? {} };
}

function showToast(type, rawTitle, rawDescription, opts = {}) {
  // Un aviso sin texto (p. ej. el error de una acción que la persona canceló en el modal de código) no se muestra.
  if (typeof rawTitle === "string" && rawTitle.trim() === "") return undefined;
  const { icon, duration: customDuration, action, id: _id, ...rest } = opts;
  let title = String(rawTitle ?? "");
  let description = rawDescription;
  if (title.length > TITLE_MAX) {
    description = description ? `${title} ${description}` : title;
    title = SHORT_TITLE[type] ?? "Aviso";
  }
  const iconName = icon ?? inferIcon(type, rawTitle, rawDescription);
  const duration = customDuration ?? (type === "loading" ? null : action ? DURATION_WITH_ACTION : description ? DURATION_WITH_DESC : DURATION_TITLE);

  const payload = {
    ...rest,
    title,
    description,
    duration: duration === Infinity ? null : duration,
    ...(iconName && iconName !== type ? { icon: <ToastIcon name={iconName} size={14} color="currentColor" /> } : {}),
  };
  if (action) {
    let id;
    payload.button = { title: action.label, onClick: () => { sileo.dismiss(id); action.onClick(); } };
    id = type === "loading" ? sileo.show({ ...payload, type: "loading" }) : sileo[type](payload);
    return id;
  }
  if (type === "loading") return sileo.show({ ...payload, type: "loading" });
  return sileo[type](payload);
}

const toast = {
  success: (title, second, third) => {
    const { description, options } = parseArgs(second, third);
    return showToast("success", title, description, options);
  },
  error: (title, second, third) => {
    // Fallo técnico (sin conexión o error del servidor): en vez de "error", se avisa del problema de conexión con un botón para
    // reportarlo a la plataforma.
    if (getRecentFailure()) {
      if (!shouldShowFriendlyToast()) return undefined;
      return showToast("warning", FRIENDLY_TITLE, FRIENDLY_HINT, { action: { label: "Reportar el problema", onClick: () => openErrorReport() } });
    }
    const { description, options } = parseArgs(second, third);
    return showToast("error", title, description, options);
  },
  warning: (title, second, third) => {
    const { description, options } = parseArgs(second, third);
    return showToast("warning", title, description, options);
  },
  info: (title, second, third) => {
    const { description, options } = parseArgs(second, third);
    return showToast("info", title, description, options);
  },
  loading: (title, second, third) => {
    const { description, options } = parseArgs(second, third);
    return showToast("loading", title, description, options);
  },
  dismiss: (id) => (id ? sileo.dismiss(id) : sileo.clear()),
  remove: (id) => (id ? sileo.dismiss(id) : sileo.clear()),
  // Aviso con botón propio (lo usan los avisos en vivo: "Ver" lleva a la pantalla del pedido, mensaje, etc.).
  action: (title, description, { label, onClick, duration } = {}) =>
    showToast("info", title, description, { duration, action: { label, onClick } }),

  promise: (promise, msgs = {}) => {
    const id = toast.loading(msgs.loading ?? "Procesando...");
    promise
      .then((data) => {
        sileo.dismiss(id);
        toast.success(typeof msgs.success === "function" ? msgs.success(data) : (msgs.success ?? "Completado."));
      })
      .catch((err) => {
        sileo.dismiss(id);
        toast.error(typeof msgs.error === "function" ? msgs.error(err) : (msgs.error ?? "Ocurrió un error."));
      });
    return promise;
  },
};

export default toast;
