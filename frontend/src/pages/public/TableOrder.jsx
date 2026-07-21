import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Minus, UtensilsCrossed } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { SuccessCheck } from "../../components/ui/SuccessCheck.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Página que ve el cliente al escanear el QR real de su mesa (sin cuenta).
export default function TableOrder() {
  const { qrToken } = useParams();
  const [cart, setCart] = useState({}); // { productId: quantity }
  const [customerEmail, setCustomerEmail] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const { data: table, isLoading } = useQuery({
    queryKey: ["table", qrToken],
    queryFn: async () => (await api.get(`/tables/qr/${qrToken}`)).data.table,
  });

  const placeOrder = useMutation({
    mutationFn: async () => {
      const items = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([productId, quantity]) => {
          const product = table.vendor.products.find((p) => p.id === productId);
          return { productId, name: product.name, quantity, price: Number(product.price) };
        });
      return (await api.post(`/tables/qr/${qrToken}/order`, { items, customerEmail })).data;
    },
    onSuccess: () => {
      setCart({});
      setShowSuccess(true);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el pedido."),
  });

  if (isLoading) return <div className="container-app py-14 text-center text-body-md text-on-surface-variant">Cargando menú...</div>;

  if (!table) {
    return (
      <div className="container-app py-14">
        <EmptyState icon={UtensilsCrossed} title="Mesa no encontrada" description="Este código QR no corresponde a ninguna mesa activa." />
      </div>
    );
  }

  const total = Object.entries(cart).reduce((sum, [productId, qty]) => {
    const product = table.vendor.products.find((p) => p.id === productId);
    return sum + (product ? Number(product.price) * qty : 0);
  }, 0);
  const validEmail = EMAIL_REGEX.test(customerEmail);

  return (
    <div>
      {showSuccess && (
        <SuccessCheck
          title="¡Pedido enviado a la cocina!"
          message={`Te avisamos por correo cuando esté preparando y listo — ${table.vendor.companyName}.`}
          onDone={() => setShowSuccess(false)}
        />
      )}

      {/* Encabezado de la tienda — mismo tratamiento visual que Store.jsx,
          para que el menú QR se sienta parte de la misma tienda y no una
          vista aparte y reducida. */}
      <div style={{ background: table.vendor.color ?? "#232F3E" }}>
        <div className="container-app flex max-w-lg items-center gap-4 py-8">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border-2 border-white/40 bg-white/10 font-display text-2xl font-extrabold text-white">
            {table.vendor.companyName[0]}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-headline-md text-white">{table.vendor.companyName}</h1>
            {table.vendor.description && <p className="mt-1 text-[13px] leading-[18px] text-white/80">{table.vendor.description}</p>}
            <p className="mt-1.5 text-label-sm font-bold text-secondary-container">Mesa {table.tableNumber}</p>
          </div>
        </div>
      </div>

      <div className="container-app max-w-lg py-8">
        <div className="space-y-3">
          {table.vendor.products.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border border-surface-container-high bg-surface-container-lowest p-3.5">
              <div>
                <p className="text-body-md font-semibold text-on-surface">{p.name}</p>
                <p className="text-label-sm text-outline">{fmtCUP(p.price)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border border-outline-variant p-1.5"
                  onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center">{cart[p.id] ?? 0}</span>
                <button
                  className="rounded border border-outline-variant p-1.5"
                  onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {table.vendor.products.length === 0 && (
            <p className="text-body-md text-on-surface-variant">Este restaurante todavía no habilitó productos para el menú QR.</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-surface-container-high pt-4">
          <p className="text-title-lg text-on-surface">Total</p>
          <p className="text-headline-md text-primary">{fmtCUP(total)}</p>
        </div>

        <div className="mt-4">
          <Input
            label="Tu correo (para avisarte el estado del pedido)"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="tu@correo.com"
            required
          />
        </div>

        <Button
          size="lg"
          className="mt-4 w-full"
          disabled={total === 0 || !validEmail || placeOrder.isPending}
          onClick={() => placeOrder.mutate()}
        >
          {placeOrder.isPending ? "Enviando..." : "Enviar pedido a cocina"}
        </Button>
      </div>
    </div>
  );
}
