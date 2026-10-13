import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

// Cuba, Estados Unidos y México primero (los de más uso), luego el resto por nombre.
const PRIORITY = ["CU", "US", "MX"];

// Países habilitados por el admin para teléfonos y registros, cada uno con su código de marcado (sin "+"). Solo salen los que el
// admin tiene encendidos en su panel de países.
export function usePhoneCountries() {
  const query = useQuery({
    queryKey: ["phone-countries"],
    queryFn: async () => (await api.get("/locations/countries", { params: { all: true } })).data.countries,
    staleTime: 10 * 60 * 1000,
  });
  const list = (query.data ?? [])
    .filter((c) => c.code && c.callingCode)
    .map((c) => ({ code: c.code.toUpperCase(), name: c.name, callingCode: c.callingCode }))
    .sort((a, b) => {
      const pa = PRIORITY.indexOf(a.code);
      const pb = PRIORITY.indexOf(b.code);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.name.localeCompare(b.name, "es");
    });
  return { countries: list, isLoading: query.isLoading, isError: query.isError };
}
