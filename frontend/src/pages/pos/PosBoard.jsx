import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChefHat, PackageCheck } from "lucide-react";
import { api } from "../../lib/api.js";
import { imgUrl } from "../../lib/imgUrl.js";
import { readableAccent } from "../../lib/readableAccent.js";
import { ScreenClock } from "../../components/pos/ScreenClock.jsx";

// Tablero de pedidos (monitor en el local), abierto con el enlace secreto del panel > Caja > Pantallas. Se actualiza cada
// 2 segundos. Cada pedido muestra su número, a nombre de quién está, qué lleva y desde cuándo. Los listos se destacan (los
// recién listos, con un brillo durante unos segundos) y salen solos al recogerse o pasado el tiempo que eligió la tienda.
const JUST_READY_MS = 20 * 1000;

function useNow(everyMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const minutesSince = (d, now) => Math.max(0, Math.floor((now - new Date(d).getTime()) / 60000));
const sinceText = (d, now, prefix) => {
  const m = minutesSince(d, now);
  return m < 1 ? `${prefix} ahora` : `${prefix} hace ${m} min`;
};

function OrderCard({ order, ready, accent, now }) {
  const justReady = ready && order.readyAt && now - new Date(order.readyAt).getTime() < JUST_READY_MS;
  return (
    <li
      className={`min-w-0 rounded-2xl p-4 ${ready ? "bg-white text-[#0e1a28]" : "bg-white/[0.07] text-white"} ${justReady ? "ring-4 motion-safe:animate-pulse" : ""}`}
      style={justReady ? { "--tw-ring-color": accent } : undefined}
    >
      <p className="font-display text-[40px] font-extrabold leading-none tracking-[0.1em]">{order.code}</p>
      <p className={`mt-1 truncate text-[22px] font-bold ${order.name ? "" : ready ? "text-[#0e1a28]/45" : "text-white/40"}`}>{order.name || "Sin nombre"}</p>
      <ul className={`mt-2 space-y-0.5 text-[15px] ${ready ? "text-[#0e1a28]/75" : "text-white/70"}`}>
        {order.summary.map((line) => (
          <li key={line} className="truncate">
            {line}
          </li>
        ))}
        {order.more > 0 && <li>y {order.more} más</li>}
      </ul>
      <p className={`mt-2 text-[14px] font-semibold ${ready ? "text-[#0e1a28]/60" : "text-white/55"}`}>
        {ready ? sinceText(order.readyAt, now, "Listo") : sinceText(order.paidAt, now, "Pedido")}
      </p>
    </li>
  );
}

function Column({ title, icon: Icon, orders, ready, accent, now }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-3xl bg-white/[0.04] p-5" aria-label={title}>
      <h2 className="mb-4 flex items-center gap-3 text-[28px] font-extrabold" style={ready ? { color: accent } : undefined}>
        <Icon className="h-8 w-8" aria-hidden="true" /> {title}
        <span className="ml-auto rounded-full bg-white/10 px-3 py-0.5 text-[20px] text-white">{orders.length}</span>
      </h2>
      {orders.length === 0 ? (
        <p className="text-[19px] text-white/50">{ready ? "Cuando un pedido esté listo, aparece aquí." : "No hay pedidos en preparación."}</p>
      ) : (
        <ul className="-m-1 grid min-h-0 grid-cols-1 content-start gap-3 overflow-y-auto overflow-x-hidden p-1 sm:grid-cols-2 2xl:grid-cols-3">
          {orders.map((o) => (
            <OrderCard key={o.code} order={o} ready={ready} accent={accent} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PosBoard() {
  const { token } = useParams();
  const now = useNow(15000);
  const { data, error } = useQuery({
    queryKey: ["pos-board", token],
    queryFn: async () => (await api.get(`/pos/board/${token}`)).data,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    retry: (count, err) => err?.response?.status !== 404 && count < 3,
  });
  useEffect(() => {
    document.title = data?.vendor?.name ? `${data.vendor.name} · Pedidos` : "Pedidos";
  }, [data?.vendor?.name]);

  if (error?.response?.status === 404) {
    return <div className="fixed inset-0 flex items-center justify-center bg-[#0e1a28] px-6 text-center text-[18px] text-white/85">{error.response.data?.error ?? "Este enlace ya no es válido."}</div>;
  }
  if (!data) return <div className="fixed inset-0 flex items-center justify-center bg-[#0e1a28] text-[18px] text-white/70">Conectando...</div>;
  const accent = readableAccent(data.vendor.color);

  return (
    <div className="fixed inset-0 flex flex-col gap-4 bg-[#0e1a28] p-5 text-white">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {data.vendor.logoUrl && <img src={imgUrl(data.vendor.logoUrl)} alt="" className="h-14 w-14 flex-shrink-0 rounded-full bg-white object-cover" />}
          <div className="min-w-0">
            <p className="truncate font-display text-[26px] font-extrabold">{data.vendor.name}</p>
            <p className="text-[15px] text-white/60">Pedidos de hoy</p>
          </div>
        </div>
        <ScreenClock timezone={data.vendor.timezone} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        <Column title="Preparando" icon={ChefHat} orders={data.preparing} accent={accent} now={now} />
        <Column title="Listos para recoger" icon={PackageCheck} orders={data.ready} ready accent={accent} now={now} />
      </div>
      <p className="text-center text-[14px] text-white/45">Los pedidos listos salen de esta pantalla al recogerse o a los {data.readyAutoClearMinutes} minutos.</p>
    </div>
  );
}
