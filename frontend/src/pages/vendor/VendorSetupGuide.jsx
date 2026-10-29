import { RegisterTrialCard } from "../../components/vendor/RegisterTrialCard.jsx";
import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ListChecks, MapPin, Package, ShieldCheck, Store as StoreIcon, ImagePlus } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { AiGenerateButton } from "../../components/AiGenerateButton.jsx";
import { KycSubmitForm } from "../../components/vendor/KycSubmitForm.jsx";
import { STAGE_META } from "../../lib/verificationMeta.js";
import { StoreBrandingCard } from "./VendorProfile.jsx";
import { ProductModal } from "./VendorProducts.jsx";
import { PanelSkeleton } from "../../components/ui/Skeleton.jsx";

// "Completa tu tienda": todo lo que hace falta para la insignia de verificada (y para que la prueba gratis se active sola) en
// una sola pantalla, un paso a la vez y con el formulario de cada paso aquí mismo. El orden importa: los documentos van al
// final porque el servidor no los acepta hasta que la tienda tenga datos, logo, zona y un producto publicado.
// Qué está hecho lo decide el servidor (GET /vendors/me/trial → checklist), igual que el banner del panel.
const STEPS = [
  { id: "datos", title: "Datos de tu tienda", icon: StoreIcon, keys: ["companyName", "ownerName", "whatsapp", "email", "businessCategoryId", "description"] },
  { id: "logo", title: "Logo", icon: ImagePlus, keys: ["logoUrl"] },
  { id: "zona", title: "Dónde vendes", icon: MapPin, keys: ["locations"] },
  { id: "producto", title: "Tu primer producto", icon: Package, keys: ["hasPublishedProduct"] },
  { id: "identidad", title: "Verificación de identidad", icon: ShieldCheck, keys: ["companyAddress", "registrationCountryId", "legalProvinceId", "idDocument", "selfie"] },
];

const MIN_DESCRIPTION = 30;

function StoreDataStep({ vendor, onSaved }) {
  const queryClient = useQueryClient();
  const initial = useMemo(
    () => ({
      companyName: vendor?.companyName ?? "",
      ownerName: vendor?.ownerName ?? "",
      whatsapp: vendor?.whatsapp ?? "",
      email: vendor?.email ?? "",
      businessCategoryId: vendor?.businessCategory?.id ?? vendor?.businessCategoryId ?? "",
      description: vendor?.description ?? "",
    }),
    [vendor]
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const { data: categories } = useQuery({ queryKey: ["business-categories"], queryFn: async () => (await api.get("/business-categories")).data.categories });

  const save = useMutation({
    // Solo se manda lo que cambió y no está vacío: el servidor comprueba que el nombre, el WhatsApp y el correo no sean de otra tienda.
    mutationFn: async () => {
      const body = Object.fromEntries(Object.entries(form).filter(([k, v]) => String(v).trim() !== "" && String(v).trim() !== String(initial[k] ?? "").trim()).map(([k, v]) => [k, String(v).trim()]));
      if (Object.keys(body).length === 0) return null;
      return (await api.patch("/vendors/me", body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron guardar los datos."),
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const descLen = form.description.trim().length;
  const verified = vendor?.verificationStatus === "VERIFIED";

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre de la tienda" required value={form.companyName} onChange={set("companyName")} disabled={verified} />
        <Input data-guard="name" label="Nombre del responsable" required value={form.ownerName} onChange={set("ownerName")} disabled={verified && !!vendor?.ownerName} />
        <Input label="WhatsApp de la tienda" required inputMode="tel" placeholder="+5355512345" value={form.whatsapp} onChange={set("whatsapp")} />
        <Input label="Correo de la tienda" required type="email" value={form.email} onChange={set("email")} />
      </div>
      <Select label="Tipo de negocio" required value={form.businessCategoryId} onChange={set("businessCategoryId")}>
        <option value="" disabled>
          Elige el tipo de negocio...
        </option>
        {categories?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor="guide-desc" className="text-label-md font-semibold text-on-surface-variant">
            Descripción de la tienda <span className="text-error">*</span>
          </label>
          <AiGenerateButton kind="store" currentText={form.description} onGenerated={(text) => setForm((f) => ({ ...f, description: text }))} />
        </div>
        <textarea
          id="guide-desc"
          rows={3}
          maxLength={200}
          value={form.description}
          onChange={set("description")}
          placeholder="Qué vendes, en qué zona y por qué comprarte a ti."
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[14px] outline-none focus:border-tertiary-accent"
        />
        <p className={`mt-1 text-[12px] ${descLen > 0 && descLen < MIN_DESCRIPTION ? "font-semibold text-error" : "text-outline"}`}>
          {descLen < MIN_DESCRIPTION ? `Mínimo ${MIN_DESCRIPTION} caracteres (llevas ${descLen}).` : `${form.description.length}/200`}
        </p>
      </div>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Guardando..." : "Guardar y seguir"}
        </Button>
      </div>
    </form>
  );
}

function ZoneStep({ vendor, onSaved }) {
  const queryClient = useQueryClient();
  const [countryId, setCountryId] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const { data: countries = [] } = useQuery({ queryKey: ["active-countries"], queryFn: async () => (await api.get("/locations/countries")).data.countries });
  useEffect(() => {
    if (!countryId && countries.length) setCountryId((countries.find((c) => c.code === "CU") ?? countries[0]).id);
  }, [countries, countryId]);
  const { data: provinces = [] } = useQuery({
    queryKey: ["provinces-for-country", countryId],
    queryFn: async () => (await api.get(`/locations/countries/${countryId}/provinces`)).data.provinces,
    enabled: !!countryId,
  });

  const add = useMutation({
    // Toda la provincia (municipalityIds null). Los municipios exactos se ajustan después en Configuración.
    mutationFn: async () => (await api.post("/vendors/me/locations/sync-province", { provinceId, municipalityIds: null })).data,
    onSuccess: () => {
      setProvinceId("");
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      queryClient.invalidateQueries({ queryKey: ["my-vendor-settings"] });
      onSaved();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la zona."),
  });

  const current = [...new Set((vendor?.locations ?? []).map((l) => l.province?.name ?? l.stateOther).filter(Boolean))];

  return (
    <div className="grid gap-4">
      {current.length > 0 && (
        <p className="text-[13px] text-on-surface">
          Ya vendes en: <strong>{current.join(", ")}</strong>.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="País" value={countryId} onChange={(e) => { setCountryId(e.target.value); setProvinceId(""); }}>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Provincia o estado" value={provinceId} onChange={(e) => setProvinceId(e.target.value)}>
          <option value="" disabled>
            Elige dónde vendes...
          </option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-[12px] text-outline">
        Se agrega la provincia completa. Si solo entregas en algunos municipios, ajústalo después en{" "}
        <Link to="/vendedor/configuracion" className="font-semibold text-tertiary-accent underline">
          Configuración
        </Link>
        .
      </p>
      <div>
        <Button type="button" disabled={!provinceId || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Guardando..." : "Agregar zona"}
        </Button>
      </div>
    </div>
  );
}

function ProductStep({ vendor, onSaved }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data.categories });
  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-on-surface-variant">Publica al menos un producto activo, con foto y precio. Es lo primero que ven tus clientes.</p>
      <div>
        <Button type="button" onClick={() => setOpen(true)}>
          Crear producto
        </Button>
      </div>
      {open && (
        <ProductModal
          product={null}
          planType={vendor?.planType}
          isRestaurant={vendor?.isRestaurant}
          categories={categories}
          vendorCurrency={vendor?.currency}
          onClose={() => {
            setOpen(false);
            queryClient.invalidateQueries({ queryKey: ["my-products"] });
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function IdentityStep({ vendor, verificationStatus, blocked, onSaved }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings });
  if (verificationStatus && verificationStatus !== "NOT_STARTED" && verificationStatus !== "REJECTED") {
    const meta = STAGE_META[verificationStatus];
    return (
      <p className="text-[13px] text-on-surface">
        {meta?.label ?? "Solicitud enviada"}.{" "}
        <Link to="/vendedor/verificacion" className="font-semibold text-tertiary-accent underline">
          Ver el estado
        </Link>
      </p>
    );
  }
  if (blocked) {
    return <p className="text-[13px] text-on-surface-variant">Completa primero los pasos de arriba: el envío de documentos pide la tienda completa.</p>;
  }
  return (
    <KycSubmitForm
      vendor={vendor}
      siteName={settings?.siteName}
      onSubmitted={() => {
        queryClient.invalidateQueries({ queryKey: ["my-verification"] });
        queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
        onSaved();
      }}
    />
  );
}

export default function VendorSetupGuide() {
  const { vendor } = useOutletContext();
  const queryClient = useQueryClient();
  const { data: trial, isLoading, isError } = useQuery({ queryKey: ["vendor-trial"], queryFn: async () => (await api.get("/vendors/me/trial")).data.trial });
  const [openId, setOpenId] = useState(null);

  const doneByKey = useMemo(() => Object.fromEntries((trial?.checklist ?? []).map((i) => [i.key, i.done])), [trial]);
  const labelByKey = useMemo(() => Object.fromEntries((trial?.checklist ?? []).map((i) => [i.key, i.label])), [trial]);
  const verificationStatus = vendor?.verificationStatus;
  const kycSent = verificationStatus && verificationStatus !== "NOT_STARTED" && verificationStatus !== "REJECTED";
  const steps = STEPS.map((s) => ({ ...s, done: s.keys.every((k) => doneByKey[k]) || (s.id === "identidad" && kycSent), missing: s.keys.filter((k) => !doneByKey[k]) }));
  const firstPending = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const active = openId ?? firstPending?.id ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["vendor-trial"] });
    setOpenId(null);
  };

  if (isLoading) return <PanelSkeleton />;
  if (isError) return <p className="text-body-md text-error">No se pudo cargar tu avance. Recarga la página.</p>;

  const percent = Math.round((doneCount / steps.length) * 100);
  const trialAccepted = !!trial?.trialStartedAt;

  return (
    <div className="max-w-[760px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ListChecks} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Completa tu tienda</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-on-surface-variant">
        {verificationStatus === "VERIFIED"
          ? "Tu tienda ya está verificada. Puedes revisar aquí cualquier dato."
          : trialAccepted
            ? trial?.trialBilling === "CARD"
              ? "Cuando termines los 5 pasos, registra tu tarjeta (hoy no se cobra nada) y tu prueba gratis empieza."
              : "Cuando termines los 5 pasos, tu prueba gratis se activa sola y tu tienda recibe la insignia de verificada."
            : "Estos 5 pasos son obligatorios para obtener la insignia de tienda verificada. Hazlos en orden: el último es enviar tus documentos."}
      </p>

      <div className="mb-5 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Avance">
          <div className="h-full rounded-full bg-secondary transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-[13px] font-bold text-on-surface">
          {doneCount} de {steps.length}
        </span>
      </div>

      {/* grid-cols-1 (columna de 0 a 100 %): con "grid" a secas la columna crece hasta el texto más largo de una línea, y el
          "Falta: dirección legal del negocio, país de registro legal..." del paso de identidad ensanchaba toda la lista (con el
          formulario y la cámara adentro) más allá de la pantalla del celular. */}
      {trial?.needsCard && <RegisterTrialCard className="mb-4" />}

      <ol className="grid grid-cols-1 gap-3">
        {steps.map((s, i) => {
          const isOpen = active === s.id;
          const blockedKyc = s.id === "identidad" && steps.slice(0, 4).some((x) => !x.done);
          return (
            <li key={s.id} className={`min-w-0 rounded-2xl border bg-surface-container-lowest ${isOpen ? "border-tertiary-accent/50" : "border-surface-container-high"}`}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? "__none" : s.id)}
                aria-expanded={isOpen}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${
                    s.done ? "bg-verified text-white" : isOpen ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {s.done ? <Check className="h-4 w-4" strokeWidth={3} aria-label="Hecho" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-on-surface">{s.title}</span>
                  {!s.done && s.missing.length > 0 && !(s.id === "identidad" && blockedKyc) && (
                    <span className="block truncate text-[12px] text-outline">Falta: {s.missing.map((k) => labelByKey[k]?.toLowerCase()).filter(Boolean).join(", ")}</span>
                  )}
                  {s.done && <span className="block text-[12px] text-verified-dark">Hecho</span>}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-outline transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="border-t border-surface-container-high px-4 pb-4 pt-4">
                  {s.id === "datos" && <StoreDataStep vendor={vendor} onSaved={refresh} />}
                  {s.id === "logo" && (
                    <div className="[&>div]:mb-0 [&>div]:border-0 [&>div]:p-0 [&>div]:shadow-none">
                      <StoreBrandingCard />
                      <Button className="mt-4" type="button" variant="outline" onClick={refresh}>
                        Listo, seguir
                      </Button>
                    </div>
                  )}
                  {s.id === "zona" && <ZoneStep vendor={vendor} onSaved={refresh} />}
                  {s.id === "producto" && <ProductStep vendor={vendor} onSaved={refresh} />}
                  {s.id === "identidad" && <IdentityStep vendor={vendor} verificationStatus={verificationStatus} blocked={blockedKyc} onSaved={refresh} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {doneCount === steps.length && verificationStatus !== "VERIFIED" && (
        <p className="mt-5 rounded-xl bg-surface-container px-4 py-3 text-[13px] text-on-surface">
          {trialAccepted ? "Todo listo. Tu prueba gratis se activa en unos segundos." : "Todo listo. Sigue el estado de tu solicitud en "}
          {!trialAccepted && (
            <Link to="/vendedor/verificacion" className="font-semibold text-tertiary-accent underline">
              Verificación y plan
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
