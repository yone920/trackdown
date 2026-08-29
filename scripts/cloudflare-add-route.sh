#!/usr/bin/env bash
# Adds trackdown-api.yonelab.net → http://localhost:8003 to the shared `clound_tunnel`
# (remotely-managed cloudflared on the Docker host) and creates the proxied CNAME.
# Idempotent. Needs ~/.cloudflare.token (Tunnel:Edit + DNS:Edit for yonelab.net).
#
#   ./scripts/cloudflare-add-route.sh            # add
#   HOSTNAME=other-api.yonelab.net ./scripts/cloudflare-add-route.sh
set -euo pipefail
HOSTNAME="${HOSTNAME:-trackdown-api.yonelab.net}"
SERVICE="${SERVICE:-http://localhost:8003}"
TOKEN=$(tr -d '[:space:]' < ~/.cloudflare.token)
H="Authorization: Bearer $TOKEN"
API=https://api.cloudflare.com/client/v4
ACCT=8aa384e9a37463390d0126280326e44f
TID=c0ad4a62-8783-4cd0-b093-15833d3d0099
ZONE=44bcb4f1f972251311ecb6130c480201
TMP=$(mktemp -d)

curl -sf -H "$H" "$API/accounts/$ACCT/cfd_tunnel/$TID/configurations" > "$TMP/before.json"
python3 - "$TMP" "$HOSTNAME" "$SERVICE" <<'PY'
import json, sys
tmp, host, svc = sys.argv[1:]
d = json.load(open(f"{tmp}/before.json")); cfg = d["result"]["config"]; ing = cfg["ingress"]
assert str(ing[-1].get("service", "")).startswith("http_status"), "last rule is not the catch-all — refusing"
if any(r.get("hostname") == host for r in ing):
    print(f"ingress: {host} already present, unchanged"); open(f"{tmp}/skip", "w").close()
else:
    ing.insert(len(ing) - 1, {"hostname": host, "service": svc})
    json.dump({"config": cfg}, open(f"{tmp}/new.json", "w"))
    print(f"ingress: adding {host} -> {svc} ({len(ing)} rules, catch-all preserved)")
PY
if [ ! -f "$TMP/skip" ]; then
  curl -sf -X PUT -H "$H" -H "Content-Type: application/json" --data @"$TMP/new.json" \
    "$API/accounts/$ACCT/cfd_tunnel/$TID/configurations" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("tunnel config:", "ok, version", d["result"]["version"] if d["success"] else d["errors"])'
fi

EXISTING=$(curl -sf -H "$H" "$API/zones/$ZONE/dns_records?name=$HOSTNAME" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["result"]))')
if [ "$EXISTING" = "0" ]; then
  curl -sf -X POST -H "$H" -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${HOSTNAME%%.yonelab.net}\",\"content\":\"$TID.cfargotunnel.com\",\"proxied\":true,\"comment\":\"TrackDown API (Docker host :8003)\"}" \
    "$API/zones/$ZONE/dns_records" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("dns:", "ok" if d["success"] else d["errors"])'
else
  echo "dns: $HOSTNAME already exists, unchanged"
fi
rm -rf "$TMP"
sleep 5
curl -s -m 10 -o /dev/null -w "https://$HOSTNAME/health → HTTP %{http_code}\n" "https://$HOSTNAME/health"
