import { StaticPageEditor } from "../../components/admin/StaticPageEditor.jsx";

// Bloque 53: sección propia (antes vivía junto a Términos/FAQ/Ayuda en la
// lista genérica de "Páginas"). Nota: en la página pública solo se
// reemplaza la columna informativa — el formulario de contacto en sí
// (envío real de correo) sigue funcionando siempre, nunca se puede romper
// desde acá (ver Contacto.jsx).
export default function AdminContacto() {
  return (
    <StaticPageEditor
      slug="contacto"
      label="Contacto"
      publicPath="/contacto"
      helpText="Reemplaza la columna informativa de la página de Contacto (el formulario de envío sigue funcionando siempre, sin importar este contenido)."
    />
  );
}
