import { useEffect, useRef, useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { Spinner } from "./ui/Spinner.jsx";

// Nombre de usuario de la tienda = su enlace (baznova.com/tienda/<usuario>). Mismas reglas que backend/src/lib/username.js:
// 3 a 20 caracteres, minúsculas, números, punto y guion bajo. Mientras escribes se revisa en el servidor si ya lo usa otra
// tienda. `suggestFrom`: el nombre de la tienda; mientras la persona no toque el campo, se rellena con una propuesta.
// `current`: el usuario actual (al editar), que no cuenta como ocupado.

export const USERNAME_MAX = 20;

export function usernameFormatError(u) {
  if (u.length < 3) return "Al menos 3 caracteres.";
  if (u.length > USERNAME_MAX) return `Hasta ${USERNAME_MAX} caracteres.`;
  if (!/^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(u)) return "Solo minúsculas, números, punto o guion bajo. Sin empezar ni terminar con signo.";
  if (/[._]{2}/.test(u)) return "Sin dos signos seguidos (.. o __).";
  return null;
}

const clean = (v) => v.toLowerCase().replace(/^@/, "").replace(/\s+/g, ".").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._]/g, "");

export function UsernameField({ value, onChange, onStatus, suggestFrom = "", current = null, siteHost = "baznova.com" }) {
  const [touched, setTouched] = useState(!!value);
  const [status, setStatus] = useState({ state: "idle", message: "" }); // idle | checking | ok | error
  const timer = useRef(null);

  // Propuesta del servidor con el nombre de la tienda, solo si la persona todavía no escribió el suyo.
  useEffect(() => {
    if (touched || !suggestFrom.trim()) return undefined;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/vendors/username-check", { params: { name: suggestFrom } });
        if (data.suggestion) onChange(data.suggestion);
      } catch {
        /* sin propuesta: la persona lo escribe */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [suggestFrom, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clearTimeout(timer.current);
    if (!value) return setStatus({ state: "idle", message: "" });
    if (current && value === current) return setStatus({ state: "ok", message: "Es tu nombre de usuario actual." });
    const formatError = usernameFormatError(value);
    if (formatError) return setStatus({ state: "error", message: formatError });
    setStatus({ state: "checking", message: "Revisando..." });
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/vendors/username-check", { params: { u: value } });
        setStatus(data.available ? { state: "ok", message: "Disponible." } : { state: "error", message: data.message });
      } catch {
        setStatus({ state: "idle", message: "" });
      }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [value, current]);

  useEffect(() => {
    onStatus?.(status.state);
  }, [status.state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="block">
      <span className="mb-1 block text-label-md text-on-surface-variant">
        Nombre de usuario <span className="text-error">*</span>
      </span>
      <div
        className={`flex h-12 items-center overflow-hidden rounded-xl border bg-surface-container-lowest focus-within:border-tertiary-accent ${
          status.state === "error" ? "border-error" : "border-outline-variant"
        }`}
      >
        <span className="hidden flex-shrink-0 pl-3 text-[13px] text-outline sm:inline">{siteHost}/tienda/</span>
        <span className="flex-shrink-0 pl-3 text-[14px] text-outline sm:hidden">@</span>
        <input
          value={value}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setTouched(true);
            onChange(clean(e.target.value));
          }}
          className="h-full min-w-0 flex-1 bg-transparent pr-3 text-[14px] text-on-surface outline-none sm:pl-0.5"
          aria-describedby="username-help"
        />
        <span className="flex-shrink-0 pr-3">
          {status.state === "checking" && <Spinner className="text-tertiary-accent" />}
          {status.state === "ok" && <Check className="h-4 w-4 text-verified-dark" />}
          {status.state === "error" && <AlertCircle className="h-4 w-4 text-error" />}
        </span>
      </div>
      <span id="username-help" className={`mt-1 block text-label-sm ${status.state === "error" ? "text-error" : "text-outline"}`}>
        {status.message || `Es el enlace de tu tienda. De 3 a ${USERNAME_MAX} caracteres: minúsculas, números, punto o guion bajo.`}
        {value && status.state !== "error" ? ` ${siteHost}/tienda/${value}` : ""}
      </span>
    </label>
  );
}
