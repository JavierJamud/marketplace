import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { PlanComparisonModal } from "../../components/PlanComparisonModal.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";

// Registro de tienda: datos públicos de la empresa + al menos una provincia
// de servicio. El KYC (datos personales del dueño) se pide aparte, al
// solicitar verificación para pasar a Plan Business.
export default function VendorOnboarding() {
  const { user, refreshRole } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: "",
    ownerIdNumber: "",
    companyAddress: "",
    description: "",
    isRestaurant: false,
    tableCount: "",
    countryId: "",
    provinceId: "",
    municipalityId: "",
    stateOther: "",
    businessCategoryId: "",
  });
  const [showPlanModal, setShowPlanModal] = useState(false);

  // Bloque 113/114 (pedido explícito): acá ya no se piden de nuevo nombre,
  // correo ni WhatsApp — este usuario ya tiene cuenta (user.fullName/
  // email/phone), a diferencia de Account.jsx donde son el mismo "paso 1"
  // del registro. Mismo patrón país → provincia → municipio en cascada que
  // Account.jsx/VendorVerification.jsx. `?all=true`: acá un país sin
  // ninguna provincia/estado cargado sigue siendo elegible — fuera de Cuba
  // el estado se escribe a mano (ver isCuba más abajo), nunca depende de
  // que el admin haya cargado provincias para ese país.
  const { data: countries = [] } = useQuery({
    queryKey: ["active-countries-all"],
    queryFn: async () => (await api.get("/locations/countries?all=true")).data.countries,
  });
  const selectedCountry = countries.find((c) => c.id === form.countryId);
  const isCuba = selectedCountry?.code === "CU";
  const { data: provincesForCountry = [] } = useQuery({
    queryKey: ["provinces-for-country", form.countryId],
    queryFn: async () => (await api.get(`/locations/countries/${form.countryId}/provinces`)).data.provinces,
    enabled: !!form.countryId && isCuba,
  });
  const { data: municipalitiesForProvince = [] } = useQuery({
    queryKey: ["municipalities-for-province", form.provinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${form.provinceId}/municipalities`)).data.municipalities,
    enabled: !!form.provinceId && isCuba,
  });

  // Bloque 18: rubro obligatorio de la tienda, elegido una sola vez acá
  // (se puede cambiar después desde VendorSettings.jsx).
  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });
  const selectedBusinessCategory = businessCategories?.find((c) => c.id === form.businessCategoryId);

  // Bloque 65 (pedido explícito): moneda operativa ÚNICA de la tienda — de
  // qué conjunto elegir depende de lo que el admin dejó activo ("Marca de
  // la plataforma"), nunca un enum fijo hardcodeado acá.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const availableCurrencies = settings?.availableCurrencies ?? ["CUP", "USD", "EUR", "MXN"];

  const createVendor = useMutation({
    mutationFn: async () =>
      (
        await api.post("/vendors", {
          companyName: form.companyName,
          // Bloque 113: ya no se piden de nuevo — son los mismos datos de
          // la cuenta con la que este usuario ya entró.
          ownerName: user.fullName,
          email: user.email,
          whatsapp: user.phone,
          ownerIdNumber: form.ownerIdNumber,
          companyAddress: form.companyAddress,
          description: form.description || undefined,
          isRestaurant: form.isRestaurant,
          tableCount: form.isRestaurant ? Number(form.tableCount) : undefined,
          businessCategoryId: form.businessCategoryId,
          locations: [
            {
              countryId: form.countryId,
              provinceId: form.provinceId || undefined,
              municipalityId: form.municipalityId || undefined,
              stateOther: form.stateOther.trim() || undefined,
            },
          ],
        })
      ).data,
    onSuccess: async () => {
      // Mismo fix que Account.jsx: el accessToken vigente todavía dice el
      // role viejo (CUSTOMER) hasta que se refresca.
      await refreshRole();
      setShowPlanModal(true);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo crear la tienda."),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.countryId) {
      toast.error("Elige el país donde va a operar tu tienda.");
      return;
    }
    if (isCuba) {
      if (!form.provinceId) {
        toast.error("Elige la provincia donde va a operar tu tienda.");
        return;
      }
      if (!form.municipalityId) {
        toast.error("Elige el municipio donde va a operar tu tienda.");
        return;
      }
    } else if (!form.stateOther.trim()) {
      toast.error("Elige el estado donde va a operar tu tienda.");
      return;
    }
    if (!form.companyAddress.trim()) {
      toast.error("Indica la dirección de la empresa.");
      return;
    }
    createVendor.mutate();
  }

  if (showPlanModal) {
    return (
      <PlanComparisonModal
        onContinueRegular={() => {
          setShowPlanModal(false);
          navigate("/vendedor");
        }}
      />
    );
  }

  if (!user) {
    return (
      <div className="container-app py-14 text-center">
        <p className="text-body-lg text-on-surface-variant">Necesitas una cuenta para crear tu tienda.</p>
        <Button className="mt-4" onClick={() => navigate("/cuenta")}>Crear cuenta o entrar</Button>
      </div>
    );
  }

  return (
    <div className="container-app flex justify-center py-14">
      <Card className="w-full max-w-xl p-8">
        <h1 className="mb-2 text-headline-md text-on-surface">Crea tu tienda gratis</h1>
        <p className="mb-6 text-body-md text-on-surface-variant">
          Empiezas en el Plan Regular: hasta 20 productos y ventas por WhatsApp. Puedes escalar a Business cuando quieras.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nombre de la tienda (público)" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          {/* Bloque 113 (pedido explícito): ya no se pide de nuevo el
              nombre del responsable — es el mismo con el que ya tiene
              cuenta (user.fullName). Solo el aviso de que debe coincidir
              con su identificación, ya que se puede verificar más adelante. */}
          <div className="rounded-lg border border-outline-variant bg-surface-container p-3.5">
            <p className="text-label-sm font-semibold text-on-surface">
              Responsable del negocio: <span className="font-bold">{user.fullName}</span>
            </p>
            <p className="mt-1 text-label-sm text-outline">
              Este nombre debe coincidir con tu documento de identidad — se puede llegar a verificar más adelante, de ser necesario.
            </p>
          </div>
          <div>
            <Input
              label="Identificación del responsable"
              required
              placeholder="Carnet de identidad / RIF / NIT"
              value={form.ownerIdNumber}
              onChange={(e) => setForm({ ...form, ownerIdNumber: e.target.value })}
            />
            <div className="mt-3.5">
              <Input
                label="Dirección de la empresa"
                required
                placeholder="Calle, número, municipio, provincia"
                value={form.companyAddress}
                onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
              />
            </div>
            <p className="mt-1 text-label-sm text-outline">Privado — se usa para autocompletar facturas y garantías que generes desde Pedidos.</p>
          </div>
          <Input label="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

          {/* Bloque 113 (pedido explícito): país → provincia/estado →
              municipio (Cuba) en cascada, solo con los agregados por el
              admin — antes era un select plano de provincia, sin país ni
              municipio. */}
          <Select
            label="País donde va a operar tu tienda"
            required
            value={form.countryId}
            onChange={(e) => setForm({ ...form, countryId: e.target.value, provinceId: "", municipalityId: "", stateOther: "" })}
          >
            <option value="">Selecciona un país...</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>

          {form.countryId && isCuba && (
            <>
              <Select
                label="Provincia donde prestas servicio"
                required
                value={form.provinceId}
                onChange={(e) => setForm({ ...form, provinceId: e.target.value, municipalityId: "" })}
              >
                <option value="">Selecciona...</option>
                {provincesForCountry.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
              <Select
                label="Municipio donde prestas servicio"
                required
                disabled={!form.provinceId}
                value={form.municipalityId}
                onChange={(e) => setForm({ ...form, municipalityId: e.target.value })}
              >
                <option value="">Selecciona...</option>
                {municipalitiesForProvince.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </>
          )}

          {form.countryId && !isCuba && (
            <Input
              label="Estado donde prestas servicio"
              required
              value={form.stateOther}
              onChange={(e) => setForm({ ...form, stateOther: e.target.value })}
            />
          )}

          <div>
            <div className="flex items-center gap-2.5">
              <Select
                label="Tipo de negocio"
                required
                value={form.businessCategoryId}
                onChange={(e) => setForm({ ...form, businessCategoryId: e.target.value })}
                className="flex-1"
              >
                <option value="">Selecciona el rubro de tu tienda</option>
                {businessCategories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {selectedBusinessCategory && (
                <div className="mt-6 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-tertiary-accent/10">
                  <CategoryIcon name={selectedBusinessCategory.icon} className="h-5 w-5 text-tertiary-accent" />
                </div>
              )}
            </div>
            <p className="mt-1 text-label-sm text-outline">Puedes cambiarlo después desde tu panel.</p>
          </div>

          <label className="flex items-center gap-2 text-body-md text-on-surface">
            <input type="checkbox" checked={form.isRestaurant} onChange={(e) => setForm({ ...form, isRestaurant: e.target.checked })} />
            Soy un restaurante / cafetería / bar
          </label>

          {form.isRestaurant && (
            <div>
              <Input
                label="Número de mesas"
                type="number"
                min={1}
                required
                value={form.tableCount}
                onChange={(e) => setForm({ ...form, tableCount: e.target.value })}
              />
              <p className="mt-1 text-label-sm text-outline">
                Generamos un código QR por cada mesa apenas creas la tienda. Los pedidos te van a llegar al panel de vendedor.
              </p>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={createVendor.isPending}>
            {createVendor.isPending ? "Creando..." : "Crear mi tienda"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
