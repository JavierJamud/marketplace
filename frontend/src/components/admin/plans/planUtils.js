// Utilidades de la pantalla de planes del admin (rejilla de tarjetas y ventana Configurar).
// Antes cada pantalla tenía su propia lista fija de límites e interruptores (PLAN_LIMIT_FIELDS y PLAN_TOGGLE_FIELDS) y se
// desfasaba del servidor. Ahora todo sale del catálogo de funciones (GET /admin/plan-features): aquí solo se arma el
// formulario a partir de un plan, se calcula qué cambió (el PATCH y el preview-impact reciben solo eso) y se repite en el
// cliente el armado de "Tu plan incluye" para la vista previa antes de guardar.

export const toText = (v) => (v === null || v === undefined ? "" : String(v));
const decimal = (v) => Number(String(v ?? "").replace(",", "."));
export const numOrNull = (v) => (String(v ?? "").trim() === "" ? null : decimal(v));

export function fmtCup(n) {
  return `${Math.round(Number(n) || 0).toLocaleString("es-CU")} CUP`;
}

export function fmtUsd(n) {
  const value = Number(n) || 0;
  return `US$ ${value.toLocaleString("en-US", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

export const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

// Mensaje de error de la API (el interceptor deja vacío el de un código de acción cancelado: ahí no se avisa nada).
export const apiError = (err, fallback) => err?.response?.data?.error ?? fallback;

// Chips de estado de una tarjeta. Tono: "role" (navy, papel del plan), "accent" (naranja, el más elegido), "teal"
// (cómo se cobra) y "muted" (oculto o archivado).
export function planChips(plan) {
  const chips = [];
  if (plan.archivedAt) chips.push({ id: "archived", label: "Archivado", tone: "muted" });
  if (plan.isDefault) chips.push({ id: "default", label: "Plan por defecto", tone: "role" });
  if (plan.isTrialPlan) chips.push({ id: "trial", label: "Plan de prueba", tone: "role" });
  if (plan.contactOnly) chips.push({ id: "contact", label: "Por WhatsApp", tone: "teal" });
  else if (plan.isFree) chips.push({ id: "free", label: "Gratis", tone: "teal" });
  else chips.push({ id: "paid", label: "De pago", tone: "teal" });
  if (plan.highlighted) chips.push({ id: "highlighted", label: "Más elegido", tone: "accent" });
  if (plan.grantsBadge) chips.push({ id: "badge", label: "Da insignia", tone: "teal" });
  if (!plan.archivedAt && plan.isPublic === false) chips.push({ id: "hidden", label: "Oculto", tone: "muted" });
  return chips;
}

export const CHIP_TONE = {
  role: "bg-primary text-on-primary",
  accent: "bg-secondary-container/25 text-on-secondary-container",
  teal: "bg-tertiary-accent/10 text-[#245a5b]",
  muted: "bg-surface-container-high text-on-surface-variant",
};

// Funciones del catálogo que se editan con una columna de PlanConfig (interruptores y topes). allowPanelOrders y
// cualquier otra inactiva quedan fuera: el servidor ya no las usa y el PATCH las rechaza.
export function editableRegistry(catalog) {
  return (catalog ?? []).filter((f) => f.kind !== "custom" && f.column && f.isActive);
}

export function activeCustom(catalog) {
  return (catalog ?? []).filter((f) => f.kind === "custom" && f.isActive);
}

function customOf(plan) {
  const raw = plan?.customFeatures;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v === true));
}

const columnValue = (plan, f) => (f.kind === "limit" ? plan?.[f.column] ?? null : !!plan?.[f.column]);

// Formulario de la ventana Configurar a partir de un plan (tal como lo manda GET /admin/plans).
export function formFromPlan(plan, catalog) {
  return {
    displayName: plan.displayName ?? "",
    tagline: plan.tagline ?? "",
    sortOrder: toText(plan.sortOrder),
    priceCup: toText(plan.priceCup),
    priceUsd: toText(plan.priceUsd),
    listPriceCup: toText(plan.listPriceCup),
    listPriceUsd: toText(plan.listPriceUsd),
    isFree: !!plan.isFree,
    contactOnly: !!plan.contactOnly,
    highlighted: !!plan.highlighted,
    grantsBadge: !!plan.grantsBadge,
    isPublic: plan.isPublic !== false,
    isDefault: !!plan.isDefault,
    isTrialPlan: !!plan.isTrialPlan,
    monthDiscounts: (plan.monthDiscounts ?? []).map((d) => ({ months: toText(d.months), cup: toText(d.cup), usd: toText(d.usd) })),
    features: [...(plan.features ?? [])],
    cols: Object.fromEntries(editableRegistry(catalog).map((f) => [f.column, columnValue(plan, f)])),
    custom: customOf(plan),
  };
}

const SCALAR_KEYS = ["displayName", "tagline", "sortOrder", "priceCup", "priceUsd", "listPriceCup", "listPriceUsd", "isFree", "contactOnly", "highlighted", "grantsBadge", "isPublic"];

function scalarsOfForm(form) {
  return {
    displayName: form.displayName.trim(),
    tagline: form.tagline.trim() || null,
    sortOrder: Number(form.sortOrder) || 0,
    priceCup: Number(form.priceCup) || 0,
    priceUsd: decimal(form.priceUsd) || 0,
    listPriceCup: numOrNull(form.listPriceCup),
    listPriceUsd: numOrNull(form.listPriceUsd),
    isFree: form.isFree,
    contactOnly: form.contactOnly,
    highlighted: form.highlighted,
    grantsBadge: form.grantsBadge,
    isPublic: form.isPublic,
  };
}

function scalarsOfPlan(plan) {
  return {
    displayName: plan.displayName ?? "",
    tagline: plan.tagline ?? null,
    sortOrder: Number(plan.sortOrder) || 0,
    priceCup: Number(plan.priceCup) || 0,
    priceUsd: Number(plan.priceUsd) || 0,
    listPriceCup: plan.listPriceCup == null ? null : Number(plan.listPriceCup),
    listPriceUsd: plan.listPriceUsd == null ? null : Number(plan.listPriceUsd),
    isFree: !!plan.isFree,
    contactOnly: !!plan.contactOnly,
    highlighted: !!plan.highlighted,
    grantsBadge: !!plan.grantsBadge,
    isPublic: plan.isPublic !== false,
  };
}

const discountsOfForm = (rows) =>
  rows.filter((d) => String(d.months).trim() !== "").map((d) => ({ months: Number(d.months), cup: Number(d.cup) || 0, usd: Number(d.usd) || 0 }));
const discountsOfPlan = (rows) => (rows ?? []).map((d) => ({ months: Number(d.months), cup: Number(d.cup) || 0, usd: Number(d.usd) || 0 }));
const cleanLines = (lines) => (lines ?? []).map((l) => String(l).trim()).filter(Boolean);

// Cambios del formulario para PATCH /admin/plans/:key, con SOLO lo que cambió. "main" va también a preview-impact, así el
// resumen de impacto habla del cambio real y no de campos que siguen igual.
// En el contrato la clave "features" sirve para dos cosas: el objeto de funciones del catálogo ({ allowPos: { enabled } })
// y la lista de líneas de texto libre de siempre (["..."]). No pueden viajar juntas en el mismo pedido, así que si cambian
// las dos, las líneas van en un segundo PATCH ("lines"). Si cambian solo las líneas, van en "main".
export function buildPatchBody(form, base, catalog) {
  const main = {};
  const now = scalarsOfForm(form);
  const before = scalarsOfPlan(base);
  for (const key of SCALAR_KEYS) if (now[key] !== before[key]) main[key] = now[key];

  const discounts = discountsOfForm(form.monthDiscounts);
  if (JSON.stringify(discounts) !== JSON.stringify(discountsOfPlan(base.monthDiscounts))) main.monthDiscounts = discounts;

  // El servidor solo acepta true: la bandera se mueve desde el plan que la tenía, nunca se apaga sin elegir otro.
  if (form.isDefault && !base.isDefault) main.isDefault = true;
  if (form.isTrialPlan && !base.isTrialPlan) main.isTrialPlan = true;

  const features = {};
  for (const f of editableRegistry(catalog)) {
    const value = form.cols[f.column];
    if (value === columnValue(base, f)) continue;
    features[f.key] = f.kind === "limit" ? { limit: value } : { enabled: !!value };
  }
  if (Object.keys(features).length) main.features = features;

  const customs = activeCustom(catalog);
  const baseCustom = customOf(base);
  if (customs.some((f) => !!form.custom[f.key] !== !!baseCustom[f.key])) {
    main.customFeatures = Object.fromEntries(customs.map((f) => [f.key, !!form.custom[f.key]]));
  }

  const lines = cleanLines(form.features);
  let linesBody = null;
  if (JSON.stringify(lines) !== JSON.stringify(cleanLines(base.features))) {
    if (main.features) linesBody = { features: lines };
    else main.features = lines;
  }
  return { main, lines: linesBody, dirty: Object.keys(main).length > 0 || !!linesBody };
}

// Topes de las líneas de texto libre: los mismos de textFeaturesSchema (adminPlans.controller.js), porque se muestran tal
// cual en la página de planes.
export const MAX_TEXT_LINES = 12;
export const MAX_TEXT_LINE_LENGTH = 80;

// Errores que impiden guardar, con el mismo criterio que el servidor (así el admin los ve antes de pedir el código).
// `base` (el plan guardado) es opcional: con él, las líneas de texto libre solo se revisan si cambiaron, para que una línea
// vieja más larga que el tope no bloquee un cambio de precio que no las manda.
export function validateForm(form, base) {
  const errors = {};
  const name = form.displayName.trim();
  if (!name) errors.displayName = "Escribe el nombre del plan.";
  else if (name.length > 40) errors.displayName = "El nombre admite hasta 40 caracteres.";
  if (form.tagline.trim().length > 90) errors.tagline = "La frase admite hasta 90 caracteres.";
  // Mismo tope que el servidor (0 a 999): un plan creado nace con el mayor orden + 1 y puede pasar de 99.
  if (Number(form.sortOrder) > 999) errors.sortOrder = "El orden va de 0 a 999.";
  if (form.isFree && form.contactOnly) errors.sale = "Elige una sola forma: gratis o por WhatsApp.";
  // validateNext del servidor: el destacado tiene que verse en la página de planes y poder contratarse en línea o gratis.
  else if (form.highlighted && (!form.isPublic || form.contactOnly)) errors.sale = "Solo un plan visible y que no sea por WhatsApp puede ser el destacado.";
  if (!form.isFree && !form.contactOnly && (!(Number(form.priceCup) > 0) || !(decimal(form.priceUsd) > 0))) {
    errors.price = "Para cobrar este plan escribe su precio en CUP y en USD.";
  }
  // De 2 a 24 meses, como discountSchema del servidor: los pagos también llegan como máximo a 24 meses.
  const discounts = form.monthDiscounts.filter((d) => String(d.months).trim() !== "");
  if (discounts.some((d) => !(Number(d.months) >= 2 && Number(d.months) <= 24) || Number(d.cup) > 90 || Number(d.usd) > 90)) {
    errors.discounts = "Cada descuento va de 2 a 24 meses y hasta 90 %.";
  } else if (new Set(discounts.map((d) => Number(d.months))).size !== discounts.length) {
    errors.discounts = "Hay dos descuentos para la misma cantidad de meses.";
  }
  const lines = cleanLines(form.features);
  if (!base || JSON.stringify(lines) !== JSON.stringify(cleanLines(base.features))) {
    if (lines.length > MAX_TEXT_LINES) errors.lines = `Hasta ${MAX_TEXT_LINES} líneas por plan. Quita ${plural(lines.length - MAX_TEXT_LINES, "línea", "líneas")}.`;
    else if (lines.some((l) => l.length > MAX_TEXT_LINE_LENGTH)) errors.lines = `Cada línea admite hasta ${MAX_TEXT_LINE_LENGTH} caracteres. Acorta las más largas.`;
  }
  if (form.isDefault && form.contactOnly) errors.role = "El plan por defecto no puede contratarse solo por WhatsApp.";
  else if (form.isDefault && !form.isPublic) errors.role = "El plan por defecto tiene que verse en la página de planes.";
  // Igual que validateNext del servidor: el plan por defecto es el de las tiendas nuevas y el de bajada, sin insignia.
  else if (form.isDefault && form.grantsBadge) errors.role = "El plan por defecto no puede dar la insignia de verificada: es el de las tiendas nuevas y el de las que dejan de pagar.";
  else if (form.isTrialPlan && (form.isFree || form.contactOnly)) errors.role = "El plan de prueba no puede ser gratis ni contratarse por WhatsApp.";
  return errors;
}

// Pestaña donde vive cada error, para marcarla y llevar al admin allí al pulsar Guardar.
export const ERROR_TAB = { displayName: "precio", tagline: "precio", sortOrder: "precio", sale: "precio", price: "precio", discounts: "precio", role: "precio", lines: "extras" };

// Filas de la pestaña "Funciones y límites": un interruptor con tope propio va en UNA fila (casilla "Incluida" + campo
// "Hasta"), así no existe el estado incoherente de "tope 5 con la función apagada".
export function featureRows(catalog) {
  const registry = editableRegistry(catalog);
  const byKey = new Map(registry.map((f) => [f.key, f]));
  const rows = [];
  for (const f of registry) {
    if (f.kind === "flag" && f.pairedLimit && byKey.has(f.pairedLimit)) continue;
    if (f.kind === "limit" && f.governedBy && byKey.has(f.governedBy)) {
      const flag = byKey.get(f.governedBy);
      rows.push({
        key: f.key,
        group: flag.group || f.group,
        sortOrder: flag.sortOrder,
        label: flag.label,
        description: [flag.description, f.description].filter(Boolean).join(" "),
        requiresBadge: !!(flag.requiresBadge || f.requiresBadge),
        flagKey: flag.key,
        flagCol: flag.column,
        limitCol: f.column,
      });
    } else {
      rows.push({
        key: f.key,
        group: f.group,
        sortOrder: f.sortOrder,
        label: f.label,
        description: f.description,
        requiresBadge: !!f.requiresBadge,
        flagKey: f.kind === "flag" ? f.key : null,
        flagCol: f.kind === "flag" ? f.column : null,
        limitCol: f.kind === "limit" ? f.column : null,
      });
    }
  }
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export function groupRows(rows, groups) {
  const order = [...(groups ?? []), ...rows.map((r) => r.group).filter((g) => !(groups ?? []).includes(g))];
  return [...new Set(order)].map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length);
}

// ---- Vista previa de "Tu plan incluye" ----
// Misma lógica que renderPlanIncludes (backend/src/lib/planFeatures.js) y buildPlanIncludes (planConfig.js), aplicada al
// formulario sin guardar. Si se cambia allí, hay que cambiarla aquí.
export function formatFeatureText(template, n) {
  if (!template) return null;
  return String(template)
    .replace(/\{n\}/g, String(n))
    .replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_m, one, many) => (Number(n) === 1 ? one : many));
}

function publicTextOf(feature, enabled, limit) {
  if (!enabled) return null;
  if (feature.kind === "limit") return limit == null ? feature.unlimitedLabel || null : formatFeatureText(feature.publicLabel, limit);
  return feature.publicLabel || (feature.kind === "custom" ? feature.label : null);
}

const TOPICS = ["verificad", "producto", "provincia", "envio", "whatsapp", "pedido", "caja", "chat", "usuario", "mesa", "codigo", "oferta", "punto", "correo", "horario", "resena", "destacad", "perfil", "privad"];

export function includesPreview(form, catalog) {
  const active = (catalog ?? []).filter((f) => f.isActive);
  const columnOfKey = Object.fromEntries(active.filter((f) => f.column).map((f) => [f.key, f.column]));
  const value = (f) => {
    if (f.kind === "custom") return { enabled: form.custom[f.key] === true, limit: null };
    if (f.kind === "flag") return { enabled: !!form.cols[f.column], limit: null };
    const on = f.governedBy ? !!form.cols[columnOfKey[f.governedBy]] : true;
    return { enabled: on, limit: on ? form.cols[f.column] ?? null : 0 };
  };
  const governedFlags = new Set(active.filter((f) => f.kind === "limit" && f.governedBy).map((f) => f.governedBy));
  const lines = [];
  for (const f of active) {
    if (f.kind !== "limit" || f.governedBy) continue;
    const text = publicTextOf(f, true, form.cols[f.column] ?? null);
    if (text) lines.push(text);
  }
  lines.push("Pedidos en tu panel");
  for (const f of active) {
    if (f.kind === "custom" || (f.kind === "limit" && !f.governedBy) || governedFlags.has(f.key)) continue;
    // Igual que el servidor: lo que exige la insignia (por sí o por su interruptor) no se anuncia en un plan sin ella.
    const needsBadge = f.requiresBadge || (!!f.governedBy && !!active.find((x) => x.key === f.governedBy)?.requiresBadge);
    if (needsBadge && !form.grantsBadge) continue;
    const { enabled, limit } = value(f);
    const text = publicTextOf(f, enabled, limit);
    if (text) lines.push(text);
  }
  if (form.grantsBadge) lines.push("Insignia de tienda verificada");
  for (const f of active) {
    if (f.kind !== "custom") continue;
    const text = publicTextOf(f, value(f).enabled, null);
    if (text) lines.push(text);
  }
  const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const covered = TOPICS.filter((k) => lines.some((l) => norm(l).includes(k)));
  const extras = cleanLines(form.features).filter((f) => !/\d/.test(f) && !covered.some((k) => norm(f).includes(k)));
  return { lines, extras, hiddenExtras: cleanLines(form.features).filter((f) => !extras.includes(f)) };
}

// Fechas del periodo de estadísticas (YYYY-MM-DD, "to" inclusivo como pide /admin/plan-stats). Van en días LOCALES: el
// servidor los interpreta en la zona horaria del sitio (la del negocio, igual que el dashboard), así que en Cuba lo pagado
// de noche ya cae en "hoy". Con días UTC la ventana se corría un día por la noche.
export function periodRange(days) {
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1));
  return { from: fmt(from), to: fmt(to) };
}
