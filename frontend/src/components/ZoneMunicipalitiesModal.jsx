import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button } from "./ui/Button.jsx";
import { UnsavedChangesModal } from "./UnsavedChangesModal.jsx";
import { useDirtyModal } from "../lib/useDirtyModal.js";

// Elegir los municipios (o ciudades) de UNA provincia o estado donde presta servicio una tienda. Lo usan la propia tienda
// (Configuración) y el admin (Editar tienda): antes vivía solo dentro de VendorSettings.jsx.
// Bloque 196: `onBackdropClick` opcional — por default cierra directo (sin
// borrador propio), pero ManageVendorMunicipalitiesModal (el único uso real
// hoy) pasa el handler de useDirtyModal para preguntar antes de cerrar si
// hay municipios sin guardar.
function Modal({ title, onClose, onBackdropClick, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onBackdropClick ?? ((e) => { if (e.target === e.currentTarget) onClose(); })}
    >
      {/* Bloque 195 (bug real encontrado en auditoría — responsividad: este
          modal era el único del panel de vendedor sin max-h-[90vh]
          overflow-y-auto, patrón usado en todo el resto del proyecto — en
          una pantalla chica, con muchos municipios listados, se podía
          cortar contra los bordes de la ventana sin forma de scrollear el
          modal completo). */}
      <div className="modal-panel-6 w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <h2 className="mb-4 text-title-lg font-bold text-on-surface">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Cuba se divide en provincias con municipios; los demás países, en estados con ciudades.
export function zoneUnit(province) {
  return province?.type === "STATE"
    ? { many: "ciudades", Many: "Ciudades", all: "Todo el estado (todas las ciudades)", whole: "Todo el estado", one: "ciudad" }
    : { many: "municipios", Many: "Municipios", all: "Toda la provincia (todos los municipios)", whole: "Toda la provincia", one: "municipio" };
}
const ZONE_LIST_MAX = 150;

export function ManageVendorMunicipalitiesModal({ province, vendorLocations, onClose, onSave, isPending }) {
  const unit = zoneUnit(province);
  const [search, setSearch] = useState("");
  const { data: municipalities = [] } = useQuery({
    queryKey: ["admin-municipalities", province.id],
    queryFn: async () => (await api.get(`/locations/provinces/${province.id}/municipalities`)).data.municipalities,
  });

  const currentProvLocs = useMemo(
    () => (vendorLocations ?? []).filter((l) => l.provinceId === province.id),
    [vendorLocations, province.id]
  );
  const isAllSelected = useMemo(
    () => currentProvLocs.some((l) => l.municipalityId === null),
    [currentProvLocs]
  );

  const [selectedIds, setSelectedIds] = useState(() => {
    if (isAllSelected) return null;
    return currentProvLocs.map((l) => l.municipalityId).filter(Boolean);
  });

  function toggleAll() {
    if (selectedIds === null) {
      setSelectedIds([]);
    } else {
      setSelectedIds(null);
    }
  }

  function toggleMunicipality(id) {
    if (selectedIds === null) {
      const allIds = municipalities.map((m) => m.id).filter((mId) => mId !== id);
      setSelectedIds(allIds);
    } else {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((mId) => mId !== id));
      } else {
        const next = [...selectedIds, id];
        if (next.length === municipalities.length) {
          setSelectedIds(null);
        } else {
          setSelectedIds(next);
        }
      }
    }
  }

  const matchingMunicipalities = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!q) return municipalities;
    return municipalities.filter((m) => m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q));
  }, [municipalities, search]);
  const visibleMunicipalities = matchingMunicipalities.slice(0, ZONE_LIST_MAX);

  // Bloque 196: único borrador de este modal es la selección de municipios
  // — el botón "Guardar Municipios" real solo se bloquea por isPending
  // (cualquier selección, incluso vacía, es válida), así que acá siempre
  // hay algo que ofrecer guardar. El propio "Guardar" de este modal ya
  // dispara un segundo diálogo de confirmación en VendorSettings
  // (openConfirm) — se reusa tal cual, sin inventar un atajo que se salte
  // esa confirmación.
  const initialSelectionSnapshot = useRef(JSON.stringify(selectedIds));
  const isDirty = JSON.stringify(selectedIds) !== initialSelectionSnapshot.current;
  const dirtyModal = useDirtyModal({
    isDirty,
    onClose,
    onSave: () => onSave({ provinceId: province.id, municipalityIds: selectedIds }),
  });

  return (
    <Modal title={`${unit.Many} de ${province.name}`} onClose={onClose} onBackdropClick={dirtyModal.handleBackdropClick}>
      <div className="mb-4 flex flex-col gap-3">
        <label className="flex items-center gap-2.5 rounded-xl border border-surface-container-high bg-surface-container/30 p-3 text-[13px] font-bold text-on-surface cursor-pointer">
          <input
            type="checkbox"
            checked={selectedIds === null}
            onChange={toggleAll}
            className="h-4 w-4 rounded accent-tertiary-accent"
          />
          {unit.all}
        </label>

        <div className="mt-2 flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-wider text-outline">
          <span>{unit.Many} disponibles ({municipalities.length.toLocaleString("es-CU")})</span>
          {selectedIds !== null && <span className="normal-case tracking-normal text-tertiary-accent">{selectedIds.length} elegidos</span>}
        </div>

        {municipalities.length > 15 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar ${unit.one}...`}
            aria-label={`Buscar ${unit.one} en ${province.name}`}
            className="h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
          />
        )}

        <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-1">
          {visibleMunicipalities.map((m) => {
            const isChecked = selectedIds === null || selectedIds.includes(m.id);
            return (
              <label
                key={m.id}
                className={`flex items-center justify-between rounded-xl border p-3 text-[12.5px] cursor-pointer transition ${
                  isChecked
                    ? "border-tertiary-accent bg-tertiary-accent/5 font-semibold text-on-surface"
                    : "border-surface-container-high bg-surface-container-lowest text-outline"
                }`}
              >
                <span>{m.name}</span>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleMunicipality(m.id)}
                  className="h-4 w-4 rounded accent-tertiary-accent"
                />
              </label>
            );
          })}
          {matchingMunicipalities.length > visibleMunicipalities.length && (
            <p className="py-2 text-[12px] text-on-surface-variant">Hay {matchingMunicipalities.length.toLocaleString("es-CU")} coincidencias: escribe para encontrar la que buscas.</p>
          )}
          {municipalities.length > 0 && matchingMunicipalities.length === 0 && (
            <p className="py-2 text-[12px] text-outline italic">Ninguna coincide con “{search.trim()}”.</p>
          )}
          {municipalities.length === 0 && (
            <p className="py-2 text-[12px] text-outline italic">No hay {unit.many} activos en el catálogo para {province.name}.</p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
        <Button
          className="flex-1 rounded-xl"
          disabled={isPending}
          onClick={() => onSave({ provinceId: province.id, municipalityIds: selectedIds })}
        >
          {isPending ? "Guardando..." : "Guardar"}
        </Button>
      </div>

      <UnsavedChangesModal
        open={dirtyModal.confirming}
        saving={dirtyModal.saving}
        onSave={dirtyModal.handleSaveAndClose}
        onDiscard={dirtyModal.handleDiscard}
        onCancel={dirtyModal.handleKeepEditing}
      />
    </Modal>
  );
}
