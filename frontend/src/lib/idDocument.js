// Documento de identidad de quien recibe un pedido. Mismas reglas que el servidor (backend/src/lib/orderSummary.js):
//  - CU_ID, carné de identidad cubano: 11 números; los 6 primeros son la fecha de nacimiento (AAMMDD) y tiene que existir.
//  - OTHER, pasaporte u otro documento: 6 a 20 letras o números.
export const ID_TYPES = [
  { id: "CU_ID", label: "Carné de identidad (Cuba)" },
  { id: "OTHER", label: "Pasaporte u otro documento" },
];
export const ID_TYPE_LABEL = { CU_ID: "Carné de identidad", OTHER: "Documento" };

export function isValidCubanId(value) {
  const v = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(v)) return false;
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  const dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1) return false;
  const c = Number(v[6]);
  const year = (c === 9 ? 1800 : c <= 5 ? 1900 : 2000) + yy;
  return dd <= new Date(Date.UTC(year, mm, 0)).getUTCDate();
}

export const isValidOtherId = (value) => /^[A-Za-z0-9]{6,20}$/.test(String(value ?? "").replace(/\s+/g, ""));

export function idError(type, value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (type === "CU_ID") return isValidCubanId(v) ? null : "Son 11 números y los 6 primeros forman la fecha de nacimiento (AAMMDD).";
  return isValidOtherId(v) ? null : "Entre 6 y 20 letras o números, sin espacios ni signos.";
}

export const isValidId = (type, value) => !!String(value ?? "").trim() && !idError(type, value);
