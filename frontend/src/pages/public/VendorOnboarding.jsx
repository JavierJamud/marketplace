import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { PhoneInput } from "../../components/ui/PhoneInput.jsx";
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
    ownerName: "",
    ownerIdNumber: "",
    companyAddress: "",
    description: "",
    whatsapp: "",
    email: "",
    isRestaurant: false,
    tableCount: "",
    provinceId: "",
    businessCategoryId: "",
  });
  const [showPlanModal, setShowPlanModal] = useState(false);

  // El correo de la tienda es obligatorio (Bloque 11) — se prellena con el
  // correo de la cuenta, el usuario puede reusarlo o cambiarlo.
  useEffect(() => {
    if (user?.email && !form.email) setForm((f) => ({ ...f, email: user.email }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const { data: provinces } = useQuery({
    queryKey: ["provinces"],
    queryFn: async () => (await api.get("/locations/provinces")).data.provinces,
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
          ownerName: form.ownerName,
          ownerIdNumber: form.ownerIdNumber,
          companyAddress: form.companyAddress,
          description: form.description || undefined,
          whatsapp: form.whatsapp,
          email: form.email,
          isRestaurant: form.isRestaurant,
          tableCount: form.isRestaurant ? Number(form.tableCount) : undefined,
          businessCategoryId: form.businessCategoryId,
          locations: [{ provinceId: form.provinceId }],
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

        <form onSubmit={(e) => { e.preventDefault(); createVendor.mutate(); }} className="space-y-4">
          <Input label="Nombre de la tienda (público)" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <div>
            <Input label="Nombre del responsable del negocio" required value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
            <p className="mt-1 text-label-sm text-outline">Privado — solo lo ven admin y tú. No se muestra en tu tienda pública.</p>
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
          <PhoneInput label="WhatsApp de la tienda" required value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
          <div>
            <Input label="Correo de la tienda" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <p className="mt-1 text-label-sm text-outline">Puedes usar el mismo correo de tu cuenta o uno distinto.</p>
          </div>

          <Select label="Provincia donde prestas servicio" required value={form.provinceId} onChange={(e) => setForm({ ...form, provinceId: e.target.value })}>
            <option value="">Selecciona una provincia</option>
            {provinces?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>

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
