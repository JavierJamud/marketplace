import { LifeBuoy } from "lucide-react";
import { StaticPageEditor } from "../../components/admin/StaticPageEditor.jsx";

// Bloque 53: sección propia (antes vivía junto a Términos/FAQ/Contacto en la
// lista genérica de "Páginas").
export default function AdminAyuda() {
  return (
    <StaticPageEditor
      slug="ayuda"
      label="Centro de ayuda"
      publicPath="/ayuda"
      helpText="Reemplaza toda la página del Centro de ayuda."
      icon={LifeBuoy}
    />
  );
}
