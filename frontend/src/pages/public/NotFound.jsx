import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button.jsx";

export default function NotFound() {
  return (
    <div className="container-app flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-6xl font-extrabold text-primary-container">404</p>
      <h1 className="text-headline-md text-on-surface">Esta página no existe</h1>
      <p className="max-w-sm text-body-md text-on-surface-variant">Puede que el enlace esté roto o la página se haya movido.</p>
      <Link to="/">
        <Button className="mt-2">Volver al inicio</Button>
      </Link>
    </div>
  );
}
