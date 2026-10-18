import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useUnsavedGuard } from "../../lib/unsavedGuard.jsx";
import { Input } from "../ui/Input.jsx";
import { Select } from "../ui/Select.jsx";
import { Button } from "../ui/Button.jsx";
import { LocationPicker } from "../LocationPicker.jsx";
import { CameraCapture } from "../CameraCapture.jsx";

// Formulario de verificación de identidad (documento, selfie y datos legales). Vive aparte para usarlo en dos lugares con el
// mismo comportamiento: la página "Verificación y plan" y el paso de identidad de "Completa tu tienda".
// `onSubmitted` se llama cuando el servidor aceptó la solicitud (para refrescar lo que dependa de ella).
export function KycSubmitForm({ vendor, siteName, onSubmitted }) {
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [selfieBlob, setSelfieBlob] = useState(null);
  const [idBlob, setIdBlob] = useState(null);
  // Reverso del documento: obligatorio salvo con pasaporte (no tiene reverso), igual que exige el servidor.
  const [idBackBlob, setIdBackBlob] = useState(null);
  // Bloque 146: opcional — solo se llena si el navegador soporta detección
  // de rostro + MediaRecorder (ver CameraCapture.jsx). Nunca bloquea el
  // envío si queda en null.
  const [selfieVideoBlob, setSelfieVideoBlob] = useState(null);
  // Bloque 66 (pedido explícito): datos legales de la tienda, pedidos desde
  // el arranque del trámite junto con los documentos — nunca en una fase
  // posterior. Todos privados (nunca se exponen en el perfil público).
  const [idDocumentType, setIdDocumentType] = useState("");
  const [companyTaxId, setCompanyTaxId] = useState("");
  // Bloque 165 (bug real reportado en vivo — una tienda llegaba a VERIFIED
  // con esto vacío porque nunca se lo pedía en ningún lado): obligatorio
  // desde el arranque del trámite, junto con el resto de los datos legales.
  const [companyAddress, setCompanyAddress] = useState("");
  // Bloque 247 (pedido explícito — "no deben quedar bloqueados los negocios"):
  // país, provincia y municipio de registro legal salen del catálogo o se
  // escriben a mano (mismo selector del registro). `stateOther` es el nombre
  // que usa LocationPicker para la provincia escrita a mano.
  const [legalLoc, setLegalLoc] = useState({ countryId: "", countryOther: "", provinceId: "", municipalityId: "", municipalityOther: "", stateOther: "" });
  const [legalStatus, setLegalStatus] = useState({ error: "Cargando ubicación." });
  const [legalPrefilled, setLegalPrefilled] = useState(false);

  // Precarga la ubicación legal con lo que el negocio ya registró (primero lo
  // que quedó de un envío anterior, si no, el lugar donde opera): así un
  // negocio con una provincia escrita a mano en el registro no tiene que
  // volver a buscarla en una lista donde todavía no aparece.
  useEffect(() => {
    if (legalPrefilled || !vendor) return;
    const loc = vendor.locations?.[0];
    const hasLegal = vendor.registrationCountryId || vendor.registrationCountryOther;
    setLegalLoc(
      hasLegal
        ? {
            countryId: vendor.registrationCountryId ?? "",
            countryOther: vendor.registrationCountryOther ?? "",
            provinceId: vendor.legalProvinceId ?? "",
            municipalityId: vendor.legalMunicipalityId ?? "",
            municipalityOther: vendor.legalMunicipalityOther ?? "",
            stateOther: vendor.legalProvinceOther ?? "",
          }
        : {
            countryId: loc?.countryId ?? "",
            countryOther: loc?.countryOther ?? "",
            provinceId: loc?.provinceId ?? "",
            municipalityId: loc?.municipalityId ?? "",
            municipalityOther: loc?.municipalityOther ?? "",
            stateOther: loc?.stateOther ?? "",
          }
    );
    setLegalPrefilled(true);
  }, [vendor, legalPrefilled]);

  // Aviso al salir con datos escritos o fotos tomadas que todavía no se enviaron. El trámite no se puede guardar a medias:
  // solo se puede descartar o seguir completándolo.
  useUnsavedGuard(!!(fullName || idNumber || companyTaxId || selfieBlob || idBlob || selfieVideoBlob || idDocumentType), undefined);

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (fullName) form.append("fullName", fullName);
      form.append("idNumber", idNumber);
      form.append("idDocumentType", idDocumentType);
      if (companyTaxId) form.append("companyTaxId", companyTaxId);
      form.append("companyAddress", companyAddress);
      if (legalLoc.countryId) form.append("registrationCountryId", legalLoc.countryId);
      if (legalLoc.countryOther.trim()) form.append("registrationCountryOther", legalLoc.countryOther.trim());
      if (legalLoc.provinceId) form.append("legalProvinceId", legalLoc.provinceId);
      if (legalLoc.stateOther.trim()) form.append("legalProvinceOther", legalLoc.stateOther.trim());
      if (legalLoc.municipalityId) form.append("legalMunicipalityId", legalLoc.municipalityId);
      if (legalLoc.municipalityOther.trim()) form.append("legalMunicipalityOther", legalLoc.municipalityOther.trim());
      form.append("selfie", selfieBlob, "selfie.jpg");
      form.append("idDocument", idBlob, "documento.jpg");
      if (idBackBlob && idDocumentType !== "PASSPORT") form.append("idDocumentBack", idBackBlob, "documento-reverso.jpg");
      // Bloque 146: opcional — solo se manda si el navegador lo pudo grabar.
      if (selfieVideoBlob) form.append("selfieVideo", selfieVideoBlob, "selfie-video.webm");
      return (await api.post("/verification/me", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Solicitud enviada. Un admin de ${siteName || "Baznova"} va a revisar tus documentos pronto.`);
      setSelfieBlob(null);
      setIdBlob(null);
      setIdBackBlob(null);
      setSelfieVideoBlob(null);
      onSubmitted?.();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la solicitud."),
  });

  // Lo que la tienda tiene que tener antes de enviar (datos, descripción, zona, logo, un producto): lo mismo que revisa el
  // servidor. Se muestra con un enlace a "Completa tu tienda", donde se hace cada cosa.
  const { data: trial } = useQuery({ queryKey: ["vendor-trial"], queryFn: async () => (await api.get("/vendors/me/trial")).data.trial });
  const KYC_KEYS = new Set(["companyAddress", "registrationCountryId", "legalProvinceId", "idDocument", "selfie"]);
  const storeMissing = (trial?.checklist ?? []).filter((c) => !c.done && !KYC_KEYS.has(c.key)).map((c) => c.label.toLowerCase());
  const needsBack = idDocumentType !== "PASSPORT";

  // Qué falta en este formulario, en el orden en que aparece. El botón se activa cuando la lista queda vacía.
  const formMissing = [
    fullName.trim().length < 2 && "nombre completo del responsable",
    idNumber.trim().length < 4 && "número de identidad (4 caracteres o más)",
    !idDocumentType && "tipo de documento",
    (legalLoc.countryOther.trim() ? !legalLoc.stateOther.trim() : !!legalStatus.error) && "país y provincia de registro legal",
    !companyAddress.trim() && "dirección de la empresa",
    !selfieBlob && "foto del responsable",
    !idBlob && (needsBack ? "foto del frente del documento" : "foto del documento"),
    needsBack && !idBackBlob && "foto del reverso del documento",
  ].filter(Boolean);
  const canSubmit = !submit.isPending && storeMissing.length === 0 && formMissing.length === 0;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 text-[15px] font-bold text-on-surface">Documentos</div>
      <p className="mb-4 text-[12.5px] text-outline">
        Privados y cifrados. Captura en vivo desde tu cámara — no se acepta subir fotos de la galería.
      </p>

      {storeMissing.length > 0 && (
        <div className="mb-4 rounded-xl bg-error/10 px-4 py-3 text-[13px] text-on-surface" role="status">
          <p className="font-bold text-error">Antes de enviar tus documentos, completa tu tienda:</p>
          <p className="mt-1">{storeMissing.join(", ")}.</p>
          <Link to="/vendedor/completar" className="mt-2 inline-flex min-h-11 items-center font-bold text-tertiary-accent underline">
            Completarlo en "Completa tu tienda"
          </Link>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Input data-guard="name" label="Nombre completo del responsable" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Input label="Número de identidad" required value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
      </div>

      <div className="mb-4">
        <Select label="Tipo de documento" required value={idDocumentType} onChange={(e) => setIdDocumentType(e.target.value)}>
          <option value="" disabled>Elige cuál presentas...</option>
          <option value="NATIONAL_ID">Carné de identidad</option>
          <option value="PASSPORT">Pasaporte</option>
          <option value="INTERNATIONAL_ID">Carné de extranjería</option>
        </Select>
      </div>

      <p className="mb-1 text-[13px] font-bold text-on-surface">Datos legales de la tienda</p>
      <p className="mb-3 text-label-sm text-outline">
        Privados — nunca se muestran en tu perfil público (eso se configura aparte).
      </p>
      <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Input
          label={vendor?.ownerIdNumber ? "ID fiscal de la empresa (opcional, ya tienes ID personal)" : "ID fiscal de la empresa"}
          value={companyTaxId}
          onChange={(e) => setCompanyTaxId(e.target.value)}
        />
        <div className="sm:col-span-2">
          <LocationPicker
            value={legalLoc}
            onChange={(patch) => setLegalLoc((prev) => ({ ...prev, ...patch }))}
            onStatus={setLegalStatus}
            labels={{
              country: "País de registro legal",
              countryOther: "Escribe el país de registro legal",
              province: "Provincia o estado de registro legal",
              provinceOther: "Escribe la provincia o estado de registro legal",
              municipality: "Municipio de registro legal",
              municipalityOther: "Escribe el municipio de registro legal",
            }}
          />
          {legalLoc.countryOther.trim() && (
            <div className="mt-4">
              <Input
                label="Provincia o estado de registro legal"
                required
                maxLength={80}
                value={legalLoc.stateOther}
                onChange={(e) => setLegalLoc((prev) => ({ ...prev, stateOther: e.target.value }))}
              />
            </div>
          )}
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Dirección de la empresa"
            required
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
            placeholder="Ej.: Calle 23 #456, Vedado, La Habana"
          />
        </div>
      </div>

      {/* min-w-0 en cada celda: sin esto, el ancho real del video de la cámara estira la columna y saca el formulario de la
          pantalla del celular. */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          {/* Bloque 146 (pedido explícito — "debe indicar que tiene que
              ser la foto de la persona responsable, debe coincidir con
              la foto del documento de identidad"): esta aclaración
              vivía en ningún lado antes — el óvalo no explicaba para
              qué es ni contra qué se compara. */}
          <p className="mb-1.5 text-[11.5px] text-outline">
            Foto de la cara de la persona responsable — tiene que coincidir con la foto del documento de identidad que subes al
            lado.
          </p>
          <CameraCapture
            shape="oval"
            label="Foto del responsable"
            instructions="Centra tu cara dentro del óvalo"
            facingMode="user"
            onCaptured={setSelfieBlob}
            onVideoCaptured={setSelfieVideoBlob}
          />
        </div>
        <div>
          <p className="mb-1.5 text-[11.5px] text-outline">
            {needsBack ? "Frente del documento" : "Documento"}, bien enfocado y legible: el mismo tipo que elegiste arriba.
          </p>
          <CameraCapture
            shape="rect"
            label={needsBack ? "Documento (frente)" : "Documento de identidad"}
            instructions="Alinea el documento dentro del marco"
            facingMode="environment"
            onCaptured={setIdBlob}
          />
        </div>
        {needsBack && (
          <div>
            <p className="mb-1.5 text-[11.5px] text-outline">Reverso del documento (la otra cara), también legible.</p>
            <CameraCapture shape="rect" label="Documento (reverso)" instructions="Da vuelta el documento y alinéalo en el marco" facingMode="environment" onCaptured={setIdBackBlob} />
          </div>
        )}
      </div>

      <Button className="mt-4" onClick={() => submit.mutate()} disabled={!canSubmit}>
        {submit.isPending ? "Enviando..." : "Enviar solicitud"}
      </Button>
      {!submit.isPending && formMissing.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-[18px] text-on-surface-variant" role="status">
          Para enviar falta: <span className="font-semibold text-on-surface">{formMissing.join(", ")}</span>.
        </p>
      )}
    </div>
  );
}
