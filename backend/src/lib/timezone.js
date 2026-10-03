// Bloque 237 (pedido explícito — tope diario de "Venta rápida"): no existía
// en el proyecto ningún helper que devuelva un Date real de "medianoche de
// hoy" en una zona horaria IANA dada. El único parecido, dateStringInTimezone
// en aiHealthCheck.job.js, solo da un string "YYYY-MM-DD" para comparar
// igualdad — no sirve para un filtro `gte` de Prisma. Implementado con
// Intl.DateTimeFormat nativo (no hay ninguna librería de zonas horarias en
// el proyecto, y no hace falta sumar una).

// Offset (ms) entre "la hora de pared en esa zona horaria, leída como si
// fuera UTC" y el instante real — ej. en Cuba (UTC-5) da -5h. Mismo cálculo
// que usan internamente librerías como date-fns-tz.
function getTimezoneOffsetMs(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - instant.getTime();
}

// Medianoche de "hoy" (el día calendario de `date` en `timezone`) como
// instante UTC real, usable directo en un filtro `createdAt: {gte: ...}` de
// Prisma. Única consumidora: customerListings.controller.js (tope diario de
// Venta rápida).
export function startOfDayInTimezone(date, timezone) {
  const dayString = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
  const [year, month, day] = dayString.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMs = getTimezoneOffsetMs(new Date(guess), timezone);
  return new Date(guess - offsetMs);
}
