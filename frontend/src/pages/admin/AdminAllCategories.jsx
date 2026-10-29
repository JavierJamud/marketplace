import { useSearchParams } from "react-router-dom";
import { Boxes, Tags } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import AdminCategories from "./AdminCategories.jsx";
import AdminProductCategories from "./AdminProductCategories.jsx";

// Una sola sección para las dos clases de categoría (antes eran dos entradas del menú):
//  - De negocio: el rubro con el que se presenta cada tienda (Home, filtro de Tiendas, registro).
//  - De producto: la que elige el vendedor para cada producto (catálogo y búsqueda).
// Son independientes a propósito: una tienda puede vender productos de otras categorías que su rubro. La pestaña vive en la
// URL (?tab=producto), así /admin/categorias-producto redirige directo a la suya.
const TABS = [
  { id: "negocio", label: "De negocio", icon: Tags },
  { id: "producto", label: "De producto", icon: Boxes },
];

export default function AdminAllCategories() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "producto" ? "producto" : "negocio";
  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Tags} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Categorías</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        El rubro de cada tienda y las categorías de sus productos. Una tienda puede vender productos de cualquier categoría, aunque no sean de su rubro.
      </p>
      <Tabs tabs={TABS} value={tab} onChange={(id) => setParams(id === "producto" ? { tab: "producto" } : {}, { replace: true })} className="mb-5" />
      {tab === "producto" ? <AdminProductCategories embedded /> : <AdminCategories embedded />}
    </div>
  );
}
