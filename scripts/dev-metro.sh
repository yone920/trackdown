#!/usr/bin/env bash
# Metro for phone testing, reachable over Tailscale (ufw blocks LAN 8081 on this VM).
# Usage: ./scripts/dev-metro.sh          (foreground)
#        nohup ./scripts/dev-metro.sh > .metro.log 2>&1 &   (detached)
cd "$(dirname "$0")/.."
export REACT_NATIVE_PACKAGER_HOSTNAME=${REACT_NATIVE_PACKAGER_HOSTNAME:-100.64.198.50}
exec npx expo start --port "${METRO_PORT:-8081}"
