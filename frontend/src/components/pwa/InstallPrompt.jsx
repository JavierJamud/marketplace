import { useEffect, useState } from "react";
import { Bell, Download, Share, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { detectInstalled, enablePush, isIos, isStandalone, markInstalled, onInstallAvailability, promptInstall, pushPermission, pushSupported } from "../../lib/pwa.js";

// Invitación a instalar la aplicación y a activar los avisos. Solo a personas con cuenta y sesión iniciada, y cada una ve la
// aplicación que le corresponde: Marketplace (clientes), Tienda (vendedores y su personal, dentro del panel) o Admin.
// Aparece unos segundos después de entrar, cuando ya no hay otra ventana del sitio abierta (lugar de entrega, cookies), y si la
// persona dice "Ahora no" no vuelve a aparecer en 7 días. Con los avisos ya permitidos en este dispositivo no aparece nunca más.
// Con la aplicación ya instalada (detectInstalled: sistema, marca local o registro en el servidor), en el navegador tampoco;
// dentro de la app instalada solo se ofrecen los avisos (en iPhone es el único lugar donde funcionan). Al instalar, el aviso se
// cierra solo.
const DELAY_MS = 6000;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const snoozeKey = (app) => `pwa-prompt-snooze-${app.key}`;

function snoozed(app) {
  try {
    return Date.now() - Number(localStorage.getItem(snoozeKey(app)) || 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

const COPY = {
  cliente: { install: "Ten tus compras a un toque: abre más rápido y te avisamos cuando cambie el estado de tus pedidos.", push: "Te avisamos cuando la tienda confirme, prepare o entregue tus pedidos." },
  tienda: { install: "Tu panel como una aplicación: pedidos nuevos con aviso al instante, caja y productos aunque se caiga la conexión.", push: "Recibe al momento los pedidos nuevos, los clientes nuevos, los mensajes y los avisos de la plataforma." },
  admin: { install: "El panel de administración como aplicación, con avisos de lo que necesita revisión.", push: "Te avisamos de tiendas nuevas, verificaciones pendientes, solicitudes y errores de la plataforma." },
};

export function InstallPrompt({ app, ready }) {
  const [canInstall, setCanInstall] = useState(false);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(null); // "install" | "ios" | "push"
  const [busy, setBusy] = useState(false);

  useEffect(() => onInstallAvailability((p) => setCanInstall(!!p)), []);
  useEffect(() => {
    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  useEffect(() => {
    if (!ready || snoozed(app)) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (pushPermission() === "granted") return;
      const standalone = isStandalone();
      if (!standalone && (await detectInstalled(app, { loggedIn: true })).installed) return;
      if (cancelled) return;
      const wantsPush = pushSupported() && pushPermission() === "default" && (!isIos() || standalone);
      const next = standalone ? (wantsPush ? "push" : null) : canInstall ? "install" : isIos() ? "ios" : wantsPush ? "push" : null;
      if (next) {
        setStep(next);
        setVisible(true);
      }
    }, DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, app, canInstall]);

  if (!visible || !step) return null;

  const close = (snooze = true) => {
    if (snooze) {
      try {
        localStorage.setItem(snoozeKey(app), String(Date.now()));
      } catch {
        /* sin almacenamiento: se vuelve a ofrecer otra vez */
      }
    }
    setVisible(false);
  };

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === "accepted") markInstalled();
    if (outcome === "accepted" && pushSupported() && pushPermission() === "default") setStep("push");
    else close(outcome !== "accepted");
  };

  const activate = async () => {
    setBusy(true);
    try {
      const r = await enablePush(app);
      if (r === "granted") toast.success("Avisos activados", "Te avisaremos en este dispositivo.", { icon: "bell" });
      else if (r === "denied") toast.warning("Avisos bloqueados", "Puedes permitirlos desde los ajustes del navegador.");
      else if (r === "unsupported") toast.warning("Avisos no disponibles", "Este navegador no permite avisos en este sitio ahora mismo.");
    } catch {
      toast.error("No se pudieron activar los avisos.");
    }
    setBusy(false);
    close(false);
  };

  const title = step === "push" ? "Activa los avisos" : `Instala ${app.name}`;
  const text = step === "push" ? COPY[app.key].push : COPY[app.key].install;

  return (
    <div role="dialog" aria-labelledby="pwa-prompt-title" className="fixed inset-x-3 bottom-3 z-[9997] mx-auto max-w-[420px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 shadow-[0_24px_60px_-12px_rgba(14,26,40,0.45)] animate-fade-up sm:bottom-5 sm:left-5 sm:right-auto sm:mx-0">
      <div className="flex items-start gap-3">
        <img src={app.icon} alt="" width="48" height="48" className="h-12 w-12 flex-shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p id="pwa-prompt-title" className="text-[15px] font-extrabold leading-5 text-on-surface">{title}</p>
          <p className="mt-1 text-[13px] leading-[19px] text-on-surface-variant">{text}</p>
          {step === "ios" && (
            <p className="mt-2 flex flex-wrap items-center gap-1 text-[12.5px] leading-[18px] text-on-surface">
              Toca <Share className="inline h-4 w-4" aria-label="Compartir" /> <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.
            </p>
          )}
        </div>
        <button type="button" onClick={() => close()} aria-label="Cerrar" className="-mr-2 -mt-2 flex h-10 w-10 flex-shrink-0 items-center justify-center text-outline hover:text-on-surface">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => close()} className="min-h-11 flex-1 rounded-xl border border-outline-variant text-[13.5px] font-semibold text-on-surface hover:bg-surface-container">
          Ahora no
        </button>
        {step === "install" && (
          <button type="button" onClick={install} disabled={busy} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary-container text-[13.5px] font-bold text-on-secondary-container disabled:opacity-60">
            <Download className="h-4 w-4" aria-hidden="true" /> Instalar
          </button>
        )}
        {step === "push" && (
          <button type="button" onClick={activate} disabled={busy} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary-container text-[13.5px] font-bold text-on-secondary-container disabled:opacity-60">
            <Bell className="h-4 w-4" aria-hidden="true" /> Activar avisos
          </button>
        )}
        {step === "ios" && (
          <button type="button" onClick={() => close()} className="min-h-11 flex-1 rounded-xl bg-secondary-container text-[13.5px] font-bold text-on-secondary-container">
            Entendido
          </button>
        )}
      </div>
    </div>
  );
}
