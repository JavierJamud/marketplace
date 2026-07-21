// Calcula si una tienda está abierta ahora mismo a partir de su horario
// semanal real (VendorSchedule), no de un booleano fijo.
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isVendorOpenNow(schedules, timezone = "America/Havana") {
  if (!schedules?.length) return { isOpen: null };

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const dayOfWeek = DAY_INDEX[parts.find((p) => p.type === "weekday").value];
  const nowMinutes = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);

  const today = schedules.find((s) => s.dayOfWeek === dayOfWeek);
  if (!today || today.isClosed) return { isOpen: false };

  const [oh, om] = today.opensAt.split(":").map(Number);
  const [ch, cm] = today.closesAt.split(":").map(Number);
  const opens = oh * 60 + om;
  const closes = ch * 60 + cm;

  return { isOpen: nowMinutes >= opens && nowMinutes < closes };
}
