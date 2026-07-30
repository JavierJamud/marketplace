import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Heart, Mail } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SuggestionBox } from "../../components/SuggestionBox.jsx";
import { ProductCard } from "../../components/ProductCard.jsx";
import { StoreCard } from "../../components/StoreCard.jsx";
import { ChangeEmailModal } from "../../components/ChangeEmailModal.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Mismos labels/colores que VendorOrders.jsx para consistencia visual, sin
// los controles de gestión (ese panel es del vendedor, este es de lectura).
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#0A8F42", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };
const NOTIFICATION_LABEL = { WHATSAPP: "Aviso por WhatsApp", PANEL: "Aviso por Panel" };

const TABS = [
  { id: "orders", label: "Mis pedidos" },
  { id: "wishlist", label: "Favoritos" },
  { id: "addresses", label: "Direcciones" },
  { id: "profile", label: "Perfil" },
  { id: "suggestions", label: "Sugerencias" },
];

export default function CustomerPanel() {
  // Bloque 60: la sesión/rol ya se validó un nivel arriba (ver
  // ProtectedRoute en App.jsx) — nunca hay que volver a chequear acá.
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("orders");

  const [profileForm, setProfileForm] = useState({ fullName: "", phone: "" });
  const [addressForm, setAddressForm] = useState({ provinceId: "", address: "" });
  const [changingEmail, setChangingEmail] = useState(false);

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ["my-customer-profile"],
    queryFn: async () => (await api.get("/customers/me")).data.customer,
    enabled: !!user,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["my-customer-orders"],
    queryFn: async () => (await api.get("/customers/me/orders")).data.orders,
    enabled: !!user,
  });

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Misma queryKey que Store.jsx (el botón de corazón ahí) — comparten
  // cache, así que favoritear desde la tienda y venir acá no pide de nuevo.
  const { data: favorites, isLoading: favoritesLoading } = useQuery({
    queryKey: ["my-favorites"],
    queryFn: async () => (await api.get("/customers/me/favorites")).data.favorites,
    enabled: !!user && tab === "wishlist",
  });

  const removeFavorite = useMutation({
    mutationFn: async (id) => (await api.delete(`/customers/me/favorites/${id}`)).data,
    onSuccess: () => {
      toast.success("Se quitó de tus favoritos.");
      queryClient.invalidateQueries({ queryKey: ["my-favorites"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo quitar de favoritos."),
  });

  useEffect(() => {
    if (!customer) return;
    setProfileForm({ fullName: customer.fullName ?? "", phone: customer.phone ?? "" });
    setAddressForm({ provinceId: customer.provinceId ?? "", address: customer.address ?? "" });
  }, [customer]);

  const saveProfile = useMutation({
    mutationFn: async () => (await api.patch("/customers/me", profileForm)).data.customer,
    onSuccess: () => {
      toast.success("Perfil actualizado.");
      queryClient.invalidateQueries({ queryKey: ["my-customer-profile"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const saveAddress = useMutation({
    mutationFn: async () => (await api.patch("/customers/me", addressForm)).data.customer,
    onSuccess: () => {
      toast.success("Dirección actualizada.");
      queryClient.invalidateQueries({ queryKey: ["my-customer-profile"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  return (
    <div className="container-app grid grid-cols-1 gap-8 py-9 lg:grid-cols-[250px_1fr] lg:items-start">
      {/* SIDEBAR */}
      <aside className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
        <div className="mb-5 flex items-center gap-3 border-b border-surface-container-high pb-[18px]">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent font-display text-[17px] font-bold text-white">
            {customer?.fullName?.[0] ?? user.email[0].toUpperCase()}
          </div>
          <div>
            <div className="text-[14px] font-bold text-on-surface">{customer?.fullName ?? user.email}</div>
            <div className="text-[12px] text-outline">{customer?.province?.name ?? "Cuba"}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3.5 py-2.5 text-left text-[13.5px] font-bold ${
                tab === t.id ? "bg-primary-container text-white" : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="mt-4 w-full rounded-md px-3.5 py-2.5 text-left text-[13px] font-semibold text-error hover:bg-error/5"
        >
          Cerrar sesión
        </button>
      </aside>

      {/* CONTENT */}
      <div>
        {tab === "orders" && (
          <div>
            <h1 className="mb-5 font-display text-headline-md text-on-surface">Mis pedidos</h1>
            {ordersLoading && <p className="text-body-md text-on-surface-variant">Cargando pedidos...</p>}
            {!ordersLoading && orders?.length === 0 && (
              <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest py-16 text-center text-body-md text-on-surface-variant">
                Todavía no hiciste ningún pedido.
              </div>
            )}
            <div className="flex flex-col gap-3.5">
              {orders?.map((o) => (
                <div key={o.id} className="rounded-[14px] border border-surface-container-high bg-surface-container-lowest p-5">
                  <div className="flex flex-wrap items-center gap-[18px]">
                    <div className="min-w-[200px] flex-1">
                      <div className="text-[14px] font-bold text-on-surface">
                        {o.code} · {o.vendor.companyName}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-outline">
                        {new Date(o.createdAt).toLocaleString("es-CU")} · {CHANNEL_LABEL[o.channel] ?? o.channel}
                        {o.notificationChannel && ` · ${NOTIFICATION_LABEL[o.notificationChannel]}`}
                      </div>
                    </div>
                    <div className="text-[14px] font-bold text-on-surface">{fmtCUP(o.total)}</div>
                    <span
                      className="rounded-full px-3 py-1.5 text-[11.5px] font-bold"
                      style={{ background: `${STATUS_COLOR[o.status]}1f`, color: STATUS_COLOR[o.status] }}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-1 border-t border-surface-container pt-3">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between text-[12.5px] text-on-surface-variant">
                        <span>{it.quantity}× {it.name}</span>
                        <span>{fmtCUP(Number(it.price) * it.quantity)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "wishlist" && (() => {
          const storeFavorites = favorites?.filter((f) => f.vendorId) ?? [];
          const productFavorites = favorites?.filter((f) => f.productId) ?? [];
          return (
            <div>
              <h1 className="mb-5 font-display text-headline-md text-on-surface">Favoritos</h1>
              {favoritesLoading && <p className="text-body-md text-on-surface-variant">Cargando favoritos...</p>}
              {!favoritesLoading && !favorites?.length && (
                <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest py-16 text-center text-body-md text-on-surface-variant">
                  Todavía no guardaste tiendas ni productos favoritos.
                </div>
              )}

              {storeFavorites.length > 0 && (
                <div className="mb-8">
                  <h2 className="mb-3.5 text-label-md font-bold text-on-surface-variant">Tiendas ({storeFavorites.length})</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {storeFavorites.map((f) => (
                      <div key={f.id} className="relative">
                        <button
                          onClick={() => removeFavorite.mutate(f.id)}
                          disabled={removeFavorite.isPending}
                          aria-label="Quitar de favoritos"
                          className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 disabled:opacity-50"
                        >
                          <Heart className="h-4 w-4 fill-white" />
                        </button>
                        <StoreCard vendor={f.vendor} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {productFavorites.length > 0 && (
                <div>
                  <h2 className="mb-3.5 text-label-md font-bold text-on-surface-variant">Productos ({productFavorites.length})</h2>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {productFavorites.map((f) => (
                      <div key={f.id} className="relative">
                        <button
                          onClick={() => removeFavorite.mutate(f.id)}
                          disabled={removeFavorite.isPending}
                          aria-label="Quitar de favoritos"
                          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 disabled:opacity-50"
                        >
                          <Heart className="h-4 w-4 fill-white" />
                        </button>
                        <ProductCard product={f.product} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {tab === "addresses" && (
          <div>
            <h1 className="mb-5 font-display text-headline-md text-on-surface">Mis direcciones</h1>
            <div className="max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              {customerLoading ? (
                <Spinner />
              ) : (
                <div className="flex flex-col gap-3.5">
                  <Select label="Provincia" value={addressForm.provinceId} onChange={(e) => setAddressForm({ ...addressForm, provinceId: e.target.value })}>
                    <option value="">Sin especificar</option>
                    {provinces?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <div>
                    <span className="mb-1 block text-label-md text-on-surface-variant">Dirección</span>
                    <textarea
                      value={addressForm.address}
                      onChange={(e) => setAddressForm({ ...addressForm, address: e.target.value })}
                      placeholder="Municipio, calle, número, referencias..."
                      className="min-h-[80px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none"
                    />
                  </div>
                  <Button className="w-full" onClick={() => saveAddress.mutate()} disabled={saveAddress.isPending}>
                    {saveAddress.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "suggestions" && (
          <div>
            <h1 className="mb-5 font-display text-headline-md text-on-surface">Sugerencias</h1>
            <div className="max-w-[560px]">
              <SuggestionBox />
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div>
            <h1 className="mb-5 font-display text-headline-md text-on-surface">Mi perfil</h1>

            <div className="mb-5 max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
                <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
              </div>
              <p className="mb-4 text-[13.5px] text-on-surface-variant">{customer?.email}</p>
              <Button variant="outline" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
            </div>

            <div className="max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              {customerLoading ? (
                <Spinner />
              ) : (
                <div className="flex flex-col gap-3.5">
                  <Input label="Nombre completo" value={profileForm.fullName} onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })} />
                  <Input label="Teléfono" value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />
                  <Button className="w-full" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              )}
            </div>

            {changingEmail && <ChangeEmailModal currentEmail={customer?.email} onClose={() => setChangingEmail(false)} />}
          </div>
        )}
      </div>
    </div>
  );
}
