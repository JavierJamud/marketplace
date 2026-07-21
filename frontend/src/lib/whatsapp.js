export function waLink(phone, text) {
  const digits = String(phone).replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
