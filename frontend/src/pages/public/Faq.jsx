import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, HelpCircle } from "lucide-react";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";

// Bloque 53: antes esto era copy hardcodeado (buildCustomerFaqs/
// buildVendorFaqs) que además podía reemplazarse entero por un bloque de
// HTML libre desde el admin — ahora las preguntas viven en su propia tabla
// (FaqItem, con CRUD real en AdminFaq.jsx), así que esta página siempre
// muestra datos reales y ya no tiene una versión "HTML libre" alternativa.
//
// `openId` vive en el padre (Faq), no en cada FaqItem — es lo que permite
// una sola pregunta abierta a la vez: abrir una nueva pisa el `openId`
// anterior, así que la que estaba abierta se cierra sola.
function FaqItem({ id, q, a, isOpen, onToggle }) {
  return (
    <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
      <button
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-[14px] font-bold text-on-surface">{q}</span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-outline transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && <p className="px-5 pb-4 text-[13.5px] leading-5 text-on-surface-variant">{a}</p>}
    </div>
  );
}

export default function Faq() {
  const [searchParams] = useSearchParams();
  // Bloque 48: Ayuda.jsx linkea acá con ?tab=vendor para las categorías de
  // vendedor — cualquier otro valor (o ninguno) cae en "customer".
  const [tab, setTab] = useState(searchParams.get("tab") === "vendor" ? "vendor" : "customer");
  const [openId, setOpenId] = useState(null);

  const audience = tab === "vendor" ? "VENDOR" : "CUSTOMER";
  const { data: faqs, isLoading } = useQuery({
    queryKey: ["public-faq", audience],
    queryFn: async () => (await api.get("/faq", { params: { audience } })).data.items,
  });

  // Cambiar de pestaña cierra cualquier pregunta abierta de la pestaña
  // anterior — no tendría sentido dejarla "abierta" para una lista distinta.
  useEffect(() => setOpenId(null), [tab]);

  function toggle(id) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div className="container-app max-w-[820px] py-14">
      <p className="mb-1.5 text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Ayuda</p>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Preguntas frecuentes</h1>
      <p className="mb-8 text-body-md text-on-surface-variant">Elige la sección que te interesa.</p>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setTab("customer")}
          className={`rounded-full px-4 py-2 text-[13px] font-bold ${
            tab === "customer" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
          }`}
        >
          Para clientes
        </button>
        <button
          onClick={() => setTab("vendor")}
          className={`rounded-full px-4 py-2 text-[13px] font-bold ${
            tab === "vendor" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant"
          }`}
        >
          Para vendedores
        </button>
      </div>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && faqs?.length === 0 && (
        <EmptyState icon={HelpCircle} title="Todavía no hay preguntas en esta sección" description="Vuelve a intentarlo más adelante." />
      )}

      <div className="flex flex-col gap-3">
        {faqs?.map((f) => (
          <FaqItem key={f.id} id={f.id} q={f.question} a={f.answer} isOpen={openId === f.id} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}
