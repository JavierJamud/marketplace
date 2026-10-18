import { useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

// Menú lateral por secciones (panel del admin y de la tienda). En el admin, con muchos enlaces, las secciones empiezan plegadas
// (defaultOpen false); en la tienda, abiertas. La que contiene la página actual siempre se ve abierta y lo que la persona abre o
// pliega se recuerda en este navegador. Plegada, una sección muestra la suma de sus avisos para que no se pierdan. Los enlaces
// los dibuja quien lo usa (renderLink), así cada panel conserva sus colores.
function readOpen(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

export function GroupedNav({ items, groups, renderLink, badgeFor = () => 0, storageKey, tone = "light", defaultOpen = false }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const isActive = (item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`));

  const toggle = (id, current) => {
    const next = { ...open, [id]: !current };
    setOpen(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
  };

  const loose = items.filter((i) => !i.group);
  const headerCls = tone === "light" ? "text-white/45 hover:text-white/80" : "text-outline hover:text-on-surface";

  return (
    <>
      {loose.map((item) => renderLink(item))}
      {groups.map((g) => {
        const groupItems = items.filter((i) => i.group === g.id);
        if (!groupItems.length) return null;
        const hasActive = groupItems.some(isActive);
        const expanded = hasActive || (open[g.id] ?? defaultOpen) === true;
        const pending = expanded ? 0 : groupItems.reduce((s, i) => s + (badgeFor(i) || 0), 0);
        return (
          <div key={g.id} className="mt-2">
            <button
              type="button"
              onClick={() => toggle(g.id, expanded)}
              aria-expanded={expanded}
              disabled={hasActive}
              className={`flex min-h-9 w-full items-center gap-2 rounded px-3 text-[11px] font-bold uppercase tracking-[0.08em] disabled:cursor-default ${headerCls}`}
            >
              <span className="flex-1 text-left">{g.label}</span>
              {pending > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold normal-case tracking-normal text-white">{pending}</span>}
              {!hasActive && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />}
            </button>
            {expanded && <div className="flex flex-col gap-[3px]">{groupItems.map((item) => renderLink(item))}</div>}
          </div>
        );
      })}
    </>
  );
}
