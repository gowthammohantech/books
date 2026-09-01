#!/bin/sh
# Renders /etc/nginx/nginx.conf from nginx.conf.template before nginx starts.
#
# The only variable part is the API proxy. nginx resolves upstream hostnames
# once, at startup, and aborts the whole process when one does not exist:
#
#   [emerg] host not found in upstream "api:3001" in /etc/nginx/nginx.conf:17
#
# That is fatal wherever this image runs alone (Azure App Service deploys one
# container, so there is no `api` host on its network). Hence the proxy is
# emitted only when API_ORIGIN names an API that is actually reachable:
#
#   API_ORIGIN=http://api:3001        compose — api container on the same network
#   API_ORIGIN=https://<api-host>     external API, proxied same-origin (no CORS)
#   API_ORIGIN unset                  SPA only; it calls VITE_API_BASE_URL direct
#
# API_PROXY_HOST overrides the Host header sent upstream. It defaults to the
# right thing for both cases above, so it is rarely needed.
set -eu

template=/etc/nginx/nginx.conf.template
target=/etc/nginx/nginx.conf

api_origin="${API_ORIGIN:-}"
# A trailing slash on proxy_pass changes its semantics (it strips the matched
# location prefix), so normalise it away.
api_origin="${api_origin%/}"

if [ -n "$api_origin" ]; then
  case "$api_origin" in
    https://*) scheme=https; rest=${api_origin#https://} ;;
    http://*)  scheme=http;  rest=${api_origin#http://} ;;
    # Bare host:port, as a convenience — treated as plain http.
    *)         scheme=http;  rest=$api_origin; api_origin="http://$api_origin" ;;
  esac

  hostport=${rest%%/*}
  # Default ports do not belong in a Host header.
  if [ "$scheme" = https ]; then hostport=${hostport%:443}; else hostport=${hostport%:80}; fi

  # A managed platform (App Service, most load balancers) routes on the Host
  # header and needs matching SNI, so a TLS upstream must be addressed by its
  # own hostname rather than the browser's. A container on the same network has
  # no such routing, so there the browser's Host is passed straight through.
  if [ -n "${API_PROXY_HOST:-}" ]; then
    proxy_host=$API_PROXY_HOST
  elif [ "$scheme" = https ]; then
    proxy_host=$hostport
  else
    proxy_host='$host'
  fi

  # Only meaningful for a TLS upstream; nginx would accept it either way, but
  # emitting it only where it does something keeps the rendered config honest.
  if [ "$scheme" = https ]; then
    proxy_sni='
      proxy_ssl_server_name on;'
  else
    proxy_sni=''
  fi

  # A hostname written straight into proxy_pass is resolved once, at startup,
  # and nginx REFUSES TO START if that lookup fails -- so a slow-booting api
  # container or a DNS blip takes the whole SPA down with it. Going through a
  # variable defers resolution to request time: nginx boots, serves the app,
  # and a genuinely unreachable API degrades to 502 on /api alone.
  #
  # That needs a resolver. The base image's 15-local-resolvers.envsh (sourced
  # by the entrypoint just before this script) publishes the container's own
  # nameservers as NGINX_LOCAL_RESOLVERS; /etc/resolv.conf is the fallback for
  # anyone running this script outside that entrypoint.
  resolvers="${NGINX_LOCAL_RESOLVERS:-}"
  if [ -z "$resolvers" ] && [ -r /etc/resolv.conf ]; then
    resolvers=$(awk '/^nameserver/ { printf "%s ", $2 }' /etc/resolv.conf)
  fi

  # Collapse the trailing/repeated whitespace either source can leave behind.
  resolvers=$(echo $resolvers)

  if [ -n "$resolvers" ]; then
    # ipv6=off: containers routinely have no routable IPv6, and an AAAA answer
    # nginx cannot connect to reads as an outage.
    proxy_target='$api_upstream'
    proxy_resolve="
      resolver $resolvers ipv6=off valid=30s;
      set \$api_upstream $api_origin;"
  else
    # No resolver to be had -- fall back to startup resolution rather than
    # emitting a config that would fail on every request.
    echo "$0: warning: no nameservers found, falling back to startup resolution"
    proxy_target=$api_origin
    proxy_resolve=''
  fi

  echo "$0: API proxy enabled -> $api_origin (Host: $proxy_host)"
  block=$(cat <<PROXY
    location /api/ {$proxy_resolve
      proxy_pass $proxy_target;
      proxy_http_version 1.1;$proxy_sni
      proxy_set_header Host $proxy_host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_read_timeout 60s;
      client_max_body_size 25m;
    }

    # Uploaded assets (served directly by api today; will move to
    # S3-compatible later)
    location /uploads/ {$proxy_resolve
      proxy_pass $proxy_target;
      proxy_http_version 1.1;$proxy_sni
      proxy_set_header Host $proxy_host;
    }
PROXY
)
else
  echo "$0: API_ORIGIN unset - serving the SPA only, no /api proxy"
  block="    # API_ORIGIN unset: no proxy. The SPA calls the API directly."
fi

awk -v block="$block" '
  index($0, "#__API_PROXY__") { print block; next }
  { print }
' "$template" > "$target"
