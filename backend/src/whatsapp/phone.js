// Los teléfonos se guardan en formato internacional ("+5355512345"). Para comparar y para WhatsApp solo importan los dígitos.
export function digitsOf(phone) {
  return String(phone ?? "").replace(/\D/g, "");
}

export function normalizePhone(phone) {
  const digits = digitsOf(phone);
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function samePhone(a, b) {
  const x = digitsOf(a);
  return x.length >= 8 && x === digitsOf(b);
}
