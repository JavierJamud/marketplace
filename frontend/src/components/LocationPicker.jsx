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
//  - Municipio: solo Cuba y solo con una provincia real (se deja como estaba).
//  - Dirección: cuando no hay un municipio real con el que ubicarse.
// Todo lo escrito a mano llega al admin como solicitud (ver Países y
// provincias, pestaña Solicitudes) y se enlaza solo cuando él la aprueba.
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
  if (isCuba && !value.municipalityId) return { error: "Selecciona tu municipio.", needsAddress: false };
  return { error: null, needsAddress: !isCuba };
}

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

  const { data: provinces, isSuccess: provincesLoaded } = useQuery({
    queryKey: ["provinces-for-country", value.countryId],
    queryFn: async () => (await api.get(`/locations/countries/${value.countryId}/provinces`)).data.provinces,
    enabled: !!value.countryId && !countryIsOther,
  });
  const provinceCount = provinces?.length ?? 0;

  const { data: municipalities = [] } = useQuery({
    queryKey: ["municipalities-for-province", value.provinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${value.provinceId}/municipalities`)).data.municipalities,
    enabled: !!value.provinceId && isCuba && !provinceIsOther,
  });

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
            if (next === OTHER) {
              setCountryIsOther(true);
              onChange({ countryId: "", countryOther: value.countryOther ?? "", provinceId: "", municipalityId: "", stateOther: "" });
            } else {
              setCountryIsOther(false);
              onChange({ countryId: next, countryOther: "", provinceId: "", municipalityId: "", stateOther: "" });
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
            <p className="mt-1 text-label-sm text-outline">Lo revisamos y lo sumamos a la lista. Mientras tanto puedes seguir con tu registro.</p>
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
            if (next === OTHER) {
              setProvinceIsOther(true);
              onChange({ provinceId: "", municipalityId: "" });
            } else {
              setProvinceIsOther(false);
              onChange({ provinceId: next, municipalityId: "", stateOther: "" });
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
        <div>
          <Input
            label={provinceCount === 0 ? L.province : L.provinceOther}
            required
            disabled={disabled}
            maxLength={80}
            value={value.stateOther ?? ""}
            onChange={(e) => onChange({ stateOther: e.target.value })}
          />
          <p className="mt-1 text-label-sm text-outline">Lo revisamos y lo sumamos a la lista. Mientras tanto puedes seguir con tu registro.</p>
        </div>
      )}

      {value.countryId && !countryIsOther && isCuba && value.provinceId && !provinceIsOther && (
        <Select
          label={L.municipality}
          required
          disabled={disabled}
          value={value.municipalityId}
          onChange={(e) => onChange({ municipalityId: e.target.value })}
        >
          <option value="">Selecciona...</option>
          {municipalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      )}

      {onAddressChange && status.needsAddress && (
        <Input label={addressLabel} required disabled={disabled} maxLength={300} value={address ?? ""} onChange={(e) => onAddressChange(e.target.value)} />
      )}
    </div>
  );
}
