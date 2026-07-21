import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";

// Mismo algoritmo determinístico del mockup VendorTables.dc.html — un patrón
// decorativo (no un QR real escaneable), semilla en el token real de la mesa.
function DecorativeQr({ seed }) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) & 0xffffffff;
  function rnd() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  }
  const n = 11;
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rnd() > 0.5) cells.push([x, y]);
  const finder = (fx, fy) => (
    <g key={`${fx}-${fy}`}>
      <rect x={fx} y={fy} width={3} height={3} fill="#0e1a28" />
      <rect x={fx + 1} y={fy + 1} width={1} height={1} fill="#fff" />
    </g>
  );
  return (
    <svg viewBox="0 0 11 11" width="100%" height="100%" shapeRendering="crispEdges">
      <g fill="#0e1a28">
        {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />)}
      </g>
      {finder(0, 0)}
      {finder(8, 0)}
      {finder(0, 8)}
    </svg>
  );
}

export default function VendorTables() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["my-tables"],
    queryFn: async () => (await api.get("/tables/me")).data.tables,
  });

  const addTable = useMutation({
    mutationFn: async () => (await api.post("/tables/me")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-tables"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo agregar la mesa."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando mesas...</p>;

  return (
    <div>
      <div className="mb-[22px] flex items-center justify-between">
        <div>
          <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Mesas y códigos QR</h1>
          <p className="text-[13.5px] text-outline">Cada mesa tiene un QR único. El cliente escanea → ve el menú → pide.</p>
        </div>
        <button
          onClick={() => addTable.mutate()}
          disabled={addTable.isPending}
          className="rounded-md bg-secondary-container px-[18px] py-2.5 text-[13.5px] font-bold text-on-secondary-container"
        >
          + Agregar mesa
        </button>
      </div>

      <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 lg:grid-cols-4">
        {data?.map((t) => {
          const occupied = t.tableOrders.length > 0;
          return (
            <div key={t.id} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5 text-center">
              <div className="mb-3.5 flex items-center justify-between">
                <span className="font-display text-base font-bold text-on-surface">Mesa {t.tableNumber}</span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold"
                  style={occupied ? { background: "rgba(138,81,0,0.12)", color: "#8A5100" } : { background: "rgba(12,174,83,0.12)", color: "#0A8F42" }}
                >
                  {occupied ? "Ocupada" : "Libre"}
                </span>
              </div>
              <div className="mx-auto mb-3 h-[118px] w-[118px] rounded-md border border-surface-container-high bg-white p-2">
                <DecorativeQr seed={`table-${t.qrToken}`} />
              </div>
              <div className="mb-3 truncate text-[11.5px] text-outline" title={t.qrToken}>{t.qrToken}</div>
              <div className="flex gap-2">
                <Link to={`/mesa/${t.qrToken}`} target="_blank" className="flex-1 rounded-[7px] bg-primary-container py-2 text-[12px] font-semibold text-white">
                  Ver menú
                </Link>
                <button onClick={() => window.print()} className="flex-1 rounded-[7px] bg-surface-container py-2 text-[12px] font-semibold text-on-surface-variant">
                  Imprimir QR
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
