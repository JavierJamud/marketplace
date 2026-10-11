import { Component } from "react";
import { AlertTriangle } from "lucide-react";
import { openErrorReport } from "../lib/errorReport.js";

// Bloque 197 (pedido explícito — "no debe ponerse la página en blanco nunca
// más bajo ninguna circunstancia"): la app entera no tenía NINGÚN error
// boundary — cualquier excepción sin atrapar durante un render (en
// cualquier página, no solo la de la mesa) desmontaba React entero y
// dejaba una pantalla blanca, sin ningún aviso. Esto envuelve TODAS las
// rutas (ver App.jsx) para que ese caso siempre caiga acá en vez de a una
// pantalla vacía.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary atrapó un error de render:", error, info);
    this.failure = { method: "RENDER", path: window.location.pathname, status: null, message: String(error?.message ?? error).slice(0, 300), at: new Date().toISOString() };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-container-lowest p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error/10">
          <AlertTriangle className="h-7 w-7 text-error" />
        </div>
        <div>
          <h1 className="mb-1.5 text-title-lg font-bold text-on-surface">Hay un problema en este momento</h1>
          <p className="mx-auto max-w-sm text-[13.5px] text-on-surface-variant">
            Tuvimos un problema mostrando esta página. Prueba recargarla — tus datos están a salvo.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button onClick={() => window.location.reload()} className="min-h-11 rounded-md bg-primary px-6 py-2.5 text-label-md font-bold text-white">
            Recargar página
          </button>
          <button onClick={() => openErrorReport({ failure: this.failure })} className="min-h-11 rounded-md border border-outline-variant px-6 py-2.5 text-label-md font-bold text-on-surface">
            Reportar el problema
          </button>
        </div>
      </div>
    );
  }
}
