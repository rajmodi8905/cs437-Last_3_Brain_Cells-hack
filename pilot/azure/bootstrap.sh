#!/usr/bin/env bash
# Azure customData: no credentials or application source. Mount a NEW pilot data disk
# before installing Docker. Refuse unexpected formatted disks rather than erase them.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
disk=''
for attempt in $(seq 1 120); do
  for candidate in /dev/disk/azure/scsi1/lun0 /dev/disk/azure/data/by-lun/0; do
    if [ -b "$candidate" ]; then disk="$candidate"; break; fi
  done
  [ -n "$disk" ] && break
  sleep 1
done
[ -n "$disk" ] || { echo 'Pilot data disk missing; refusing setup.' >&2; exit 1; }
if ! blkid "$disk" >/dev/null 2>&1; then
  # The template attaches an empty, dedicated disk at LUN 0. Never touch the OS disk.
  [ "$(lsblk -n -o TYPE "$disk" | head -n 1)" = disk ]
  [ "$(lsblk -nr "$disk" | wc -l)" -eq 1 ]
  mkfs.ext4 -L campus-recall "$disk"
fi
[ "$(blkid -s LABEL -o value "$disk")" = campus-recall ] || {
  echo 'Unexpected filesystem on data disk; refusing setup.' >&2; exit 1;
}
mkdir -p /srv/campus-recall
uuid=$(blkid -s UUID -o value "$disk")
if ! findmnt --fstab --target /srv/campus-recall >/dev/null; then
  printf 'UUID=%s /srv/campus-recall ext4 defaults 0 2\n' "$uuid" >> /etc/fstab
fi
mountpoint -q /srv/campus-recall || mount /srv/campus-recall
mkdir -p /etc/campus-recall/secrets /opt/campus-recall
chmod 700 /etc/campus-recall /etc/campus-recall/secrets

apt-get update
apt-get install -y ca-certificates curl unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

cat > /etc/systemd/system/campus-recall.service <<'UNIT'
[Unit]
Description=Campus Recall pilot containers
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
RequiresMountsFor=/srv/campus-recall
ConditionPathIsMountPoint=/srv/campus-recall
ConditionPathExists=/opt/campus-recall/.env

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/campus-recall
ExecStartPre=/usr/bin/mountpoint -q /srv/campus-recall
ExecStart=/usr/bin/docker compose --env-file .env -f compose.yaml up -d --wait
ExecStop=/usr/bin/docker compose --env-file .env -f compose.yaml stop
TimeoutStartSec=300
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT
# Docker's own restart policies must also wait for the data disk after reboot.
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/pilot-data.conf <<'UNIT'
[Unit]
RequiresMountsFor=/srv/campus-recall
After=srv-campus\x2drecall.mount
UNIT
systemctl daemon-reload
systemctl enable campus-recall.service
printf 'Pilot VM bootstrap complete; release and secrets have not been installed.\n'
