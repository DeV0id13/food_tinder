#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_dir"
compose=(docker compose -f compose.yaml)
runtime_dir="$repo_dir/frontend/node_modules"
vite_entry="$runtime_dir/vite/bin/vite.js"
vite_args=(--host 0.0.0.0 --port 5173 --strictPort)
pid_file="$runtime_dir/.foodtinder-lan.pid"
lock_dir="$runtime_dir/.foodtinder-lan.lock"

usage() {
  printf 'Использование: %s [start [IPv4] | stop]\n' "$0"
}

detect_ipv4() {
  case "$(uname -s)" in
    Darwin)
      local interface
      interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
      [[ -n "$interface" ]] && ipconfig getifaddr "$interface"
      ;;
    Linux)
      ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}'
      ;;
  esac
}

lock_launcher() {
  if ! mkdir "$lock_dir" 2>/dev/null; then
    printf 'Дождитесь завершения другой операции запуска или остановки.\n' >&2
    exit 1
  fi
  trap 'rmdir "$lock_dir"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

started_at() {
  LC_ALL=C ps -p "$1" -o lstart= 2>/dev/null
}

read_live_pid() {
  [[ -f "$pid_file" ]] || return 1
  {
    IFS= read -r vite_pid && IFS= read -r vite_started && IFS= read -r vite_node
  } < "$pid_file" || return 1
  [[ "$vite_pid" =~ ^[1-9][0-9]*$ && "$vite_pid" != 1 && -n "$vite_started" && "$vite_node" == /* ]] || return 1
  [[ "$(started_at "$vite_pid")" == "$vite_started" ]]
}

is_lan_vite() {
  local args
  args="$(ps -ww -p "$vite_pid" -o command= 2>/dev/null)" || return 1
  [[ "$args" == "$vite_node $vite_entry ${vite_args[*]}" ]]
}

stop_launcher() {
  if [[ -d "$runtime_dir" ]]; then
    lock_launcher
    if read_live_pid; then
      if ! is_lan_vite; then
        printf 'Vite ещё запускается. Повторите остановку после запуска.\n' >&2
        exit 1
      fi
      # Check the start time again before signalling the recorded PID.
      if [[ "$(started_at "$vite_pid")" == "$vite_started" ]]; then
        kill "$vite_pid"
      fi
      for attempt in {1..20}; do
        if ! is_lan_vite; then break; fi
        sleep 0.1
      done
      if is_lan_vite; then
        printf 'Vite ещё завершает работу. Повторите остановку.\n' >&2
        exit 1
      fi
    fi
    rm -f "$pid_file"
  fi
  "${compose[@]}" stop web postgres
}

case "${1:-start}" in
  stop)
    if (( $# != 1 )); then usage >&2; exit 2; fi
    stop_launcher
    exit 0
    ;;
  start)
    if (( $# > 2 )); then usage >&2; exit 2; fi
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ ! -f .env ]]; then
  printf 'Создайте локальный .env по инструкции в корневом README.md.\n' >&2
  exit 1
fi
if ! node_bin="$(type -P node)" || [[ ! -f "$vite_entry" ]]; then
  printf 'Установите Node.js и pnpm, затем выполните pnpm install --frozen-lockfile в frontend/.\n' >&2
  exit 1
fi
[[ "$node_bin" == /* ]] || node_bin="$repo_dir/$node_bin"

lan_ip="${2:-$(detect_ipv4 || true)}"
if ! node -e '
  const host = process.argv[1];
  if (require("node:net").isIP(host) !== 4 || host.startsWith("127.") || host === "0.0.0.0") process.exit(1);
' "$lan_ip"; then
  printf 'Укажите текущий IPv4 компьютера в локальной сети вторым аргументом.\n' >&2
  exit 2
fi

lock_launcher
if read_live_pid; then
  printf 'FoodTinder уже запущен или запускается. Для остановки выполните %s stop.\n' "$0" >&2
  exit 1
fi
vite_started="$(started_at "$$")"
printf '%s\n%s\n%s\n' "$$" "$vite_started" "$node_bin" > "$pid_file"

# Resolve the service env_file through Compose so quotes and variable expansion match the container.
lan_allowed_hosts="$("${compose[@]}" config --format json | node -e '
  const {readFileSync} = require("node:fs");
  const {environment} = JSON.parse(readFileSync(0, "utf8")).services.web;
  const hosts = (environment.DJANGO_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  const lanHost = process.argv[1];
  if (hosts.includes(lanHost) || hosts.includes("*")) process.exit(0);
  if (!hosts.length) hosts.push("localhost", "127.0.0.1", "[::1]");
  process.stdout.write([...hosts, lanHost].join(","));
' "$lan_ip")"

if [[ -n "$lan_allowed_hosts" ]]; then
  export FOODTINDER_LAN_ALLOWED_HOSTS="$lan_allowed_hosts"
  compose+=(-f frontend/compose.lan.yaml)
fi

"${compose[@]}" up -d --wait postgres web
"${compose[@]}" exec -T web python manage.py migrate --noinput

printf 'На телефоне откройте http://%s:5173/\n' "$lan_ip"
cd frontend
rmdir "$lock_dir"
trap - EXIT INT TERM
exec "$node_bin" "$vite_entry" "${vite_args[@]}"
