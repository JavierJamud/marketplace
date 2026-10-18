import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useUnsavedGuard } from "../../lib/unsavedGuard.jsx";
import { Input } from "../ui/Input.jsx";
import { IdCard, BookUser, Contact, Check } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { LocationPicker } from "../LocationPicker.jsx";
import { CameraCapture } from "../CameraCapture.jsx";

// Formulario de verificación de identidad (documento, selfie y datos legales). Vive aparte para usarlo en dos lugares con el
// mismo comportamiento: la página "Verificación y plan" y el paso de identidad de "Completa tu tienda".
// `onSubmitted` se llama cuando el servidor aceptó la solicitud (para refrescar lo que dependa de ella).
// Documentos aceptados y cómo se llaman sus datos: el formulario se adapta al que elige la persona.
const DOC_TYPES = [
  { value: "NATIONAL_ID", label: "Carné de identidad", short: "carné de identidad", hint: "Tiene frente y reverso", Icon: IdCard, numberLabel: "Número del carné de identidad", numberPlaceholder: "Ej.: 85010112345" },
  { value: "PASSPORT", label: "Pasaporte", short: "pasaporte", hint: "Solo la página con tu foto", Icon: BookUser, numberLabel: "Número de pasaporte", numberPlaceholder: "Ej.: K1234567" },
  { value: "INTERNATIONAL_ID", label: "Carné de extranjería", short: "carné de extranjería", hint: "Tiene frente y reverso", Icon: Contact, numberLabel: "Número del carné de extranjería", numberPlaceholder: "Ej.: E12345678" },
];

// Un paso del formulario: número (o check al completarlo), título y contenido.
function KycStep({ n, title, done, note, children }) {
  return (
    <section className="mb-5 border-t border-surface-container-high pt-4 first-of-type:border-t-0 first-of-type:pt-0" aria-labelledby={`kyc-step-${n}`}>
      <h3 id={`kyc-step-${n}`} className="mb-1 flex items-center gap-2.5 text-[14px] font-bold text-on-surface">
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12.5px] font-extrabold ${done ? "bg-verified text-white" : "bg-secondary-container text-on-secondary-container"}`}>
          {done ? <Check className="h-4 w-4" strokeWidth={3} aria-label="Hecho" /> : n}
        </span>
        {title}
      </h3>
      {note && <p className="mb-3 ml-[38px] text-[12px] text-on-surface-variant">{note}</p>}
      <div className={note ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

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
  const docType = DOC_TYPES.find((d) => d.value === idDocumentType) ?? null;
  const idDataDone = fullName.trim().length >= 2 && idNumber.trim().length >= 4;
  const legalDone = !(legalLoc.countryOther.trim() ? !legalLoc.stateOther.trim() : !!legalStatus.error) && !!companyAddress.trim();

  // Qué falta en este formulario, en el orden en que aparece. El botón se activa cuando la lista queda vacía.
  const formMissing = [
    !idDocumentType && "tipo de documento",
    fullName.trim().length < 2 && "nombre completo del responsable",
    idNumber.trim().length < 4 && `${docType ? docType.numberLabel.toLowerCase() : "número del documento"} (4 caracteres o más)`,
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
        Privados y cifrados. Elige tu documento y sigue los pasos: cada uno se abre al completar el anterior.
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

      {/* Pasos guiados: primero el tipo de documento y, según cuál, sus datos; después los datos legales y por último las fotos.
          Cada paso se abre al completar el anterior (los anteriores siguen a la vista para corregirlos). */}
      <KycStep n={1} title="¿Qué documento vas a presentar?" done={!!idDocumentType}>
        <div role="radiogroup" aria-label="Tipo de documento" className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {DOC_TYPES.map((d) => (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={idDocumentType === d.value}
              onClick={() => setIdDocumentType(d.value)}
              className={`flex min-h-14 items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${idDocumentType === d.value ? "border-tertiary-accent bg-tertiary-accent/[0.07]" : "border-outline-variant hover:border-tertiary-accent/60"}`}
            >
              <d.Icon className="h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
              <span>
                <span className="block text-[13.5px] font-bold text-on-surface">{d.label}</span>
                <span className="block text-[11.5px] text-on-surface-variant">{d.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </KycStep>

      {docType && (
        <KycStep n={2} title={`Datos de tu ${docType.short}`} done={idDataDone}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Input data-guard="name" label={`Nombre completo, como aparece en el ${docType.short}`} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input label={docType.numberLabel} required value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder={docType.numberPlaceholder} />
          </div>
        </KycStep>
      )}

      {docType && idDataDone && (
        <KycStep n={3} title="Datos legales de la tienda" done={legalDone} note="Privados: nunca se muestran en tu perfil público.">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
              <Input label="Dirección de la empresa" required value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="Ej.: Calle 23 #456, Vedado, La Habana" />
            </div>
          </div>
        </KycStep>
      )}

      {docType && idDataDone && legalDone && (
        <KycStep n={4} title="Fotos" done={!!selfieBlob && !!idBlob && (!needsBack || !!idBackBlob)} note="Captura en vivo con la cámara: no se aceptan fotos de la galería.">
          {/* min-w-0 en cada celda: sin esto, el ancho real del video de la cámara estira la columna y saca el formulario de la
              pantalla del celular. */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 [&>*]:min-w-0">
            <div>
              <p className="mb-1.5 text-[11.5px] text-outline">Tu cara: tiene que coincidir con la foto de tu {docType.short}.</p>
              <CameraCapture shape="oval" label="Foto del responsable" instructions="Centra tu cara dentro del óvalo" facingMode="user" onCaptured={setSelfieBlob} onVideoCaptured={setSelfieVideoBlob} />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] text-outline">{needsBack ? `Frente de tu ${docType.short}` : `La página con tu foto del ${docType.short}`}, bien enfocado y legible.</p>
              <CameraCapture shape="rect" label={needsBack ? `${docType.label} (frente)` : docType.label} instructions="Alinea el documento dentro del marco" facingMode="environment" onCaptured={setIdBlob} />
            </div>
            {needsBack && (
              <div>
                <p className="mb-1.5 text-[11.5px] text-outline">Reverso de tu {docType.short} (la otra cara), también legible.</p>
                <CameraCapture shape="rect" label={`${docType.label} (reverso)`} instructions="Da vuelta el documento y alinéalo en el marco" facingMode="environment" onCaptured={setIdBackBlob} />
              </div>
            )}
          </div>
        </KycStep>
      )}

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
