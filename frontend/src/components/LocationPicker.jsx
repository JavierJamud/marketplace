import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Select } from "./ui/Select.jsx";
import { Input } from "./ui/Input.jsx";

// Bloque 244 (pedido explícito — "más libre para recibir negocios de muchos
// lugares, pero solo en los países y provincias que defina el admin; si no
// encuentran el suyo, que puedan escribirlo y el admin lo revise"): el
// registro del cliente y el de la tienda repetían el mismo bloque de
// selectores, cada uno con sus reglas. Ahora es un solo componente:
//  - País: lista del catálogo, o "Mi país no aparece" + texto.
//  - Provincia o estado: lista de ESE país, o "Mi provincia no aparece" +
//    texto. Si el país todavía no tiene provincias cargadas, va directo el
//    campo de texto (nunca un select vacío que deje sin salida).
//  - Dirección: cuando no hay un municipio real con el que ubicarse.
// Bloque 247 (pedido explícito — "también el municipio"):
//  - Municipio: lista de la provincia, o "Mi municipio no aparece" + texto. En
//    Cuba es obligatorio (una de las dos cosas); en otros países es opcional.
//    Con una provincia escrita a mano se ofrece un texto opcional.
// Todo lo escrito a mano llega al admin como solicitud (ver Países y
// provincias, pestaña Solicitudes) y se enlaza solo cuando él la aprueba; desde
// ese momento aparece en las listas de quienes se registren después.
export const OTHER = "__other__";
const CUBA_CODE = "CU";

export function computeLocationStatus(value, { isCuba, provincesLoaded, provinceCount, provinceIsOther }) {
  if (value.countryOther?.trim()) return { error: null, needsAddress: false };
  if (!value.countryId) return { error: "Selecciona tu país.", needsAddress: false };
  if (!provincesLoaded) return { error: "Espera un momento mientras se cargan las provincias.", needsAddress: false };

  const manualProvince = provinceIsOther || provinceCount === 0;
  if (manualProvince) {
    if (!value.stateOther?.trim()) return { error: "Escribe tu provincia o estado.", needsAddress: true };
    return { error: null, needsAddress: true };
  }
  if (!value.provinceId) return { error: "Selecciona tu provincia.", needsAddress: false };
  const hasMunicipality = !!value.municipalityId || !!value.municipalityOther?.trim();
  if (isCuba && !hasMunicipality) return { error: "Selecciona tu municipio o escríbelo si no aparece.", needsAddress: false };
  // Sin un municipio real del catálogo no hay con qué ubicar la dirección.
  return { error: null, needsAddress: !value.municipalityId };
}

const MANUAL_NOTE = "Lo revisamos y lo sumamos a la lista. Mientras tanto puedes seguir con tu registro.";

export function LocationPicker({
  value,
  onChange,
  address,
  onAddressChange,
  onStatus,
  labels = {},
  addressLabel = "Dirección",
  disabled = false,
}) {
  const L = {
    country: "País",
    countryOther: "Escribe el nombre de tu país",
    province: "Provincia o estado",
    provinceOther: "Escribe tu provincia o estado",
    municipality: "Municipio",
    municipalityOther: "Escribe tu municipio",
    ...labels,
  };

  const { data: countries = [] } = useQuery({
    queryKey: ["active-countries-all"],
    queryFn: async () => (await api.get("/locations/countries?all=true")).data.countries,
  });
  const country = countries.find((c) => c.id === value.countryId);
  const isCuba = country?.code === CUBA_CODE;

  const [countryIsOther, setCountryIsOther] = useState(!!value.countryOther);
  const [provinceIsOther, setProvinceIsOther] = useState(!!value.stateOther && !value.provinceId);
  const [municipalityIsOther, setMunicipalityIsOther] = useState(!!value.municipalityOther && !value.municipalityId);

  const { data: provinces, isSuccess: provincesLoaded } = useQuery({
    queryKey: ["provinces-for-country", value.countryId],
    queryFn: async () => (await api.get(`/locations/countries/${value.countryId}/provinces`)).data.provinces,
    enabled: !!value.countryId && !countryIsOther,
  });
  const provinceCount = provinces?.length ?? 0;

  // Bloque 247: los municipios ya no son solo de Cuba: si el admin aprueba uno
  // en cualquier provincia, tiene que poder elegirse.
  const { data: municipalities, isSuccess: municipalitiesLoaded } = useQuery({
    queryKey: ["municipalities-for-province", value.provinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${value.provinceId}/municipalities`)).data.municipalities,
    enabled: !!value.provinceId && !provinceIsOther,
  });
  const municipalityCount = municipalities?.length ?? 0;

  const status = useMemo(
    () => computeLocationStatus(value, { isCuba, provincesLoaded: !!provincesLoaded, provinceCount, provinceIsOther }),
    [value, isCuba, provincesLoaded, provinceCount, provinceIsOther]
  );
  useEffect(() => {
    onStatus?.(status);
    // onStatus cambia de identidad en cada render del llamador; solo importa
    // el contenido del estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.error, status.needsAddress]);

  const manualProvince = provinceIsOther || (!!value.countryId && provincesLoaded && provinceCount === 0);
  const realProvince = !!value.countryId && !countryIsOther && !!value.provinceId && !provinceIsOther;
  // Con la lista vacía (o con "no aparece") el municipio es un campo de texto.
  const manualMunicipality = municipalityIsOther || (municipalitiesLoaded && municipalityCount === 0);

  return (
    <div className="space-y-4">
      <div>
        <Select
          label={L.country}
          required
          disabled={disabled}
          value={countryIsOther ? OTHER : value.countryId}
          onChange={(e) => {
            const next = e.target.value;
            setProvinceIsOther(false);
            setMunicipalityIsOther(false);
            if (next === OTHER) {
              setCountryIsOther(true);
              onChange({ countryId: "", countryOther: value.countryOther ?? "", provinceId: "", municipalityId: "", municipalityOther: "", stateOther: "" });
            } else {
              setCountryIsOther(false);
              onChange({ countryId: next, countryOther: "", provinceId: "", municipalityId: "", municipalityOther: "", stateOther: "" });
            }
          }}
        >
          <option value="">Selecciona...</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={OTHER}>Mi país no aparece</option>
        </Select>
        {countryIsOther && (
          <div className="mt-3">
            <Input
              label={L.countryOther}
              required
              disabled={disabled}
              maxLength={80}
              value={value.countryOther ?? ""}
              onChange={(e) => onChange({ countryOther: e.target.value })}
            />
            <p className="mt-1 text-label-sm text-outline">{MANUAL_NOTE}</p>
          </div>
        )}
      </div>

      {value.countryId && !countryIsOther && provincesLoaded && provinceCount > 0 && (
        <Select
          label={L.province}
          required
          disabled={disabled}
          value={provinceIsOther ? OTHER : value.provinceId}
          onChange={(e) => {
            const next = e.target.value;
            setMunicipalityIsOther(false);
            if (next === OTHER) {
              setProvinceIsOther(true);
              onChange({ provinceId: "", municipalityId: "", municipalityOther: "" });
            } else {
              setProvinceIsOther(false);
              onChange({ provinceId: next, municipalityId: "", municipalityOther: "", stateOther: "" });
            }
          }}
        >
          <option value="">Selecciona...</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={OTHER}>Mi provincia no aparece</option>
        </Select>
      )}

      {value.countryId && !countryIsOther && manualProvince && (
        <div className="space-y-4">
          <div>
            <Input
              label={provinceCount === 0 ? L.province : L.provinceOther}
              required
              disabled={disabled}
              maxLength={80}
              value={value.stateOther ?? ""}
              onChange={(e) => onChange({ stateOther: e.target.value })}
            />
            <p className="mt-1 text-label-sm text-outline">{MANUAL_NOTE}</p>
          </div>
          <Input
            label={`${L.municipalityOther} (opcional)`}
            disabled={disabled}
            maxLength={80}
            value={value.municipalityOther ?? ""}
            onChange={(e) => onChange({ municipalityOther: e.target.value, municipalityId: "" })}
          />
        </div>
      )}

      {realProvince && municipalitiesLoaded && municipalityCount > 0 && (
        <Select
          label={L.municipality}
          required={isCuba}
          disabled={disabled}
          value={municipalityIsOther ? OTHER : value.municipalityId}
          onChange={(e) => {
            const next = e.target.value;
            if (next === OTHER) {
              setMunicipalityIsOther(true);
              onChange({ municipalityId: "" });
            } else {
              setMunicipalityIsOther(false);
              onChange({ municipalityId: next, municipalityOther: "" });
            }
          }}
        >
          <option value="">Selecciona...</option>
          {municipalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={OTHER}>Mi municipio no aparece</option>
        </Select>
      )}

      {realProvince && municipalitiesLoaded && manualMunicipality && (
        <div>
          <Input
            label={isCuba ? L.municipalityOther : `${L.municipalityOther} (opcional)`}
            required={isCuba}
            disabled={disabled}
            maxLength={80}
            value={value.municipalityOther ?? ""}
            onChange={(e) => onChange({ municipalityOther: e.target.value, municipalityId: "" })}
          />
          <p className="mt-1 text-label-sm text-outline">{MANUAL_NOTE}</p>
        </div>
      )}

      {onAddressChange && status.needsAddress && (
        <Input label={addressLabel} required disabled={disabled} maxLength={300} value={address ?? ""} onChange={(e) => onAddressChange(e.target.value)} />
      )}
    </div>
  );
}
