import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { vendorSectionLabel } from "../../lib/vendorSections.js";
import { staffTypeLabel } from "../../lib/staffTypes.js";
import { DeleteAccountCard } from "../../components/DeleteAccountCard.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Bloque 183 (pedido explícito — "esa foto saldrá en el perfil del usuario
// o en el dashboard del usuario donde podrá ver su foto con su nombre, su
// correo electrónico, el nombre del negocio al que pertenece y podrá ver
// la sección a la que tiene acceso... los usuarios desde adentro podrán
// cambiar sus contraseñas, pero no la información de nombre ni correo"):
// a diferencia de VendorProfile.jsx (el dueño, que edita todo), acá TODO
// es de solo lectura salvo la contraseña — reusa el mismo endpoint
// genérico PATCH /auth/me/password que ya usa VendorProfile/AdminProfile.
export default function StaffProfile() {
  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-staff-profile"],
    queryFn: async () => (await api.get("/vendor-staff/me/profile")).data,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => (await api.patch("/auth/me/password", { currentPassword, newPassword, confirmPassword })).data,
    onSuccess: () => {
      toast.success("Contraseña actualizada.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cambiar la contraseña."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const photo = imgUrl(profile.photoUrl);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-5 font-display text-[26px] font-extrabold tracking-tight text-on-surface">Mi perfil</h1>

      <div className="mb-5 flex flex-col items-center gap-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 text-center">
        {photo ? (
          <img src={photo} alt={profile.fullName} className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary-container font-display text-3xl font-bold text-on-secondary-container">
            {profile.fullName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-title-lg font-bold text-on-surface">{profile.fullName}</p>
          <p className="text-[13px] text-outline">{profile.email}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-surface-container px-3.5 py-1.5 text-[12.5px] font-semibold text-on-surface-variant">
          {profile.vendorLogoUrl && <img src={imgUrl(profile.vendorLogoUrl)} alt="" className="h-4 w-4 rounded-full object-cover" />}
          Usuario de {profile.vendorName}
        </div>
        {profile.staffType && (
          <span className="rounded-full bg-tertiary-accent/10 px-3.5 py-1 text-[12px] font-bold text-tertiary-accent">
            {staffTypeLabel(profile.staffType)}
          </span>
        )}
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-outline">Acceso a:</p>
          {profile.allowedSections.length === 0 ? (
            <p className="text-[12px] text-outline">Todavía no tienes acceso a ninguna sección — pídeselo a tu administrador.</p>
          ) : (
            <div className="flex flex-wrap justify-center gap-1.5">
              {profile.allowedSections.map((key) => {
                const isViewOnly = (profile.sectionPermissions?.[key] ?? "manage") === "view";
                return (
                  <span key={key} className="rounded-full bg-tertiary-accent/10 px-3 py-1 text-[11.5px] font-bold text-tertiary-accent">
                    {vendorSectionLabel(key)}
                    {isViewOnly && " · solo ver"}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6">
        <h2 className="mb-1 text-title-lg font-bold text-on-surface">Cambiar mi contraseña</h2>
        <p className="mb-4 text-[12.5px] text-outline">
          Tu nombre y correo los administra {profile.vendorName} — si necesitas corregirlos, pídeselo a tu administrador.
        </p>
        <div className="flex flex-col gap-3">
          <Input label="Contraseña actual" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <Input label="Contraseña nueva" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Input label="Confirmar contraseña nueva" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <Button
          className="mt-4 w-full"
          disabled={changePassword.isPending || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
          onClick={() => changePassword.mutate()}
        >
          {changePassword.isPending ? "Guardando..." : "Cambiar contraseña"}
        </Button>
      </div>

      <DeleteAccountCard />
    </div>
  );
}
