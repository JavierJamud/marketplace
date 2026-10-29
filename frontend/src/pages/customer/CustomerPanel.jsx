import { WelcomeHeading } from "../../components/WelcomeSummary.jsx";
import { orderTotalLabel, orderShippingText, orderLineShippingText } from "../../lib/shipping.js";
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Heart, Mail, Package, Pencil, Trash2, CheckCircle2, X as XIcon, ShieldAlert, Clock, Camera, AlertTriangle, Tag, Gift, MapPin, User as UserIcon, Flag, MessageSquare } from "lucide-react";
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
import { imgUrl, thumbUrl } from "../../lib/imgUrl.js";
import { AccountPendingDeletionNotice, deletionScheduledFor } from "../../components/AccountPendingDeletionNotice.jsx";
import { DeleteAccountCard } from "../../components/DeleteAccountCard.jsx";
import { CancelOrderModal, CancelBlockedModal, EditOrderModal } from "../../components/customer/CustomerOrderActions.jsx";
import { NotificationSettings } from "../../components/pwa/NotificationSettings.jsx";
import { APPS } from "../../lib/pwa.js";
import { MyPoints } from "../../components/customer/MyPoints.jsx";
import { EmailPreferencesCard } from "../../components/customer/EmailPreferencesCard.jsx";
import { ReportsCenter } from "../../components/reports/ReportsCenter.jsx";
import { CardListSkeleton, FormSkeleton } from "../../components/ui/Skeleton.jsx";
import { channelLabel, currencyCodesFor, currencyLabel } from "../../lib/catalog.js";
import { AutoClosedOrderHelp } from "../../components/AutoClosedOrderHelp.jsx";

// Mismos labels/colores que VendorOrders.jsx para consistencia visual, sin
// los controles de gestión (ese panel es del vendedor, este es de lectura).
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#087A38", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };
// El verde de "Entregado" (#0CAE53) solo sirve de fondo: como texto sobre su propio tinte daba 2,6:1. El texto va en
// verified-dark (#087A38, 4,8:1 sobre ese tinte) para cumplir AA; los demás estados ya pasan con su mismo color.
const STATUS_TEXT_COLOR = { ...STATUS_COLOR, DELIVERED: "#087A38" };
// Cerrado por el sistema porque la tienda no lo confirmó a tiempo: en gris y sin la palabra "Cancelado", que sonaría a rechazo.
const autoClosed = (o) => o.status === "CANCELLED" && !!o.autoCancelledAt;
const statusLabel = (o) => (autoClosed(o) ? "Sin confirmar" : STATUS_LABEL[o.status]);
const statusColor = (o) => (autoClosed(o) ? "#5f6368" : STATUS_COLOR[o.status]);
const statusTextColor = (o) => (autoClosed(o) ? "#5f6368" : STATUS_TEXT_COLOR[o.status]);

// Los puntos se canjean solo en pedidos con todos los precios en la moneda de la tienda (ver redeemForOrder en
// loyalty.service.js), así que la moneda de cualquier artículo del pedido es la del descuento.
const orderCurrency = (o) => o.items?.find((it) => it.currency)?.currency ?? "CUP";

// Aviso de error con reintento para las listas del panel. Sin él, una petición fallida se veía como "todavía no tienes
// nada", y en Perfil y Direcciones el formulario vacío podía guardarse encima de los datos reales.
function LoadError({ message, onRetry, retrying }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest px-4 py-12 text-center">
      <p className="text-body-md text-error">{message}</p>
      <Button variant="outline" onClick={() => onRetry()} disabled={retrying}>
        {retrying ? "Reintentando..." : "Reintentar"}
      </Button>
    </div>
  );
}

// `short` es la etiqueta de la cuadrícula del celular (4 columnas de unos 80px a 360px de ancho).
const TABS = [
  { id: "orders", label: "Mis pedidos", short: "Pedidos", icon: Package },
  { id: "quick-sale", label: "Venta rápida", short: "Venta rápida", icon: Tag },
  { id: "wishlist", label: "Favoritos", short: "Favoritos", icon: Heart },
  { id: "points", label: "Mis puntos", short: "Puntos", icon: Gift },
  { id: "addresses", label: "Direcciones", short: "Direcciones", icon: MapPin },
  { id: "profile", label: "Perfil", short: "Perfil", icon: UserIcon },
  // Lo que reportaste y lo que te reportaron (ventas rápidas), con su estado. Ver ReportsCenter.jsx.
  { id: "reports", label: "Reportes", short: "Reportes", icon: Flag },
  { id: "suggestions", label: "Sugerencias", short: "Sugerencias", icon: MessageSquare },
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

  const { data: customer, isLoading: customerLoading, isError: customerError, refetch: refetchCustomer, isFetching: customerFetching } = useQuery({
    queryKey: ["my-customer-profile"],
    queryFn: async () => (await api.get("/customers/me")).data.customer,
    enabled: !!user,
  });

  // Cada 30 s (antes 8): la lista llega entera y sin paginar, y pedirla tan seguido cargaba al servidor. Los cambios de
  // estado llegan al momento por el canal en vivo (lib/useRealtime.js); este intervalo es solo el respaldo si ese canal cae.
  const { data: orders, isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders, isFetching: ordersFetching } = useQuery({
    queryKey: ["my-customer-orders"],
    queryFn: async () => (await api.get("/customers/me/orders")).data.orders,
    enabled: !!user,
    refetchInterval: tab === "orders" ? 30000 : false,
  });

  // País del perfil cuando no hay provincia ni estado: misma queryKey que LocationPicker, así que comparten caché.
  const needsCountryName = !!customer && !customer.province && !customer.stateOther && !!customer.registrationCountryId;
  const { data: countries } = useQuery({
    queryKey: ["active-countries-all"],
    queryFn: async () => (await api.get("/locations/countries?all=true")).data.countries,
    enabled: needsCountryName,
  });
  // Antes decía "Cuba" a cualquiera sin provincia, también a clientes de otros países. Ahora se muestra lo que hay
  // guardado y, si no hay nada, no se muestra la línea.
  const customerPlace = customer
    ? customer.province?.name ||
      customer.stateOther ||
      countries?.find((c) => c.id === customer.registrationCountryId)?.name ||
      customer.registrationCountryOther ||
      null
    : null;

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
  });

  // Misma queryKey que Store.jsx (el botón de corazón ahí) — comparten
  // cache, así que favoritear desde la tienda y venir acá no pide de nuevo.
  const { data: favorites, isLoading: favoritesLoading, isError: favoritesError, refetch: refetchFavorites, isFetching: favoritesFetching } = useQuery({
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
  const { data: listingsData, isLoading: listingsLoading, isError: listingsError, refetch: refetchListings, isFetching: listingsFetching } = useQuery({
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
      toast.success("Respuesta enviada. El admin la va a revisar.");
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
      // La primera moneda activa del admin, si el USD de siempre ya no está disponible.
      currency: currencyCodesFor().includes("USD") ? "USD" : currencyCodesFor()[0] ?? "USD",
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
      toast.success(editingListing ? "Anuncio actualizado." : "Anuncio creado. Ahora sube al menos una foto.");
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
      toast.success("Foto subida. Tu anuncio ya está publicado.");
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
      {/* SIDEBAR. En el celular las 8 secciones van en una cuadrícula de 4x2 con ícono: todas a la vista sin deslizar (la fila
          deslizable escondía la mitad y parecía cortada) y sin ocupar la pantalla entera como la lista de 8 renglones. */}
      <aside className="min-w-0 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 lg:p-[22px]">
        <div className="mb-3 flex items-center gap-3 border-b border-surface-container-high pb-3 lg:mb-5 lg:pb-[18px]">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent font-display text-[17px] font-bold text-white">
            {customer?.fullName?.[0] ?? user.email[0].toUpperCase()}
          </div>
          {/* min-w-0 + truncate: un correo largo sin espacios empujaba "Cerrar sesión" fuera de la tarjeta a 390px. */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold text-on-surface" title={customer?.fullName ?? user.email}>{customer?.fullName ?? user.email}</div>
            {customerPlace && <div className="truncate text-[12px] text-outline">{customerPlace}</div>}
          </div>
          <button onClick={handleLogout} className="min-h-11 flex-shrink-0 rounded-md px-2 text-[12.5px] font-semibold text-error lg:hidden">
            Cerrar sesión
          </button>
        </div>
        <nav aria-label="Secciones de tu cuenta" className="grid grid-cols-4 gap-1.5 lg:flex lg:flex-col lg:gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[11.5px] font-semibold leading-tight lg:min-h-11 lg:flex-row lg:justify-start lg:gap-2.5 lg:rounded-md lg:px-3.5 lg:py-2.5 lg:text-left lg:text-[13.5px] lg:font-bold ${
                  active ? "bg-primary-container text-white" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container lg:bg-transparent"
                }`}
              >
                <Icon className="h-5 w-5 flex-shrink-0 lg:h-4 lg:w-4" aria-hidden="true" />
                <span className="w-full break-words lg:hidden">{t.short}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>
        <button
          onClick={handleLogout}
          className="mt-4 hidden min-h-11 w-full rounded-md px-3.5 py-2.5 text-left text-[13px] font-semibold text-error hover:bg-error/5 lg:block"
        >
          Cerrar sesión
        </button>
      </aside>

      {/* CONTENT */}
      <div className="min-w-0">
        {tab === "orders" && (
          <div>
            {/* Sin el resumen semanal: a un cliente que compra de vez en cuando casi siempre le decía "0, igual que la semana
                pasada". Sus pedidos quedan justo debajo del saludo. */}
            <WelcomeHeading name={(customer?.fullName ?? "").split(" ")[0] || "bienvenido"} className="mb-5" />
            <h2 className="mb-4 font-display text-title-lg font-bold text-on-surface sm:text-headline-md">Mis pedidos</h2>
            {ordersLoading && <CardListSkeleton />}
            {/* Solo si no hay nada que mostrar: si falla un refresco en segundo plano se deja la lista que ya estaba. */}
            {ordersError && !orders && <LoadError message="No se pudieron cargar tus pedidos." onRetry={refetchOrders} retrying={ordersFetching} />}
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
                        {new Date(o.createdAt).toLocaleString("es-CU")} · {channelLabel(o.channel)}
                      </div>
                    </div>
                    <div className="text-[14px] font-bold text-on-surface">{orderTotalLabel(o)}</div>
                    <span
                      className="rounded-full px-3 py-1.5 text-[11.5px] font-bold"
                      style={{ background: `${statusColor(o)}1f`, color: statusTextColor(o) }}
                    >
                      {statusLabel(o)}
                    </span>
                  </div>
                  {/* Bloque 197 (pedido explícito — "cuando un pedido es
                      cancelado y el vendedor pone el motivo, ese motivo
                      debe mostrarse al cliente en su página"): mismo
                      criterio que la mesa (TableOrder.cancelReason) —
                      ahora Order también lo guarda y lo devuelve. */}
                  {autoClosed(o) && <AutoClosedOrderHelp code={o.code} store={{ name: o.vendor.companyName, whatsapp: o.vendor.whatsapp, email: o.vendor.email }} className="mt-3" />}
                  {o.status === "CANCELLED" && o.cancelReason && !autoClosed(o) && (
                    <div className="mt-3 rounded-md bg-error/5 px-3 py-2 text-[12.5px] text-error">{o.cancelReason}</div>
                  )}
                  <div className="mt-3 flex flex-col gap-1 border-t border-surface-container pt-3">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between gap-3 text-[12.5px] text-on-surface-variant">
                        <span>
                          {it.quantity}× {it.name}
                          {orderLineShippingText(it) && <span className="block text-[11.5px] text-outline">{orderLineShippingText(it)}</span>}
                        </span>
                        <span>{formatPrice(Number(it.price) * it.quantity, it.currency)}</span>
                      </div>
                    ))}
                    {o.shippingSource && (
                      <div className="flex justify-between gap-3 text-[12.5px] text-on-surface-variant">
                        <span>Envío</span>
                        <span className="text-right font-semibold text-on-surface">{orderShippingText(o)}</span>
                      </div>
                    )}
                    {o.shippingCoordinate && <p className="text-[11.5px] text-outline">El envío a coordinar lo acuerdas con la tienda: no está en el total.</p>}
                  </div>
                  {(o.loyaltyPointsRedeemed > 0 || o.loyaltyPointsEarned > 0) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold text-verified-dark">
                      {o.loyaltyPointsRedeemed > 0 && <span>Pagaste {formatPrice(o.loyaltyDiscount, orderCurrency(o))} con {o.loyaltyPointsRedeemed} puntos</span>}
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
                <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Venta rápida</h1>
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
                <Button className="mt-2.5" onClick={() => setTab("profile")}>Completar mi perfil</Button>
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
                    {/* sr-only y no hidden: con display:none el selector de archivos no se alcanzaba con el teclado. */}
                    <label className="relative flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-[12px] font-semibold text-on-surface-variant focus-within:ring-2 focus-within:ring-tertiary-accent hover:bg-surface-variant/40">
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      {draft.files.length > 0 ? `${draft.files.length} foto(s)` : "Adjuntar foto (opcional)"}
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        onChange={(e) => updateEvidenceDraft(r.id, { files: Array.from(e.target.files ?? []).slice(0, 4) })}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (draft.message.trim().length < 10) return toast.error("Cuéntanos qué pasó (mínimo 10 caracteres).");
                        submitListingEvidence.mutate({ id: r.id, message: draft.message.trim(), files: draft.files });
                      }}
                      disabled={submitListingEvidence.isPending}
                      className="min-h-11 rounded-lg bg-error px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                    >
                      {submitListingEvidence.isPending ? "Enviando..." : "Enviar respuesta"}
                    </button>
                  </div>
                </div>
              );
            })}

            {listingsLoading && <CardListSkeleton />}
            {listingsError && !listingsData && <LoadError message="No se pudieron cargar tus anuncios." onRetry={refetchListings} retrying={listingsFetching} />}
            {!listingsLoading && !listingsError && !listings?.length && (
              <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest py-16 text-center text-body-md text-on-surface-variant">
                Todavía no publicaste ningún anuncio de venta rápida.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {listings?.map((l) => (
                <div key={l.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest">
                  <div className="relative aspect-[7/4] w-full bg-surface-container">
                    {/* Miniatura con la foto grande de respaldo, igual que QuickSaleCard. Antes se armaba la URL con
                        VITE_API_URL ?? localhost, que no cargaba desde el celular en la red local. */}
                    {l.images[0] ? (
                      <img
                        src={thumbUrl(l.images[0])}
                        alt={l.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          const full = imgUrl(l.images[0]);
                          if (e.currentTarget.src !== full) {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = full;
                          }
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-outline">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                    {/* Bloque 237: 3 motivos distintos de "no visible al
                        público" — mutuamente excluyentes, se muestra solo
                        el de mayor prioridad para no amontonar insignias. */}
                    {l.suspendedAt ? (
                      <span className="absolute left-2 top-2 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">Suspendida por un reporte</span>
                    ) : l.isSold ? (
                      <span className="absolute left-2 top-2 rounded-full bg-inverse-surface/80 px-2.5 py-1 text-[10.5px] font-bold text-white">Vendido</span>
                    ) : !l.isActive ? (
                      <span className="absolute left-2 top-2 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">Sin foto: no visible</span>
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
                    {/* Botones de 44px (R-03). En una sola fila no cabían a 390px (la tarjeta mide unos 143px por dentro en
                        la grilla de 2), así que Editar va arriba a todo el ancho y debajo Vendido y Eliminar. Vendido es un
                        interruptor con texto (antes era solo un ícono de check, difícil de entender). */}
                    <div className="grid grid-cols-[1fr_auto] gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditListing(l)}
                        aria-label={`Editar ${l.name}`}
                        className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded border border-outline-variant text-[12px] font-semibold text-on-surface hover:bg-surface-container"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleListingSold.mutate(l.id)}
                        disabled={toggleListingSold.isPending}
                        aria-pressed={!!l.isSold}
                        title={l.isSold ? "Marcar como disponible" : "Marcar como vendido"}
                        className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded border text-[12px] font-semibold disabled:opacity-50 ${
                          l.isSold ? "border-verified-dark bg-verified-dark/10 text-verified-dark" : "border-outline-variant text-on-surface hover:bg-surface-container"
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" /> Vendido
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteListingTarget(l)}
                        aria-label={`Eliminar ${l.name}`}
                        className="flex h-11 w-11 items-center justify-center rounded border border-outline-variant text-error hover:bg-error/5"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {listingModalOpen && (
              <div className="fixed inset-0 z-[60] flex items-end justify-center bg-inverse-surface/40 sm:items-center sm:p-4 p-4">
                <div className="modal-panel-4 w-full max-w-lg rounded-t-2xl bg-surface-container-lowest p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-title-lg font-bold text-on-surface">{editingListing ? "Editar anuncio" : "Nuevo anuncio"}</h3>
                    <button type="button" onClick={() => setListingModalOpen(false)} aria-label="Cerrar" className="-mr-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container hover:text-on-surface">
                      <XIcon className="h-5 w-5" aria-hidden="true" />
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
                        {currencyCodesFor(listingForm.currency).map((c) => (
                          <option key={c} value={c}>{currencyLabel(c)}</option>
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
                        <p className="mb-2.5 flex items-start gap-1.5 rounded-md bg-error/10 px-3 py-2 text-label-sm font-semibold text-error">
                          <AlertTriangle className="mt-px h-4 w-4 flex-shrink-0" aria-hidden="true" />
                          Este anuncio está en pausa y no se muestra a la venta hasta que subas al menos 1 foto.
                        </p>
                      )}
                      {savedListing ? (
                        <>
                          <div className="mb-2.5 flex flex-wrap gap-2">
                            {savedListing.images?.map((url) => (
                              <div key={url} className="group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-surface-container-high">
                                <img src={imgUrl(url)} alt="" className="h-full w-full object-cover" />
                                {/* Zona táctil de 44px en la esquina con el círculo visible adentro, como el corazón de
                                    Favoritos; antes el botón medía 16px y no tenía nombre para el lector de pantalla. */}
                                <button
                                  type="button"
                                  onClick={() => removeListingImage.mutate(url)}
                                  disabled={removeListingImage.isPending}
                                  aria-label={`Quitar foto ${savedListing.images.indexOf(url) + 1}`}
                                  className="group/rm absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1 disabled:opacity-50"
                                >
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover/rm:bg-black/80">
                                    <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                  </span>
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
                              : `Tamaño recomendado: 1400×800px (relación 7:4). Al subir una foto podrás recortarla para ajustarla. Solo JPG o WebP. Hasta ${maxImages} fotos.`}
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
                          toast.error("Sube al menos 1 foto antes de terminar. Sin fotos el anuncio queda pausado y no se muestra en venta rápida.");
                          return;
                        }
                        setListingModalOpen(false);
                      }}
                      className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant hover:bg-surface-variant"
                    >
                      {savedListing ? "Listo" : "Cancelar"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {deleteListingTarget && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse-surface/50 p-4">
                <div className="modal-panel-6 w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6">
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
              <h1 className="mb-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Favoritos</h1>
              {favoritesLoading && <ProductGridSkeleton count={6} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" />}
              {favoritesError && !favorites && <LoadError message="No se pudieron cargar tus favoritos." onRetry={refetchFavorites} retrying={favoritesFetching} />}
              {!favoritesLoading && !favoritesError && !favorites?.length && (
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
                        {/* Misma forma que el corazón de los productos: zona táctil de 44px con el círculo de 32px adentro. */}
                        <button
                          type="button"
                          onClick={() => removeFavorite.mutate(f.id)}
                          disabled={removeFavorite.isPending}
                          aria-label={`Quitar ${f.vendor?.companyName ?? "esta tienda"} de favoritos`}
                          className="group/heart absolute right-1 top-1 z-10 flex h-11 w-11 items-center justify-center disabled:opacity-50"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white group-hover/heart:bg-black/60">
                            <Heart className="h-4 w-4 fill-white" aria-hidden="true" />
                          </span>
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
            <h1 className="mb-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mis direcciones</h1>
            <div className="max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              {customerLoading ? (
                <FormSkeleton fields={3} />
              ) : customerError && !customer ? (
                // Sin el perfil el formulario sale vacío y "Guardar" borraría la dirección real: se pide reintentar.
                <LoadError message="No se pudo cargar tu dirección." onRetry={refetchCustomer} retrying={customerFetching} />
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
            <h1 className="mb-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mis puntos</h1>
            <MyPoints />
          </div>
        )}

        {tab === "reports" && (
          <div>
            <h1 className="mb-4 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Reportes</h1>
            <ReportsCenter audience="customer" />
          </div>
        )}

        {tab === "suggestions" && (
          <div>
            <h1 className="mb-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Sugerencias</h1>
            <div className="max-w-[560px]">
              <SuggestionBox />
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div>
            <h1 className="mb-5 font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Mi perfil</h1>

            <div className="mb-5 max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
                <Mail className="h-5 w-5 text-tertiary-accent" /> Correo de la cuenta
              </div>
              <p className="mb-4 text-[13.5px] text-on-surface-variant">{customer?.email}</p>
              <Button variant="outline" onClick={() => setChangingEmail(true)}>Cambiar correo</Button>
            </div>

            <div className="max-w-[480px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-[22px]">
              {customerLoading ? (
                <FormSkeleton fields={3} />
              ) : customerError && !customer ? (
                <LoadError message="No se pudo cargar tu perfil." onRetry={refetchCustomer} retrying={customerFetching} />
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
