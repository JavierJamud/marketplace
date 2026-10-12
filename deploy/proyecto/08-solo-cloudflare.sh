#!/usr/bin/env bash
# Baznova: los puertos 80 y 443 solo aceptan conexiones nuevas que vengan de Cloudflare (y del propio servidor).
# Así nadie puede saltarse a Cloudflare (WAF, límites, caché) pegándole directo a la IP del servidor.
#
# Qué hace: arma una cadena de firewall "CF_ONLY" (IPv4 e IPv6) con los rangos oficiales de Cloudflare que ya descarga
# 07-cloudflare-ip-real.sh (/etc/nginx/conf.d/cloudflare-ip-real.conf) y la engancha al INPUT para las conexiones NUEVAS a los
# puertos 80 y 443. El SSH (22) no se toca. Si algo falla, no se cierra nada (falla abierto).
#
# Uso:  sudo bash 08-solo-cloudflare.sh            aplica (o actualiza) la restricción
#       sudo bash 08-solo-cloudflare.sh quitar     la desactiva y vuelve a dejar los puertos abiertos como antes
#
# IMPORTANTE: con esto activo, el dominio tiene que estar con el proxy de Cloudflare (nube naranja). En modo "solo DNS" (nube
# gris) el sitio no sería alcanzable desde afuera.
set -uo pipefail

LISTA=/etc/nginx/conf.d/cloudflare-ip-real.conf
CADENA=CF_ONLY
PUERTOS=80,443

quitar_familia() {
  local ipt="$1"
  command -v "$ipt" >/dev/null 2>&1 || return 0
  while "$ipt" -D INPUT -p tcp -m multiport --dports "$PUERTOS" -m conntrack --ctstate NEW -j "$CADENA" 2>/dev/null; do :; done
  "$ipt" -F "$CADENA" 2>/dev/null
  "$ipt" -X "$CADENA" 2>/dev/null
  return 0
}

if [ "${1:-}" = "quitar" ]; then
  quitar_familia iptables
  quitar_familia ip6tables
  echo "Restricción a Cloudflare desactivada: los puertos 80 y 443 vuelven a aceptar a cualquiera."
  exit 0
fi

[ -f "$LISTA" ] || { echo "No existe $LISTA: corre antes 07-cloudflare-ip-real.sh"; exit 1; }
RANGOS=$(grep -oE 'set_real_ip_from [^;]+' "$LISTA" | awk '{print $2}')
V4=$(echo "$RANGOS" | grep -v ':' || true)
V6=$(echo "$RANGOS" | grep ':' || true)
# Sin una lista razonable no se aplica nada (evita dejar el sitio inalcanzable por un archivo vacío o incompleto).
[ "$(echo "$V4" | grep -c .)" -ge 10 ] || { echo "La lista de rangos IPv4 de Cloudflare está incompleta: no se aplica nada."; exit 1; }
[ "$(echo "$V6" | grep -c .)" -ge 5 ] || { echo "La lista de rangos IPv6 de Cloudflare está incompleta: no se aplica nada."; exit 1; }

aplicar_familia() {
  local ipt="$1" rangos="$2"
  command -v "$ipt" >/dev/null 2>&1 || return 0
  # Cadena nueva con el nombre temporal, y se intercambia al final: nunca hay un momento sin reglas ni a medio armar.
  "$ipt" -N "${CADENA}_NUEVA" 2>/dev/null || "$ipt" -F "${CADENA}_NUEVA"
  "$ipt" -A "${CADENA}_NUEVA" -i lo -j RETURN
  while IFS= read -r r; do
    [ -n "$r" ] && "$ipt" -A "${CADENA}_NUEVA" -s "$r" -j RETURN
  done <<< "$rangos"
  "$ipt" -A "${CADENA}_NUEVA" -j DROP
  # Se retira el enganche viejo, se reemplaza la cadena y se vuelve a enganchar.
  while "$ipt" -D INPUT -p tcp -m multiport --dports "$PUERTOS" -m conntrack --ctstate NEW -j "$CADENA" 2>/dev/null; do :; done
  "$ipt" -F "$CADENA" 2>/dev/null; "$ipt" -X "$CADENA" 2>/dev/null
  "$ipt" -E "${CADENA}_NUEVA" "$CADENA"
  # Posición 1: antes de las reglas que aceptan 80/443 a cualquiera. Las conexiones ya establecidas no se tocan (conntrack NEW).
  "$ipt" -I INPUT 1 -p tcp -m multiport --dports "$PUERTOS" -m conntrack --ctstate NEW -j "$CADENA"
}

aplicar_familia iptables "$V4"
aplicar_familia ip6tables "$V6"
echo "Puertos $PUERTOS restringidos a Cloudflare: $(echo "$V4" | grep -c .) rangos IPv4 y $(echo "$V6" | grep -c .) IPv6."
