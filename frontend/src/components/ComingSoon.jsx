import { Construction } from "lucide-react";

// Placeholder para pantallas todavía no implementadas pixel-a-pixel desde su
// mockup (ver design_references/*.dc.html). Home.dc.html es la única pantalla
// con fidelidad completa por ahora; el resto sigue el mismo patrón cuando se
// aborden una por una.
export function ComingSoon({ title }) {
  return (
    <div className="container-app flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16 text-center">
      <Construction className="h-10 w-10 text-outline" strokeWidth={1.5} />
      <h1 className="text-headline-md text-on-surface">{title}</h1>
      <p className="max-w-sm text-body-md text-on-surface-variant">
        Esta pantalla todavía no tiene su implementación pixel-perfect. Próximamente.
      </p>
    </div>
  );
}
