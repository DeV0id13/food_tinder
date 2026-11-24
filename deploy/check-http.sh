#!/usr/bin/env bash
set -euo pipefail

origin=${1:?HTTP origin is required}
allowed_host=${2:?Host header is required}
body=$(mktemp)
trap 'rm -f "$body"' EXIT

check() {
  local path=$1 expected=$2 status attempt
  for attempt in {1..6}; do
    if status=$(curl --disable --noproxy '*' --silent --show-error --max-time 3 \
      --header "Host: $allowed_host" --output "$body" --write-out '%{http_code}' \
      "$origin$path"); then
      case "$status" in
        200)
          if [[ $expected == readiness ]]; then
            local ready_json='^[[:space:]]*\{[[:space:]]*"status"[[:space:]]*:[[:space:]]*"ok"[[:space:]]*\}[[:space:]]*$'
            if [[ $(<"$body") =~ $ready_json ]]; then
              return 0
            fi
          elif grep -qF '<title>FoodTinder</title>' "$body" && grep -qF 'id="app"' "$body"; then
            return 0
          fi
          printf '%s did not return the expected %s body\n' "$path" "$expected" >&2
          return 1
          ;;
        5??) ;;
        *)
          printf '%s returned HTTP %s, expected 200\n' "$path" "$status" >&2
          return 1
          ;;
      esac
    else
      status="transport error"
    fi
    if [[ $attempt -lt 6 ]]; then
      sleep 2
    fi
  done
  printf '%s did not become ready after %s attempts (%s)\n' "$path" "$attempt" "$status" >&2
  return 1
}

check /api/v1/ready/ readiness
check / frontend
