import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Share, SquarePlus, MoreVertical, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { APPS, detectInstalled, devicePlatform, isIos, onInstallAvailability, promptInstall } from "../../lib/pwa.js";
import { useAuth } from "../../context/AuthContext.jsx";

// Botones "Android" y "iPhone" del footer para instalar la app de compras (Baznova Marketplace).
//  - Android: si Chrome ya ofrece instalar, un toque abre su ventana y la app queda en el menú de aplicaciones. Si no la
//    ofrece (otro navegador, o ya instalada), se explica qué hacer.
//  - iPhone: Apple no permite instalar desde un botón; se muestran los dos pasos de Safari (Compartir → Añadir a pantalla
//    de inicio). Desde una computadora se muestra un QR para abrir la página en el teléfono.
// Antes de nada se comprueba si ya está instalada (detectInstalled) para no ofrecerla dos veces.
const APP = APPS.cliente;

function AndroidGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="currentColor">
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 00-.66-.38l-1.86 3.22a11.5 11.5 0 00-9.84 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="currentColor">
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.18-.02 1.93-1.08 2.66-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.29-3.54zM14.18 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z" />
    </svg>
  );
}

function Step({ n, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-secondary-container text-[13px] font-extrabold text-on-secondary-container">{n}</span>
      <span className="pt-0.5 text-[14px] leading-[21px] text-on-surface">{children}</span>
    </li>
  );
}

function HowToModal({ kind, onClose }) {
  const onPhone = devicePlatform() !== "desktop";
  const pageUrl = `${window.location.origin}/`;
  return (
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="app-howto-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-2xl bg-surface-container-lowest p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="app-howto-title" className="font-display text-[19px] font-extrabold text-on-surface">
            {kind === "installed" ? "Ya tienes la app" : kind === "ios" ? "Instalar en iPhone o iPad" : "Instalar en Android"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>

        {kind === "installed" && <p className="text-[14px] leading-[21px] text-on-surface-variant">Búscala como "{APP.name}" en tu pantalla de inicio o en el menú de aplicaciones. Si la borraste, vuelve a tocar el botón dentro de unos días o instálala desde el menú del navegador.</p>}

        {kind !== "installed" && !onPhone && (
          <div className="mb-4 flex items-center gap-4 rounded-xl bg-surface-container/60 p-3">
            <QRCodeSVG value={pageUrl} size={96} className="flex-shrink-0 rounded bg-white p-1.5" />
            <p className="text-[13px] leading-[19px] text-on-surface-variant">Escanea este código con la cámara del teléfono para abrir Baznova allí y sigue los pasos.</p>
          </div>
        )}

        {kind === "ios" && (
          <ol className="grid gap-3">
            <Step n={1}>Abre Baznova en <b>Safari</b> (en otros navegadores el paso puede no aparecer).</Step>
            <Step n={2}>
              Toca <Share className="inline h-4 w-4 align-[-2px]" aria-label="Compartir" /> <b>Compartir</b>, abajo en el centro.
            </Step>
            <Step n={3}>
              Elige <SquarePlus className="inline h-4 w-4 align-[-2px]" aria-hidden="true" /> <b>Añadir a pantalla de inicio</b> y toca <b>Añadir</b>.
            </Step>
          </ol>
        )}

        {kind === "android" && (
          <ol className="grid gap-3">
            <Step n={1}>Abre Baznova en <b>Chrome</b>.</Step>
            <Step n={2}>
              Toca el menú <MoreVertical className="inline h-4 w-4 align-[-2px]" aria-label="menú" /> arriba a la derecha.
            </Step>
            <Step n={3}>
              Elige <b>Instalar aplicación</b> (o <b>Añadir a pantalla de inicio</b>) y confirma.
            </Step>
          </ol>
        )}
      </div>
    </div>
  );
}

export function AppDownloadButtons() {
  const { user } = useAuth();
  const [canInstall, setCanInstall] = useState(false);
  const [modal, setModal] = useState(null); // "android" | "ios" | "installed"
  const [busy, setBusy] = useState(false);
  useEffect(() => onInstallAvailability((p) => setCanInstall(!!p)), []);

  const install = async (target) => {
    setBusy(true);
    const { installed } = await detectInstalled(APP, { loggedIn: !!user });
    setBusy(false);
    const platform = devicePlatform();
    // En un iPhone el botón de Android no sirve: se muestran los pasos de iPhone.
    const realTarget = target === "android" && isIos() ? "ios" : target;
    // "Ya instalada" solo vale para este mismo dispositivo (en una computadora, el botón de iPhone muestra el QR igual).
    const sameDevice = realTarget === "ios" ? platform === "ios" : platform !== "ios";
    if (installed && sameDevice) return setModal("installed");
    // Android (y computadora con Chrome o Edge): un toque abre la ventana de instalación del navegador.
    if (realTarget === "android" && canInstall) {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        toast.success("App instalada", platform === "desktop" ? "Quedó en tu computadora, en el menú de aplicaciones." : "La encuentras en tu pantalla de inicio y en el menú de aplicaciones.");
        return undefined;
      }
      if (outcome === "dismissed") return undefined;
    }
    setModal(realTarget);
    return undefined;
  };

  const btn = "flex min-h-11 items-center gap-2 rounded-xl bg-white/[0.08] px-3.5 text-left text-white transition-colors hover:bg-white/15 disabled:opacity-60";
  return (
    <div className="mt-5">
      <p className="mb-2 text-[12.5px] font-bold text-white">Descarga la app</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => install("android")} disabled={busy} className={btn}>
          <AndroidGlyph />
          <span className="leading-tight">
            <span className="block text-[10.5px] text-white/65">Instalar en</span>
            <span className="block text-[13.5px] font-bold">Android</span>
          </span>
        </button>
        <button type="button" onClick={() => install("ios")} disabled={busy} className={btn}>
          <AppleGlyph />
          <span className="leading-tight">
            <span className="block text-[10.5px] text-white/65">Instalar en</span>
            <span className="block text-[13.5px] font-bold">iPhone</span>
          </span>
        </button>
      </div>
      {modal && <HowToModal kind={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
