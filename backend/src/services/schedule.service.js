// Calcula si una tienda está abierta ahora mismo a partir de su horario
// semanal real (VendorSchedule), no de un booleano fijo.
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Bloque 108 (pedido explícito): nombres reales de día para "Abre el lunes...",
// en el mismo índice que dayOfWeek (0 = domingo, ver el comentario del schema).
const DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// "09:00" -> "9:00 a.m." — mismo formato de 12h que usa el resto del sitio
// de cara al cliente (nunca 24h crudo tipo "09:00", que es lo que guarda la
// DB/el formulario del vendedor).
function formatTime12h(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Bloque 171 (pedido explícito — "si hay varios horarios un mismo día", ej.
// abre 9-12 y cierra al mediodía, reabre 2-6): cada VendorSchedule con
// isClosed:false es UN tramo, no "el" horario del día — un día puede tener
// varios. Agrupa por dayOfWeek, ignorando las filas isClosed:true (esas
// solo existen para marcar explícitamente "este día no abre", nunca aportan
// un tramo real).
function groupRangesByDay(schedules) {
  const byDay = new Map();
  for (const s of schedules) {
    if (s.isClosed) continue;
    if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
    byDay.get(s.dayOfWeek).push(s);
  }
  return byDay;
}

// Bloque 108 (pedido explícito — "las tiendas cerradas deben poner cuándo
// abren"): antes solo devolvía true/false/null. Cuando está cerrada AHORA
// (con horario real cargado), calcula además la frase lista para mostrar —
// "Abre hoy a las 9:00 a.m." si todavía no llegó la hora de abrir hoy,
// "Abre mañana a las..." si ya cerró por hoy (o hoy es día de descanso),
// o "Abre el lunes a las..." (nombre real del día) si el próximo día que
// abre está más lejos que mañana. Recorre hasta 7 días hacia adelante
// (nunca asume que el vendedor carga los 7 — un negocio que solo abre
// martes y viernes también tiene que funcionar bien acá).
// Bloque 171: reescrito para varios tramos por día — "abierto ahora" es
// "cae dentro de CUALQUIER tramo de hoy", y "cuándo abre" busca el tramo
// que empieza más temprano entre los que todavía faltan.
export function isVendorOpenNow(schedules, timezone = "America/Havana") {
  if (!schedules?.length) return { isOpen: null, nextOpenLabel: null };

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const dayOfWeek = DAY_INDEX[parts.find((p) => p.type === "weekday").value];
  const nowMinutes = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  const rangesByDay = groupRangesByDay(schedules);
  const todayRanges = rangesByDay.get(dayOfWeek) ?? [];

  for (const r of todayRanges) {
    const opens = minutesOf(r.opensAt);
    const closes = minutesOf(r.closesAt);
    if (nowMinutes >= opens && nowMinutes < closes) return { isOpen: true, nextOpenLabel: null };
  }

  // Todavía no llegó la hora de algún tramo de hoy — el que abre más
  // temprano de los que faltan (ej. si ya pasó el de la mañana pero falta
  // el de la tarde, ese es el que hay que anunciar).
  const upcomingToday = todayRanges
    .filter((r) => minutesOf(r.opensAt) > nowMinutes)
    .sort((a, b) => minutesOf(a.opensAt) - minutesOf(b.opensAt))[0];
  if (upcomingToday) return { isOpen: false, nextOpenLabel: `Abre hoy a las ${formatTime12h(upcomingToday.opensAt)}` };

  // Ya cerró por hoy (o el día de hoy es de descanso) — busca el próximo
  // día real que abra, empezando por mañana.
  for (let offset = 1; offset <= 7; offset++) {
    const checkDay = (dayOfWeek + offset) % 7;
    const dayRanges = rangesByDay.get(checkDay) ?? [];
    if (dayRanges.length > 0) {
      const earliest = [...dayRanges].sort((a, b) => minutesOf(a.opensAt) - minutesOf(b.opensAt))[0];
      const when = offset === 1 ? "mañana" : `el ${DAY_NAMES_ES[checkDay]}`;
      return { isOpen: false, nextOpenLabel: `Abre ${when} a las ${formatTime12h(earliest.opensAt)}` };
    }
  }

  // Ningún día de la semana tiene horario real cargado — no hay nada que anunciar.
  return { isOpen: false, nextOpenLabel: null };
}
