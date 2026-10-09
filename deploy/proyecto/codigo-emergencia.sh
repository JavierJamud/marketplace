#!/usr/bin/env bash
# Muestra el último código de inicio de sesión de emergencia (solo existe cuando el correo NO pudo salir,
# por ejemplo antes de configurar Resend en el panel). Vence en 5 minutos.
# Uso: sudo bash /opt/zeudin/organizacion/baznova/scripts/codigo-emergencia.sh
grep -h -E '\[2FA\]|\[adminActionCode\]' /opt/zeudin/organizacion/baznova/logs/api.*.log 2>/dev/null | sort | tail -n 3
