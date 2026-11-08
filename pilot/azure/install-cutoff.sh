#!/usr/bin/env bash
# Install on the pilot VM as root. Public arguments only; no credentials are needed.
# Usage: sudo bash install-cutoff.sh 2026-12-06T12:00:00Z /subscriptions/.../virtualMachines/...
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run this installer as root on the pilot VM.' >&2; exit 1; }
[ "$#" -eq 2 ] || { echo 'Usage: install-cutoff.sh <UTC deadline YYYY-MM-DDTHH:MM:SSZ> <VM resource ID>' >&2; exit 1; }
command -v python3 >/dev/null
command -v systemctl >/dev/null

install -d -m 0700 /etc/campus-recall/cutoff
calendar=$(python3 - "$1" "$2" <<'PY'
import datetime, json, pathlib, re, sys
deadline, resource_id = sys.argv[1:]
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', deadline):
    raise SystemExit('Deadline must be an explicit UTC timestamp YYYY-MM-DDTHH:MM:SSZ.')
try:
    parsed = datetime.datetime.strptime(deadline, '%Y-%m-%dT%H:%M:%SZ')
except ValueError:
    raise SystemExit('Deadline is not a valid UTC date/time.')
if not re.fullmatch(r'/subscriptions/[0-9a-fA-F-]{36}/resourceGroups/[^/\s]+/providers/Microsoft\.Compute/virtualMachines/[^/\s]+', resource_id):
    raise SystemExit('Expected one full Azure VM resource ID.')
pathlib.Path('/etc/campus-recall/cutoff/config.json').write_text(json.dumps({
    'deadline': deadline, 'vmResourceId': resource_id,
}) + '\n')
print(parsed.strftime('%Y-%m-%d %H:%M:%S UTC'))
PY
)
chmod 0600 /etc/campus-recall/cutoff/config.json

cat > /usr/local/sbin/campus-recall-cutoff.py <<'PY'
#!/usr/bin/python3
"""Request this pilot VM's deallocation at/after its explicit UTC deadline."""
import datetime
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

config = json.loads(pathlib.Path('/etc/campus-recall/cutoff/config.json').read_text())
deadline = datetime.datetime.strptime(config['deadline'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
resource_id = config['vmResourceId']
if sys.argv[1:] == ['--check']:
    print('Cutoff configuration valid: ' + config['deadline'] + ' for ' + resource_id)
    raise SystemExit(0)
if sys.argv[1:]:
    raise SystemExit('Only --check is supported.')
if datetime.datetime.now(datetime.timezone.utc) < deadline:
    print('Pilot compute cutoff is not due.')
    raise SystemExit(0)

class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

# IMDS must bypass proxy environment variables. Token remains only in this process memory.
client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
metadata = 'http://169.254.169.254/metadata/'
retryable = {401, 403, 408, 409, 429, 500, 502, 503, 504}
for attempt in range(5):
    delay = min(5 * 2 ** attempt, 120)
    try:
        request = urllib.request.Request(metadata + 'instance/compute?api-version=2021-02-01', headers={'Metadata': 'true'})
        with client.open(request, timeout=10) as response:
            own_id = json.load(response).get('resourceId', '')
        if own_id.lower() != resource_id.lower():
            raise SystemExit('Cutoff refused: configured VM differs from instance metadata.')
        query = urllib.parse.urlencode({'api-version': '2018-02-01', 'resource': 'https://management.azure.com/'})
        request = urllib.request.Request(metadata + 'identity/oauth2/token?' + query, headers={'Metadata': 'true'})
        with client.open(request, timeout=10) as response:
            token = json.load(response).get('access_token')
        if not token:
            raise ValueError('Managed identity response has no access token.')
        request = urllib.request.Request(
            'https://management.azure.com' + resource_id + '/deallocate?api-version=2024-07-01',
            data=b'', method='POST', headers={'Authorization': 'Bearer ' + token},
        )
        with client.open(request, timeout=30) as response:
            status = response.status
        if status not in (200, 202):
            raise SystemExit('Cutoff failed: unexpected ARM HTTP status ' + str(status))
        print('Pilot self-deallocation accepted by Azure: HTTP ' + str(status), flush=True)
        raise SystemExit(0)
    except urllib.error.HTTPError as error:
        # Do not print response bodies, headers or request objects: they may contain credentials.
        print('Cutoff request failed: HTTP ' + str(error.code), flush=True)
        if error.code not in retryable:
            raise SystemExit(1)
        retry_after = error.headers.get('Retry-After', '')
        if retry_after.isdigit():
            delay = min(max(delay, int(retry_after)), 120)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        print('Cutoff request failed: network or response error.', flush=True)
    if attempt < 4:
        time.sleep(delay)
raise SystemExit('Cutoff was not accepted; systemd will retry in 15 minutes.')
PY
chmod 0700 /usr/local/sbin/campus-recall-cutoff.py

cat > /etc/systemd/system/campus-recall-cutoff.service <<'UNIT'
[Unit]
Description=Deallocate Campus Recall VM after the one-month compute cutoff
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=oneshot
User=root
ExecStart=/usr/bin/python3 /usr/local/sbin/campus-recall-cutoff.py
Restart=on-failure
RestartSec=15min
TimeoutStartSec=6min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UNIT

cat > /etc/systemd/system/campus-recall-cutoff.timer <<UNIT
[Unit]
Description=One-month Campus Recall compute deadline

[Timer]
OnCalendar=$calendar
OnBootSec=2min
Persistent=true
AccuracySec=1s
Unit=campus-recall-cutoff.service

[Install]
WantedBy=timers.target
UNIT
chmod 0644 /etc/systemd/system/campus-recall-cutoff.service /etc/systemd/system/campus-recall-cutoff.timer
systemctl daemon-reload
systemctl enable --now campus-recall-cutoff.timer
python3 /usr/local/sbin/campus-recall-cutoff.py --check
systemctl list-timers campus-recall-cutoff.timer --no-pager
