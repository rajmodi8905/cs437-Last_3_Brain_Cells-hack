#!/usr/bin/env bash
# Root-only Azure Run Command entrypoint. Arguments are public immutable identifiers.
set -Eeuo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# == 3 ]] || fail 'Usage: deploy-release.sh IMAGE_REF REVISION RUN_ID'
image=$1 revision=$2 run_id=$3
[[ $image =~ ^ghcr\.io/rajmodi8905/campus-recall-pilot@sha256:[0-9a-f]{64}$ ]] || fail 'Invalid release image.'
[[ $revision =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid source revision.'
[[ $run_id =~ ^[0-9]{1,20}-[0-9]{1,5}$ ]] || fail 'Invalid workflow run identifier.'
[[ $(id -u) == 0 ]] || fail 'Deployment requires root.'
readonly root=/opt/campus-recall data=/srv/campus-recall cutoff=/etc/campus-recall/cutoff/config.json
readonly deadline=2026-12-06T12:17:11Z
readonly origin=https://campusrecall.indiasouthcentral.cloudapp.azure.com
for tool in docker python3 flock mountpoint systemctl curl sha256sum; do command -v "$tool" >/dev/null || fail 'Required deployment tool missing.'; done
# Refuse near the cutoff as well: a release must leave time for a bounded rollback.
guard() {
  python3 - "$cutoff" "$deadline" <<'PY'
import datetime,json,sys,time
config=json.load(open(sys.argv[1]))
assert config['deadline']==sys.argv[2], 'Unexpected compute deadline.'
deadline=datetime.datetime.strptime(sys.argv[2],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()
assert time.time()+900 < deadline, 'Pilot cutoff is due or too close.'
PY
  [[ $(systemctl show campus-recall-cutoff.service --property=ActiveState --value) == inactive ]] || fail 'Pilot cutoff is running or unavailable.'
  systemctl is-active --quiet campus-recall-cutoff.timer || fail 'Pilot cutoff timer is not active.'
  mountpoint --quiet "$data" || fail 'Pilot data disk is not mounted.'
}
guard
[[ -d $root && -f $root/.env && ! -L $root/.env && -f $root/compose.yaml ]] || fail 'Existing deployment is incomplete.'
exec 9>"$root/.deploy-release.lock"
flock --nonblock 9 || fail 'Another pilot release is running.'
guard
cd "$root"
# Never source .env. Refuse ambiguous image/schema settings instead of evaluating shell text.
settings=$(python3 - "$root/.env" <<'PY'
import pathlib,re,sys
lines=pathlib.Path(sys.argv[1]).read_text().splitlines()
def get(key, default=None):
    matches=[s.split('=',1)[1].strip() for s in lines if re.match(r'^'+key+r'\s*=',s)]
    assert len(matches)<=1, 'Duplicate deployment setting.'
    value=matches[0] if matches else default
    if value and value[0:1] in ('"',"'"):
        assert value[-1:]==value[0], 'Invalid quoted setting.'
        value=value[1:-1]
    return value
image=get('PILOT_IMAGE'); schema=get('PILOT_DATABASE_SCHEMA','pilot')
assert image and re.fullmatch(r'[a-zA-Z0-9./:@_-]+',image), 'Invalid existing image setting.'
assert re.fullmatch(r'[a-z_][a-z0-9_]{0,62}',schema), 'Invalid database schema.'
assert get('PILOT_DATA_DIR','/srv/campus-recall')=='/srv/campus-recall', 'Unexpected data directory.'
assert get('PILOT_DOMAIN')=='campusrecall.indiasouthcentral.cloudapp.azure.com', 'Unexpected pilot origin.'
print(image); print(schema)
PY
)
old_ref=$(printf '%s\n' "$settings" | head -n 1)
schema=$(printf '%s\n' "$settings" | tail -n 1)
compose() { docker compose --project-directory "$root" --env-file "$root/.env" --file "$root/compose.yaml" "$@"; }
compose config --quiet
old_container=$(compose ps --quiet app)
[[ $old_container =~ ^[0-9a-f]{12,64}$ ]] || fail 'Exactly one running app is required.'
old_id=$(docker inspect --format '{{.Image}}' "$old_container")
[[ $old_id =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Current app image is not immutable.'
[[ $(docker image inspect --format '{{.Id}}' "$old_ref") == "$old_id" ]] || fail 'Selected and running app images differ.'
old_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$old_id")
[[ $old_revision =~ ^[0-9a-f]{40}$ ]] || fail 'Prior image has no valid source revision.'
[[ $(docker inspect --format '{{.State.Health.Status}}' "$old_container") == healthy ]] || fail 'Current app must be healthy before release.'
# A fixed run id cannot replay or race a newer completed workflow run.
install -d -m 0700 "$root/releases"
python3 - "$root/releases" "$run_id" <<'PY'
import json,pathlib,sys
new=tuple(map(int,sys.argv[2].split('-')))
for file in pathlib.Path(sys.argv[1]).glob('*.json'):
    record=json.loads(file.read_text())
    assert tuple(map(int,record['runId'].split('-'))) < new, 'Stale or repeated workflow run.'
PY
work=$(mktemp -d "$root/.release.XXXXXXXX")
chmod 0700 "$work"
changed=0
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
# Candidate execution has no network, secrets, data mounts or elevated capabilities.
docker pull --quiet "$image" >"$work/pull.log" 2>&1 || fail 'Candidate pull failed.'
new_id=$(docker image inspect --format '{{.Id}}' "$image")
[[ $new_id =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Candidate has no immutable image ID.'
[[ $(docker image inspect --format '{{.Architecture}}' "$new_id") == amd64 ]] || fail 'Candidate is not Linux AMD64.'
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$new_id") == "$revision" ]] || fail 'Candidate source revision mismatch.'
# The literal migration array is compared, not only its length: editing an old step also
# prevents unattended rollout. Missing/changed bundler format fails closed for manual review.
plan_code='const fs=require("node:fs"),vm=require("node:vm"),crypto=require("node:crypto");const s=fs.readFileSync("/app/server/main.mjs","utf8");const m=s.match(/var MIGRATIONS = (\[[\s\S]*?\n\]);/);if(!m)process.exit(1);const a=vm.runInNewContext(m[1],Object.create(null),{timeout:1000});if(!Array.isArray(a)||!a.length||!a.every(x=>typeof x==="string"))process.exit(1);console.log(crypto.createHash("sha256").update(JSON.stringify(a)).digest("hex")+":"+a.map((_,i)=>i+1).join(","));'
plan() { docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$1" -e "$plan_code"; }
old_plan=$(plan "$old_id")
new_plan=$(plan "$new_id")
[[ $old_plan =~ ^[0-9a-f]{64}:[0-9,]+$ && $new_plan == "$old_plan" ]] || fail 'Database migration plan changed; manual release required.'
applied=$(compose exec --no-TTY postgres psql -U pilot -d pilot -At -c "SELECT string_agg(version::text, ',' ORDER BY version) FROM \"$schema\".schema_migrations;")
[[ $applied == "${old_plan#*:}" ]] || fail 'Live database migration history differs from the release.'
# Keep database/object identifiers out of Azure Run Command output.
compose exec --no-TTY app node /app/entrypoint.mjs /app/server/backup.mjs now >"$work/backup.log" 2>&1 || fail 'Pre-release database backup failed.'
compose exec --no-TTY app node /app/entrypoint.mjs /app/server/backup.mjs verify >"$work/verify.log" 2>&1 || fail 'Pre-release object verification failed.'
# Preserve private evidence without copying any environment/secrets into release records.
install -m 0600 "$work/backup.log" "$root/releases/$run_id.backup.log"
install -m 0600 "$work/verify.log" "$root/releases/$run_id.verify.log"
cp -p "$root/.env" "$work/prior.env"
write_image() {
  python3 - "$root/.env" "$1" <<'PY'
import os,pathlib,re,stat,sys,tempfile
path=pathlib.Path(sys.argv[1]); meta=path.stat(); text=path.read_text()
text,count=re.subn(r'^PILOT_IMAGE\s*=.*$',lambda _: 'PILOT_IMAGE='+sys.argv[2],text,flags=re.M)
assert count==1, 'Expected one existing image setting.'
fd,name=tempfile.mkstemp(prefix='.env.release.',dir=path.parent)
try:
    with os.fdopen(fd,'w') as file:
        file.write(text); file.flush(); os.fsync(file.fileno()); os.fchmod(file.fileno(),stat.S_IMODE(meta.st_mode)); os.fchown(file.fileno(),meta.st_uid,meta.st_gid)
    os.replace(name,path)
finally:
    if os.path.exists(name): os.unlink(name)
PY
}
# HTTPS proof includes actual HTML + its built JS bytes, rather than a revision label alone.
smoke() {
  local expected=$1 container actual hash path
  guard || return 1
  container=$(compose ps --quiet app) || return 1
  [[ $container =~ ^[0-9a-f]{12,64}$ ]] || return 1
  actual=$(docker inspect --format '{{.Image}}' "$container") || return 1
  [[ $actual == "$expected" ]] || return 1
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$container") == healthy ]] || return 1
  curl --fail --silent --show-error --max-time 30 --proto '=https' "$origin/api/v1/config" >"$work/config.json" 2>"$work/curl.log" || return 1
  python3 - "$work/config.json" <<'PY' || return 1
import json,sys
assert isinstance(json.load(open(sys.argv[1])),dict)
PY
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$expected" -e 'const fs=require("node:fs");process.stdout.write(fs.readFileSync("/app/dist/index.html"));' >"$work/expected.html" || return 1
  curl --fail --silent --show-error --max-time 30 --proto '=https' "$origin/" >"$work/public.html" 2>"$work/curl.log" || return 1
  cmp --silent "$work/expected.html" "$work/public.html" || return 1
  path=$(python3 - "$work/expected.html" <<'PY'
import pathlib,re,sys
match=re.search(r'<script\b[^>]*\bsrc="(/assets/index-[A-Za-z0-9_-]+\.js)"',pathlib.Path(sys.argv[1]).read_text())
assert match, 'Missing built application asset.'
print(match[1])
PY
) || return 1
  hash=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$expected" -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync("/app/dist"+process.argv[1])).digest("hex"));' "$path") || return 1
  [[ $hash =~ ^[0-9a-f]{64}$ ]] || return 1
  curl --fail --silent --show-error --max-time 30 --proto '=https' "$origin$path" >"$work/public.js" 2>"$work/curl.log" || return 1
  [[ $(sha256sum "$work/public.js" | cut -d ' ' -f 1) == "$hash" ]]
}
record() {
  python3 - "$root/releases/$run_id.json" "$run_id" "$old_revision" "$revision" "$old_id" "$new_id" "$image" "$1" <<'PY'
import datetime,json,pathlib,sys
path,run,old,new,old_image,new_image,ref,status=sys.argv[1:]
pathlib.Path(path).write_text(json.dumps(dict(runId=run,oldRevision=old,newRevision=new,oldImageId=old_image,newImageId=new_image,image=ref,status=status,at=datetime.datetime.now(datetime.timezone.utc).isoformat()),indent=2)+'\n')
PY
}
rollback() {
  trap - ERR INT TERM
  # Do not restart any app if the pilot deadline has arrived or cutoff is running.
  if guard; then
    cp -p "$work/prior.env" "$root/.env.rollback"
    mv -f "$root/.env.rollback" "$root/.env"
    if PILOT_IMAGE="$old_id" compose up --detach --no-deps --wait --wait-timeout 180 app >"$work/rollback.log" 2>&1 && smoke "$old_id"; then
      record rolled-back
      fail 'Release failed; prior app image restored and verified.'
    fi
  fi
  record rollback-failed
  fail 'Release failed; rollback could not be verified. Operator intervention required.'
}
# Only these operations may change application selection. Neither DB nor Caddy is recreated.
guard
trap '[[ $changed == 0 ]] || rollback' ERR
trap '[[ $changed == 0 ]] || rollback; exit 1' INT TERM
changed=1
write_image "$image"
compose up --detach --no-deps --wait --wait-timeout 180 app >"$work/launch.log" 2>&1
smoke "$new_id"
record deployed
trap - ERR INT TERM
# Bounded image retention: remove only earlier recorded app images, never current/rollback
# or images used by ANY container. No global prune, force-removal, volumes or foreign images.
python3 - "$root/releases" "$new_id" "$old_id" <<'PY' >"$work/remove-images"
import json,pathlib,re,sys
records=sorted((json.loads(p.read_text()) for p in pathlib.Path(sys.argv[1]).glob('*.json')),key=lambda r:tuple(map(int,r['runId'].split('-'))),reverse=True)
keep={sys.argv[2],sys.argv[3]}
for record in records[:3]: keep.update([record['oldImageId'],record['newImageId']])
remove={r['newImageId'] for r in records[3:]}-keep
for image in sorted(remove):
    if re.fullmatch(r'sha256:[0-9a-f]{64}',image): print(image)
PY
while read -r stale; do
  [[ -n $stale ]] || continue
  used=$(docker ps --all --quiet --filter "ancestor=$stale")
  [[ -z $used ]] || continue
  # Non-forced deletion itself refuses additional references or in-use images.
  docker image rm "$stale" >"$work/prune.log" 2>&1 || true
done <"$work/remove-images"
printf 'CAMPUS_RECALL_DEPLOY_OK:%s:%s\n' "$revision" "${image##*@}"
