import { WelcomeHeading, WeeklySummaryCard } from "../../components/WelcomeSummary.jsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Heart, Mail, Package, Pencil, Trash2, CheckCircle2, X as XIcon, ShieldAlert, Clock, Camera } from "lucide-react";
import { api, getErrorMessage } from "../../lib/api.js";
import { useAuth, loginPathFor } from "../../context/AuthContext.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
import { LocationPicker } from "../../components/LocationPicker.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { ConditionPicker, TagsInput, PriceTiersEditor } from "../../components/customer/ListingFormFields.jsx";
import { SuggestionBox } from "../../components/SuggestionBox.jsx";
import { ProductCard, ProductGridSkeleton } from "../../components/ProductCard.jsx";
import { StoreCard } from "../../components/StoreCard.jsx";
import { ChangeEmailModal } from "../../components/ChangeEmailModal.jsx";
import TwoFactorCard from "../../components/TwoFactorCard.jsx";
import { ImageCropUploader } from "../../components/ImageCropUploader.jsx";
import { compressImage } from "../../utils/compressImage.js";
import { formatPrice } from "../../lib/format.js";
import { AccountPendingDeletionNotice, deletionScheduledFor } from "../../components/AccountPendingDeletionNotice.jsx";
import { DeleteAccountCard } from "../../components/DeleteAccountCard.jsx";
import { CancelOrderModal, CancelBlockedModal, EditOrderModal } from "../../components/customer/CustomerOrderActions.jsx";
import { NotificationSettings } from "../../components/pwa/NotificationSettings.jsx";
import { APPS } from "../../lib/pwa.js";
import { MyPoints } from "../../components/customer/MyPoints.jsx";
import { EmailPreferencesCard } from "../../components/customer/EmailPreferencesCard.jsx";
import { ReportsCenter } from "../../components/reports/ReportsCenter.jsx";
import { CardListSkeleton, FormSkeleton } from "../../components/ui/Skeleton.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Mismos labels/colores que VendorOrders.jsx para consistencia visual, sin
// los controles de gestión (ese panel es del vendedor, este es de lectura).
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#087A38", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };
// BOTH = la tienda recibe el aviso por WhatsApp y por el panel (Vendor.orderDestination).
const NOTIFICATION_LABEL = { WHATSAPP: "Aviso por WhatsApp", PANEL: "Aviso por Panel", BOTH: "Aviso por WhatsApp y Panel" };

const TABS = [
  { id: "orders", label: "Mis pedidos" },
  { id: "quick-sale", label: "Venta rápida" },
  { id: "wishlist", label: "Favoritos" },
  { id: "points", label: "Mis puntos" },
  { id: "addresses", label: "Direcciones" },
  { id: "profile", label: "Perfil" },
  // Lo que reportaste y lo que te reportaron (ventas rápidas), con su estado. Ver ReportsCenter.jsx.
  { id: "reports", label: "Reportes" },
  { id: "suggestions", label: "Sugerencias" },
];

const LISTING_NAME_MAX = 80;
const LISTING_DESC_MAX = 1000;
const LISTING_EMPTY_FORM = { name: "", description: "", price: "", currency: "USD", condition: "", quantity: "", priceTiers: [], tags: [], showOwnerName: false, locationNote: "", countryId: "", countryOther: "", provinceId: "", municipalityId: "", municipalityOther: "", stateOther: "" };
const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(dateStr) {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / DAY_MS));
}

// Bloque 237 (pedido explícito): el backend ya manda horas/minutos
// implícitos en nextDailyResetAt — acá solo se traduce a texto, nunca al
// revés. "Puedes publicar de nuevo en Xh Ymin, a las HH:MM" en vez de un
// genérico "probá mañana".
function dailyLimitMessage(dailyLimit, nextDailyResetAt) {
  const diffMs = Math.max(0, new Date(nextDailyResetAt).getTime() - Date.now());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  const timeLabel = new Date(nextDailyResetAt).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" });
  const parts = [hours > 0 ? `${hours}h` : null, `${minutes}min`].filter(Boolean).join(" ");
  return `Ya publicaste tus ${dailyLimit} anuncios de hoy. Puedes publicar de nuevo en ${parts}, a las ${timeLabel}.`;
}

export default function CustomerPanel() {
  // Bloque 60: la sesión/rol ya se validó un nivel arriba (ver
  // ProtectedRoute en App.jsx) — nunca hay que volver a chequear acá.
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  // Se puede abrir directo una pestaña con /cuenta/panel?tab=quick-sale (por ejemplo, desde la portada).
  const [tab, setTab] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((x) => x.id === wanted) ? wanted : "orders";
  });
  // En el celular las pestañas van en una fila deslizable: se centra la activa (por ejemplo, al entrar con ?tab=reports) sin
  // mover la página, solo la fila.
  const tabsNavRef = useRef(null);
  useEffect(() => {
    const nav = tabsNavRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2, behavior: "smooth" });
  }, [tab]);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [orderToEdit, setOrderToEdit] = useState(null);
  const [orderBlocked, setOrderBlocked] = useState(null);

  const [profileForm, setProfileForm] = useState({ fullName: "", phone: "", country: "" });
  // Ubicación del perfil (país, provincia o estado, municipio, dirección): sin ella no se puede publicar una venta rápida.
  const [locForm, setLocForm] = useState({ registrationCountryId: "", registrationCountryOther: "", provinceId: "", municipalityId: "", municipalityOther: "", stateOther: "", address: "" });
  const [locStatus, setLocStatus] = useState({ error: null, needsAddress: false });
  const [addressForm, setAddressForm] = useState({ provinceId: "", address: "" });
  const [changingEmail, setChangingEmail] = useState(false);
  const [listingModalOpen, setListingModalOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(null);
  const [listingForm, setListingForm] = useState(LISTING_EMPTY_FORM);
  const [savedListing, setSavedListing] = useState(null);
  const [listingLocStatus, setListingLocStatus] = useState({ error: null, needsAddress: false });
  const [deleteListingTarget, setDeleteListingTarget] = useState(null);

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ["my-customer-profile"],
    queryFn: async () => (await api.get("/customers/me")).data.customer,
    enabled: !!user,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["my-customer-orders"],
    queryFn: async () => (await api.get("/customers/me/orders")).data.orders,
    enabled: !!user,
    refetchInterval: tab === "orders" ? 8000 : false,
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

  // --- Venta rápida (clientes sin tienda) -----------------------------------
  // Bloque 237: el endpoint ahora manda, junto a los anuncios, el tope
  // activo/diario vigentes y cuántos ya publicó hoy — se guarda la
  // respuesta completa (no solo .listings) para poder armar el botón
  // bloqueado + la cuenta regresiva sin duplicar la lógica de "qué día es"
  // del backend.
  const { data: listingsData, isLoading: listingsLoading } = useQuery({
    queryKey: ["my-customer-listings"],
    queryFn: async () => (await api.get("/customer-listings/me/list")).data,
    enabled: !!user && tab === "quick-sale",
  });
  const listings = listingsData?.listings;

  const { data: siteSettings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    enabled: tab === "quick-sale",
  });

  const listingLimit = listingsData?.limit ?? siteSettings?.maxActiveListingsPerCustomer ?? 6;
  const dailyLimit = listingsData?.dailyLimit ?? siteSettings?.maxNewListingsPerDay ?? 2;
  const visibilityDays = siteSettings?.listingPublicVisibilityDays ?? 15;
  const expiryDaysSetting = siteSettings?.listingExpiryDays ?? 30;
  const maxImages = siteSettings?.maxListingImages ?? 5;
  const canCreateToday = listingsData ? listingsData.createdToday < listingsData.dailyLimit : true;
  const totalLimitReached = (listings?.length ?? 0) >= listingLimit;

  // Para publicar hacen falta teléfono, país y provincia o estado en el perfil (ver profileLocationMissing en el servidor).
  const profileMissing = customer
    ? [
        !customer.phone?.trim() && "teléfono",
      ].filter(Boolean)
    : [];

  function handleCreateListingClick() {
    if (profileMissing.length) {
      toast.error(`Completa tu ${profileMissing.join(", ")} en el perfil para publicar.`);
      setTab("profile");
      return;
    }
    if (totalLimitReached) return;
    if (!canCreateToday) {
      toast.error(dailyLimitMessage(dailyLimit, listingsData.nextDailyResetAt));
      return;
    }
    openCreateListing();
  }

  // Feature B (pedido explícito): banner inline en esta misma tab (no una
  // tab nueva, para no inflar el panel con algo casi siempre vacío) si
  // alguno de sus anuncios fue reportado y está esperando su respuesta.
  const { data: myFraudReports } = useQuery({
    queryKey: ["my-fraud-reports"],
    queryFn: async () => (await api.get("/reports/me/list")).data.reports,
    enabled: !!user && tab === "quick-sale",
  });
  const pendingListingReports = (myFraudReports ?? []).filter((r) => r.customerListing && r.status === "EVIDENCE_REQUESTED" && !r.evidenceSentAt);
  const [evidenceDrafts, setEvidenceDrafts] = useState({});
  function updateEvidenceDraft(id, patch) {
    setEvidenceDrafts((prev) => ({ ...prev, [id]: { message: "", files: [], ...prev[id], ...patch } }));
  }
  const submitListingEvidence = useMutation({
    mutationFn: async ({ id, message, files }) => {
      const form = new FormData();
      form.append("evidenceMessage", message);
      files.forEach((f) => form.append("evidence", f));
      return (await api.post(`/reports/${id}/evidence`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (_, { id }) => {
      toast.success("Respuesta enviada — el admin la va a revisar.");
      setEvidenceDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      queryClient.invalidateQueries({ queryKey: ["my-fraud-reports"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo enviar tu respuesta.")),
  });

  function openCreateListing() {
    setEditingListing(null);
    // El lugar del anuncio arranca con el del perfil; se puede cambiar si el artículo está en otra provincia, estado o país.
    setListingForm({
      ...LISTING_EMPTY_FORM,
      countryId: customer?.registrationCountryId ?? customer?.province?.countryId ?? "",
      provinceId: customer?.provinceId ?? "",
      municipalityId: customer?.municipalityId ?? "",
      stateOther: customer?.stateOther ?? "",
    });
    setSavedListing(null);
    setListingModalOpen(true);
  }

  function openEditListing(listing) {
    setEditingListing(listing);
    setListingForm({
      name: listing.name,
      description: listing.description,
      price: listing.price,
      currency: listing.currency,
      condition: listing.condition ?? "",
      quantity: listing.quantity ?? "",
      priceTiers: (listing.priceTiers ?? []).map((t) => ({ minQty: t.minQty, price: t.price })),
      tags: listing.tags ?? [],
      showOwnerName: !!listing.showOwnerName,
      locationNote: listing.locationNote ?? "",
      countryId: listing.countryId ?? "",
      countryOther: "",
      provinceId: listing.provinceId ?? "",
      municipalityId: listing.municipalityId ?? "",
      municipalityOther: "",
      stateOther: listing.stateOther ?? "",
    });
    setSavedListing(listing);
    setListingModalOpen(true);
  }

  const saveListing = useMutation({
    mutationFn: async () => {
      const payload = {
        name: listingForm.name,
        description: listingForm.description,
        price: Number(listingForm.price),
        currency: listingForm.currency,
        condition: listingForm.condition || null,
        quantity: listingForm.quantity === "" ? null : Number(listingForm.quantity),
        priceTiers: listingForm.priceTiers.filter((t) => t.minQty !== "" && t.price !== "").map((t) => ({ minQty: Number(t.minQty), price: Number(t.price) })),
        tags: listingForm.tags,
        showOwnerName: listingForm.showOwnerName,
        locationNote: listingForm.locationNote.trim() || null,
        countryId: listingForm.countryId || undefined,
        provinceId: listingForm.provinceId || undefined,
        municipalityId: listingForm.municipalityId || undefined,
        municipalityOther: listingForm.municipalityOther.trim() || undefined,
        stateOther: listingForm.stateOther.trim() || undefined,
      };
      if (editingListing) return (await api.patch(`/customer-listings/${editingListing.id}`, payload)).data.listing;
      return (await api.post("/customer-listings", payload)).data.listing;
    },
    onSuccess: (listing) => {
      setSavedListing(listing);
      setEditingListing(listing);
      queryClient.invalidateQueries({ queryKey: ["my-customer-listings"] });
      toast.success(editingListing ? "Anuncio actualizado." : "Anuncio creado — ahora sube al menos una foto.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el anuncio."),
  });

  function handleSaveListing() {
    if (listingForm.countryOther?.trim() || (!listingForm.countryId && !listingForm.provinceId)) {
      toast.error("Elige el país del artículo de la lista.");
      return;
    }
    if (listingLocStatus.error) {
      toast.error(listingLocStatus.error);
      return;
    }
    saveListing.mutate();
  }

  const uploadListingImage = useMutation({
    mutationFn: async (file) => {
      const body = new FormData();
      body.append("images", file);
      return (await api.post(`/customer-listings/${savedListing.id}/images`, body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (data) => {
      setSavedListing(data.listing);
      queryClient.invalidateQueries({ queryKey: ["my-customer-listings"] });
      toast.success("Foto subida — tu anuncio ya está publicado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir la foto."),
  });

  // La foto recortada se comprime en el navegador antes de subirla (ver utils/compressImage.js): llega ya liviana al servidor.
  async function handleListingImage(blob) {
    const file = new File([blob], `listing-${Date.now()}.jpg`, { type: blob.type });
    uploadListingImage.mutate(await compressImage(file, { maxWidth: 1400, quality: 0.82 }));
  }

  // Pedido explícito: la galería de fotos debe verse "casi igual a un
  // producto de tienda" — mismo patrón que VendorProducts.jsx (varias
  // fotos, cada una con su botón de quitar), solo sin arrastrar para
  // reordenar/portada (customerListings.controller.js no tiene ese
  // endpoint, y no es lo que se pidió acá).
  const removeListingImage = useMutation({
    mutationFn: async (url) => (await api.delete(`/customer-listings/${savedListing.id}/images`, { data: { url } })).data,
    onSuccess: (data) => {
      setSavedListing(data.listing);
      queryClient.invalidateQueries({ queryKey: ["my-customer-listings"] });
      toast.success("Foto eliminada.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar la foto."),
  });

  const toggleListingSold = useMutation({
    mutationFn: async (id) => (await api.patch(`/customer-listings/${id}/sold`)).data.listing,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-customer-listings"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  const deleteListing = useMutation({
    mutationFn: async (id) => (await api.delete(`/customer-listings/${id}`)).data,
    onSuccess: () => {
      toast.success("Anuncio eliminado.");
      setDeleteListingTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-customer-listings"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el anuncio.");
      setDeleteListingTarget(null);
    },
  });

  useEffect(() => {
    if (!customer) return;
    setProfileForm({ fullName: customer.fullName ?? "", phone: customer.phone ?? "", country: customer.country ?? "" });
    setLocForm({
      registrationCountryId: customer.registrationCountryId ?? "",
      registrationCountryOther: customer.registrationCountryOther ?? "",
      provinceId: customer.provinceId ?? "",
      municipalityId: customer.municipalityId ?? "",
      municipalityOther: customer.municipalityOther ?? "",
      stateOther: customer.stateOther ?? "",
      address: customer.address ?? "",
    });
    setAddressForm({ provinceId: customer.provinceId ?? "", address: customer.address ?? "" });
  }, [customer]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const f = locForm;
      const body = {
        fullName: profileForm.fullName,
        phone: profileForm.phone,
        country: profileForm.country || undefined,
        registrationCountryId: f.registrationCountryId || undefined,
        registrationCountryOther: f.registrationCountryOther.trim() || undefined,
        provinceId: f.provinceId || undefined,
        municipalityId: f.municipalityId || undefined,
        municipalityOther: f.municipalityOther.trim() || undefined,
        stateOther: f.stateOther.trim() || undefined,
        address: f.address.trim() || undefined,
      };
      return (await api.patch("/customers/me", body)).data.customer;
    },
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

  function handleSaveProfile() {
    if (!profileForm.phone) {
      toast.error("Escribe tu teléfono.");
      return;
    }
    if (locStatus.error) {
      toast.error(locStatus.error);
      return;
    }
    if (locStatus.needsAddress && !locForm.address.trim()) {
      toast.error("Indica tu dirección.");
      return;
    }
    saveProfile.mutate();
  }

  async function handleLogout() {
    await logout();
    navigate(loginPathFor(location.pathname), { replace: true });
  }

  // Bloque 211 (pedido explícito — auto-eliminación de cuenta, 30 días de
  // gracia): tapa TODO el panel real mientras dure el período de gracia,
  // con un botón para reactivar — mismo criterio que el gate de
  // isBlocked/SUSPENDED en VendorLayout.jsx.
  if (user?.deletionRequestedAt) {
    return <AccountPendingDeletionNotice scheduledFor={deletionScheduledFor(user.deletionRequestedAt)} onLogout={handleLogout} />;
  }

  return (
    <div className="container-app grid grid-cols-1 gap-5 py-5 lg:grid-cols-[250px_1fr] lg:items-start lg:gap-8 lg:py-9">
      {/* SIDEBAR. En el celular las pestañas van en una fila que se desliza: antes eran una lista de 8 renglones que llenaba la
          primera pantalla y el contenido de la pestaña quedaba abajo, fuera de la vista. */}
      <aside className="min-w-0 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 lg:p-[22px]">
        <div className="mb-3 flex items-center gap-3 border-b border-surface-container-high pb-3 lg:mb-5 lg:pb-[18px]">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent font-display text-[17px] font-bold text-white">
            {customer?.fullName?.[0] ?? user.email[0].toUpperCase()}
          </div>
          <div>
            <div className="text-[14px] font-bold text-on-surface">{customer?.fullName ?? user.email}</div>
            <div className="text-[12px] text-outline">{customer?.province?.name ?? "Cuba"}</div>
          </div>
          <button onClick={handleLogout} className="ml-auto min-h-11 rounded-md px-2 text-[12.5px] font-semibold text-error lg:hidden">
            Cerrar sesión
          </button>
        </div>
        <nav ref={tabsNavRef} aria-label="Secciones de tu cuenta" className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`min-h-11 flex-shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-left text-[13.5px] font-bold lg:rounded-md lg:py-2.5 ${
                tab === t.id ? "bg-primary-container text-white" : "text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="mt-4 hidden w-full rounded-md px-3.5 py-2.5 text-left text-[13px] font-semibold text-error hover:bg-error/5 lg:block"
        >
          Cerrar sesión
        </button>
      </aside>

      {/* CONTENT */}
      <div className="min-w-0">
        {tab === "orders" && (
          <div>
            <WelcomeHeading name={(customer?.fullName ?? "").split(" ")[0] || "bienvenido"} className="mb-4" />
            <WeeklySummaryCard className="mb-6" />
            <h2 className="mb-5 font-display text-headline-md text-on-surface">Mis pedidos</h2>
            {ordersLoading && <CardListSkeleton />}
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
                        {NOTIFICATION_LABEL[o.notificationChannel] && ` · ${NOTIFICATION_LABEL[o.notificationChannel]}`}
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
                  {/* Bloque 197 (pedido explícito — "cuando un pedido es
                      cancelado y el vendedor pone el motivo, ese motivo
                      debe mostrarse al cliente en su página"): mismo
                      criterio que la mesa (TableOrder.cancelReason) —
                      ahora Order también lo guarda y lo devuelve. */}
                  {o.status === "CANCELLED" && o.cancelReason && (
                    <div className="mt-3 rounded-md bg-error/5 px-3 py-2 text-[12.5px] text-error">{o.cancelReason}</div>
                  )}
                  <div className="mt-3 flex flex-col gap-1 border-t border-surface-container pt-3">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between text-[12.5px] text-on-surface-variant">
                        <span>{it.quantity}× {it.name}</span>
                        <span>{fmtCUP(Number(it.price) * it.quantity)}</span>
                      </div>
                    ))}
                  </div>
                  {(o.loyaltyPointsRedeemed > 0 || o.loyaltyPointsEarned > 0) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold text-verified-dark">
                      {o.loyaltyPointsRedeemed > 0 && <span>Pagaste {fmtCUP(o.loyaltyDiscount)} con {o.loyaltyPointsRedeemed} puntos</span>}
                      {o.loyaltyPointsEarned > 0 && <span>Ganaste {o.loyaltyPointsEarned} puntos</span>}
                    </div>
                  )}
                  {/* Cancelar o cambiar el pedido: el servidor decide qué corresponde según el estado (canCancel / canEdit). */}
                  {(o.canEdit || o.canCancel || o.canAskToCancel) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-container pt-3">
                      {o.canEdit && (
                        <button type="button" onClick={() => setOrderToEdit(o)} className="min-h-11 rounded-lg bg-surface-container px-4 text-[13px] font-bold text-on-surface hover:bg-surface-container-high">
                          Modificar pedido
                        </button>
                      )}
                      {o.canCancel && (
                        <button type="button" onClick={() => setOrderToCancel(o)} className="min-h-11 rounded-lg bg-error/10 px-4 text-[13px] font-bold text-error hover:bg-error/15">
                          Cancelar pedido
                        </button>
                      )}
                      {/* Ya en preparación, en camino o entregado: no se cancela desde aquí; se le explica cómo y se le manda un correo. */}
                      {o.canAskToCancel && (
                        <button type="button" onClick={() => setOrderBlocked(o)} className="min-h-11 rounded-lg bg-surface-container px-4 text-[13px] font-bold text-on-surface hover:bg-surface-container-high">
                          Cancelar pedido
                        </button>
                      )}
                      {o.canAskToCancel && <span className="text-[12px] text-outline">La tienda ya lo está atendiendo: te decimos cómo cancelarlo.</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {orderToCancel && <CancelOrderModal order={orderToCancel} onClose={() => setOrderToCancel(null)} />}
            {orderToEdit && <EditOrderModal order={orderToEdit} onClose={() => setOrderToEdit(null)} />}
            {orderBlocked && <CancelBlockedModal order={orderBlocked} onClose={() => setOrderBlocked(null)} />}
          </div>
        )}

        {tab === "quick-sale" && (
          <div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-headline-md text-on-surface">Venta rápida</h1>
                {/* Bloque 237 (pedido explícito — "toda esta información se
                    le debe aclarar al vendedor"): el ciclo de vida en 2
                    etapas, con los números reales vigentes (editables desde
                    el admin, ver ListingPolicyCard en AdminOffers.jsx). */}
                <p className="mt-1 max-w-[520px] text-[13px] text-on-surface-variant">
                  Publica hasta {listingLimit} anuncios activos, hasta {dailyLimit} nuevos por día. Los compradores te piden por
                  WhatsApp. A los {visibilityDays} días el anuncio deja de mostrarse al público, pero sigues pudiendo editarlo o
                  eliminarlo aquí. Si no lo haces, se borra solo a los {expiryDaysSetting} días.
                </p>
              </div>
              <Button
                onClick={handleCreateListingClick}
                disabled={totalLimitReached}
                className={!totalLimitReached && !canCreateToday ? "opacity-50" : ""}
              >
                Publicar anuncio ({listings?.length ?? 0}/{listingLimit})
              </Button>
            </div>

            {profileMissing.length > 0 && (
              <div className="mb-5 rounded-2xl border border-secondary-container bg-secondary-container/15 p-4">
                <p className="text-[13.5px] font-bold text-on-surface">Completa tu perfil para publicar</p>
                <p className="mt-0.5 text-[13px] text-on-surface-variant">
                  Te falta: <strong>{profileMissing.join(", ")}</strong>. Los compradores te contactan por WhatsApp y ven tus anuncios según su lugar de entrega.
                </p>
                <Button className="mt-2.5" size="sm" onClick={() => setTab("profile")}>Completar mi perfil</Button>
              </div>
            )}

            {pendingListingReports.map((r) => {
              const draft = evidenceDrafts[r.id] ?? { message: "", files: [] };
              return (
                <div key={r.id} className="mb-4 rounded-2xl border border-error/30 bg-error/5 p-5">
                  <p className="mb-1 flex items-center gap-1.5 text-[13.5px] font-bold text-error">
                    <ShieldAlert className="h-4 w-4" /> Reportaron tu anuncio "{r.customerListing?.name}"
                  </p>
                  <p className="mb-2 text-[13px] text-on-surface-variant">Un cliente dijo: "{r.message}"</p>
                  {r.evidenceDueAt && (
                    <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-error">
                      <Clock className="h-3.5 w-3.5" /> Tienes hasta el {new Date(r.evidenceDueAt).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" })} para responder o se suspende automáticamente.
                    </p>
                  )}
                  <textarea
                    value={draft.message}
                    onChange={(e) => updateEvidenceDraft(r.id, { message: e.target.value })}
                    rows={3}
                    placeholder="Explica que tu producto es real (mínimo 10 caracteres)..."
                    className="mb-2 w-full resize-none rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] text-on-surface outline-none focus:border-tertiary-accent"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-variant/40">
                      <Camera className="h-3.5 w-3.5" />
                      {draft.files.length > 0 ? `${draft.files.length} foto(s)` : "Adjuntar foto (opcional)"}
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => updateEvidenceDraft(r.id, { files: Array.from(e.target.files ?? []).slice(0, 4) })}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (draft.message.trim().length < 10) return toast.error("Cuéntanos qué pasó (mínimo 10 caracteres).");
                        submitListingEvidence.mutate({ id: r.id, message: draft.message.trim(), files: draft.files });
                      }}
                      disabled={submitListingEvidence.isPending}
                      className="rounded-lg bg-error px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                    >
                      {submitListingEvidence.isPending ? "Enviando..." : "Enviar respuesta"}
                    </button>
                  </div>
                </div>
              );
            })}

            {listingsLoading && <CardListSkeleton />}
            {!listingsLoading && !listings?.length && (
              <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest py-16 text-center text-body-md text-on-surface-variant">
                Todavía no publicaste ningún anuncio de venta rápida.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {listings?.map((l) => (
                <div key={l.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest">
                  <div className="relative aspect-[7/4] w-full bg-surface-container">
                    {l.images[0] ? (
                      <img src={`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${l.images[0]}`} alt={l.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-outline">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                    {/* Bloque 237: 3 motivos distintos de "no visible al
                        público" — mutuamente excluyentes, se muestra solo
                        el de mayor prioridad para no amontonar insignias. */}
                    {l.isSold ? (
                      <span className="absolute left-2 top-2 rounded-full bg-inverse-surface/80 px-2.5 py-1 text-[10.5px] font-bold text-white">Vendido</span>
                    ) : !l.isActive ? (
                      <span className="absolute left-2 top-2 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">Sin foto — no visible</span>
                    ) : new Date(l.publicVisibleUntil).getTime() <= Date.now() ? (
                      <span className="absolute left-2 top-2 rounded-full bg-tertiary-accent px-2.5 py-1 text-[10.5px] font-bold text-white">Ya no se muestra públicamente</span>
                    ) : null}
                  </div>
                  <div className="p-3.5">
                    <div className="mb-0.5 truncate text-[13.5px] font-bold text-on-surface">{l.name}</div>
                    <div className="mb-2 text-[13.5px] font-bold text-secondary">{formatPrice(l.price, l.currency)}</div>
                    <div className="mb-3 text-[11.5px] text-outline">
                      {new Date(l.publicVisibleUntil).getTime() <= Date.now()
                        ? daysRemaining(l.expiresAt) > 0
                          ? `Se elimina en ${daysRemaining(l.expiresAt)} días`
                          : "Se elimina hoy"
                        : daysRemaining(l.publicVisibleUntil) > 0
                          ? `Visible ${daysRemaining(l.publicVisibleUntil)} días más`
                          : "Deja de mostrarse hoy"}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => openEditListing(l)}
                        aria-label="Editar anuncio"
                        className="flex h-8 flex-1 items-center justify-center gap-1 rounded border border-outline-variant text-[11.5px] font-semibold text-on-surface hover:bg-surface-container"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button
                        onClick={() => toggleListingSold.mutate(l.id)}
                        disabled={toggleListingSold.isPending}
                        aria-label={l.isSold ? "Marcar como disponible" : "Marcar como vendido"}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-outline-variant text-on-surface hover:bg-surface-container disabled:opacity-50"
                      >
                        <CheckCircle2 className={`h-3.5 w-3.5 ${l.isSold ? "text-secondary" : ""}`} />
                      </button>
                      <button
                        onClick={() => setDeleteListingTarget(l)}
                        aria-label="Eliminar anuncio"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-outline-variant text-error hover:bg-error/5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {listingModalOpen && (
              <div className="fixed inset-0 z-[60] flex items-end justify-center bg-inverse-surface/40 sm:items-center sm:p-4">
                <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-surface-container-lowest p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-title-lg font-bold text-on-surface">{editingListing ? "Editar anuncio" : "Nuevo anuncio"}</h3>
                    <button onClick={() => setListingModalOpen(false)} aria-label="Cerrar" className="text-outline hover:text-on-surface">
                      <XIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-3.5">
                    <div>
                      <Input label="Título" maxLength={LISTING_NAME_MAX} value={listingForm.name} onChange={(e) => setListingForm({ ...listingForm, name: e.target.value })} />
                      <p className="mt-1 text-right text-[11.5px] text-outline">{listingForm.name.length}/{LISTING_NAME_MAX}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-label-md text-on-surface-variant">Descripción</span>
                        <AiGenerateButton kind="listing" currentText={listingForm.description} productName={listingForm.name} onGenerated={(text) => setListingForm((f) => ({ ...f, description: text.slice(0, LISTING_DESC_MAX) }))} />
                      </div>
                      <textarea
                        value={listingForm.description}
                        maxLength={LISTING_DESC_MAX}
                        onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })}
                        placeholder="Cuéntale al comprador qué es, el estado, marca o modelo, accesorios, por qué lo vendes... (mínimo 10 caracteres)"
                        className="min-h-[110px] w-full resize-y rounded border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md outline-none"
                      />
                      <p className="mt-1 text-right text-[11.5px] text-outline">{listingForm.description.length}/{LISTING_DESC_MAX}</p>
                    </div>
                    <ConditionPicker value={listingForm.condition} onChange={(condition) => setListingForm((f) => ({ ...f, condition }))} />
                    <div className="grid grid-cols-[1fr_110px] gap-3">
                      <Input label="Precio por unidad" type="number" min={1} value={listingForm.price} onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })} />
                      <Select label="Moneda" value={listingForm.currency} onChange={(e) => setListingForm({ ...listingForm, currency: e.target.value })}>
                        {(siteSettings?.availableCurrencies ?? ["USD", "CUP", "EUR", "MXN"]).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </Select>
                    </div>
                    <Input label="Unidades disponibles (opcional)" type="number" min={1} value={listingForm.quantity} onChange={(e) => setListingForm({ ...listingForm, quantity: e.target.value })} />
                    <PriceTiersEditor value={listingForm.priceTiers} onChange={(priceTiers) => setListingForm((f) => ({ ...f, priceTiers }))} unitPrice={Number(listingForm.price)} currency={listingForm.currency} />
                    <TagsInput value={listingForm.tags} onChange={(tags) => setListingForm((f) => ({ ...f, tags }))} />
                    <div className="rounded-xl border border-surface-container-high p-3.5">
                      <h3 className="text-title-md font-bold text-on-surface">Dónde ofreces este artículo</h3>
                      <p className="mb-3 mt-0.5 text-[12px] text-on-surface-variant">
                        Empieza con tu lugar del perfil. Cámbialo si el artículo está en otra provincia, estado o país: los compradores ven el anuncio según su lugar de entrega.
                      </p>
                      <LocationPicker
                        value={{
                          countryId: listingForm.countryId,
                          countryOther: listingForm.countryOther,
                          provinceId: listingForm.provinceId,
                          municipalityId: listingForm.municipalityId,
                          municipalityOther: listingForm.municipalityOther,
                          stateOther: listingForm.stateOther,
                        }}
                        onChange={(patch) =>
                          setListingForm((f) => {
                            const next = { ...f };
                            for (const k of ["countryId", "countryOther", "provinceId", "municipalityId", "municipalityOther", "stateOther"]) if (k in patch) next[k] = patch[k];
                            return next;
                          })
                        }
                        onStatus={setListingLocStatus}
                        labels={{ country: "País", province: "Provincia o estado" }}
                      />
                    </div>
                    <Input label="Zona o municipio (opcional)" maxLength={80} value={listingForm.locationNote} onChange={(e) => setListingForm({ ...listingForm, locationNote: e.target.value })} placeholder="Ej.: Vista Alegre, Santiago de Cuba" />
                    <div className="rounded-xl bg-surface-container/60 p-3.5">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="checkbox" className="mt-1 h-5 w-5 accent-tertiary-accent" checked={listingForm.showOwnerName} onChange={(e) => setListingForm({ ...listingForm, showOwnerName: e.target.checked })} />
                        <span>
                          <span className="block text-[13.5px] font-semibold text-on-surface">Mostrar mi nombre en el anuncio</span>
                          <span className="block text-[12px] text-on-surface-variant">
                            {listingForm.showOwnerName ? `Aparecerá "Publicado por ${customer?.fullName ?? "tu nombre"}".` : 'Si lo dejas apagado, aparecerá "Publicado por un cliente".'}
                          </span>
                        </span>
                      </label>
                      <p className="mt-2.5 border-t border-surface-container-high pt-2.5 text-[12px] text-on-surface-variant">
                        Los compradores te contactan directo por WhatsApp o llamada al teléfono de tu perfil:{" "}
                        <strong className="text-on-surface">{customer?.phone || "agrégalo en la pestaña Perfil"}</strong>.
                      </p>
                    </div>
                    <Button className="w-full" onClick={handleSaveListing} disabled={saveListing.isPending}>
                      {saveListing.isPending ? "Guardando..." : editingListing ? "Guardar cambios" : "Crear anuncio"}
                    </Button>

                    {/* Pedido explícito: la sección de fotos debe verse "casi
                        igual a un producto de tienda" — mismo patrón que
                        VendorProducts.jsx (galería de miniaturas + botón para
                        agregar, aspecto 7:4, hasta 4 fotos). */}
                    <div className="border-t border-surface-container pt-3.5">
                      <span className="mb-1.5 block text-label-md text-on-surface-variant">
                        Fotos del anuncio <span className="text-error">*</span>
                      </span>
                      {savedListing && !savedListing.images?.length && (
                        <p className="mb-2.5 rounded-md bg-error/10 px-3 py-2 text-label-sm font-semibold text-error">
                          ⚠️ Este anuncio está en pausa y no se muestra a la venta hasta que subas al menos 1 foto.
                        </p>
                      )}
                      {savedListing ? (
                        <>
                          <div className="mb-2.5 flex flex-wrap gap-2">
                            {savedListing.images?.map((url) => (
                              <div key={url} className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-surface-container-high">
                                <img src={`${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}${url}`} alt="" className="h-full w-full object-cover" />
                                <button
                                  type="button"
                                  onClick={() => removeListingImage.mutate(url)}
                                  disabled={removeListingImage.isPending}
                                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                                >
                                  <XIcon className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            {(savedListing.images?.length ?? 0) < maxImages && (
                              <ImageCropUploader
                                aspect={7 / 4}
                                accept="image/jpeg,image/webp"
                                boxClassName="h-16 w-16 flex-shrink-0"
                                compact
                                clearOnConfirm
                                onFileReady={handleListingImage}
                              />
                            )}
                          </div>
                          <p className="text-label-sm text-outline">
                            {uploadListingImage.isPending
                              ? "Subiendo foto..."
                              : `Tamaño recomendado: 1400×800px (relación 7:4) — al subir una foto podrás recortarla para ajustarla. Solo JPG o WebP. Hasta ${maxImages} fotos.`}
                          </p>
                        </>
                      ) : (
                        <p className="text-label-sm text-outline">Guarda el anuncio primero para poder subirle fotos.</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (savedListing && !savedListing.images?.length) {
                          toast.error("Sube al menos 1 foto antes de terminar — sin fotos el anuncio queda pausado y no se muestra en venta rápida.");
                          return;
                        }
                        setListingModalOpen(false);
                      }}
                      className="mt-1 w-full rounded-xl border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant hover:bg-surface-variant"
                    >
                      {savedListing ? "Listo" : "Cancelar"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {deleteListingTarget && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse-surface/50 p-4">
                <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-surface-container-lowest p-6">
                  <h3 className="mb-2 text-title-lg font-bold text-on-surface">¿Eliminar este anuncio?</h3>
                  <p className="mb-5 text-[13.5px] text-on-surface-variant">
                    "{deleteListingTarget.name}" se va a eliminar para siempre, junto con sus fotos. Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-2.5">
                    <Button variant="outline" className="flex-1" onClick={() => setDeleteListingTarget(null)}>Cancelar</Button>
                    <Button variant="danger" className="flex-1" onClick={() => deleteListing.mutate(deleteListingTarget.id)} disabled={deleteListing.isPending}>
                      {deleteListing.isPending ? "Eliminando..." : "Eliminar"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "wishlist" && (() => {
          const storeFavorites = favorites?.filter((f) => f.vendorId) ?? [];
          const productFavorites = favorites?.filter((f) => f.productId) ?? [];
          return (
            <div>
              <h1 className="mb-5 font-display text-headline-md text-on-surface">Favoritos</h1>
              {favoritesLoading && <ProductGridSkeleton count={6} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" />}
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
                      // Bloque 240: el corazón entra por topRightSlot de la
                      // tarjeta (antes flotaba encima de ella y pisaba el
                      // badge "Más vendido"). Zona táctil de 44px con el
                      // círculo visible de 32px adentro (R-03).
                      <ProductCard
                        key={f.id}
                        product={f.product}
                        topRightSlot={
                          <button
                            onClick={() => removeFavorite.mutate(f.id)}
                            disabled={removeFavorite.isPending}
                            aria-label="Quitar de favoritos"
                            className="group/heart -m-1.5 flex h-11 w-11 items-center justify-center disabled:opacity-50"
                          >
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white group-hover/heart:bg-black/60">
                              <Heart className="h-4 w-4 fill-white" />
                            </span>
                          </button>
                        }
                      />
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
                <FormSkeleton fields={3} />
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

        {tab === "points" && (
          <div className="max-w-[640px]">
            <h1 className="mb-5 font-display text-headline-md text-on-surface">Mis puntos</h1>
            <MyPoints />
          </div>
        )}

        {tab === "reports" && (
          <div>
            <h1 className="mb-4 font-display text-headline-md text-on-surface">Reportes</h1>
            <ReportsCenter audience="customer" />
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
                <FormSkeleton fields={3} />
              ) : (
                <div className="flex flex-col gap-3.5">
                  <Input data-guard="name" label="Nombre completo" value={profileForm.fullName} onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })} />
                  <PhoneInput
                    label="Teléfono (WhatsApp)"
                    required
                    value={profileForm.phone}
                    onChange={(phone) => setProfileForm((f) => ({ ...f, phone }))}
                    onCountryChange={(country) => setProfileForm((f) => (f.country === country ? f : { ...f, country }))}
                  />
                  <div className="mt-1 border-t border-surface-container-high pt-4">
                    <h2 className="text-title-md font-bold text-on-surface">Tu ubicación</h2>
                    <p className="mb-3 mt-0.5 text-[12.5px] text-on-surface-variant">
                      El país y la provincia o estado son obligatorios para publicar una venta rápida: los compradores ven los anuncios según su lugar de entrega.
                    </p>
                    <LocationPicker
                      value={{
                        countryId: locForm.registrationCountryId,
                        countryOther: locForm.registrationCountryOther,
                        provinceId: locForm.provinceId,
                        municipalityId: locForm.municipalityId,
                        municipalityOther: locForm.municipalityOther,
                        stateOther: locForm.stateOther,
                      }}
                      onChange={(patch) =>
                        setLocForm((prev) => {
                          const next = { ...prev };
                          if ("countryId" in patch) next.registrationCountryId = patch.countryId;
                          if ("countryOther" in patch) next.registrationCountryOther = patch.countryOther;
                          if ("provinceId" in patch) next.provinceId = patch.provinceId;
                          if ("municipalityId" in patch) next.municipalityId = patch.municipalityId;
                          if ("municipalityOther" in patch) next.municipalityOther = patch.municipalityOther;
                          if ("stateOther" in patch) next.stateOther = patch.stateOther;
                          return next;
                        })
                      }
                      address={locForm.address}
                      onAddressChange={(address) => setLocForm((prev) => ({ ...prev, address }))}
                      onStatus={setLocStatus}
                      labels={{ country: "País", province: "Provincia o estado" }}
                      addressLabel="Dirección"
                    />
                  </div>
                  <Button className="w-full" onClick={handleSaveProfile} disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              )}
            </div>

            {changingEmail && <ChangeEmailModal currentEmail={customer?.email} onClose={() => setChangingEmail(false)} />}

            <div className="mt-5 max-w-[480px]">
              <NotificationSettings app={APPS.cliente} />
            </div>

            <div className="mt-5 max-w-[480px]">
              <EmailPreferencesCard />
            </div>

            <div className="mt-5 max-w-[480px]">
              <TwoFactorCard />
            </div>

            <div className="mt-5 max-w-[480px]">
              <DeleteAccountCard />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
