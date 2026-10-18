import { useEffect, useState } from "react";

// Fecha y hora para las pantallas del local, en la zona horaria de la tienda. Se actualiza cada segundo.
export function ScreenClock({ timezone, className = "" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const opts = { timeZone: timezone || undefined };
  const raw = now.toLocaleDateString("es-CU", { ...opts, weekday: "long", day: "numeric", month: "long" });
  const date = raw.charAt(0).toUpperCase() + raw.slice(1);
  const time = now.toLocaleTimeString("es-CU", { ...opts, hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`text-right ${className}`}>
      <p className="font-display text-[30px] font-extrabold leading-none tabular-nums text-white sm:text-[36px]">{time}</p>
      <p className="mt-1 text-[14px] text-white/70 sm:text-[16px]">{date}</p>
    </div>
  );
}
