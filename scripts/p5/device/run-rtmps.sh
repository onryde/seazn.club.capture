#!/bin/zsh
# Run B (T5, N5): RTMPS as the primary path, over Wi-Fi, to a fresh Cloudflare input deleted at the end.
# RTMPS is C1's fallback for the phone, and the only path many RTMP-only hardware encoders ever use (N5),
# so its behaviour over a long run is untested primary behaviour for real customers.
#
#   run-rtmps.sh            publish 60 min; no network for 20 s at minute 20 and for 200 s at minute 40
#   CUT1_S=… CUT2_S=… END_S=… run-rtmps.sh      the same timeline, rescaled (seconds from publishing)
#
# The outages turn off Wi-Fi AND mobile data, since the phone would otherwise fail over to cellular. The
# 20 s outage sits inside the 180 s hold window, so it should resume into one recording (criterion 4). The
# 200 s outage is beyond it, so it should end the recording with ENDLIST and start a second one, and the
# app must reconnect unaided (criterion 5). Everything else is read after the run from the CSV
# (telemetry-report), the playlist watch and Cloudflare's own status.
set -u

SERIAL=12be753e
HERE=${0:a:h}
REPO=${HERE:h:h:h}   # scripts/p5/device -> repo root
FILES=/sdcard/Android/data/com.seazn.capture/files
RUN=p5-runb-$(date -u +%Y%m%dT%H%M%SZ)
OUT=$REPO/.p5/$RUN
CUT1_S=${CUT1_S:-1200}
CUT2_S=${CUT2_S:-2400}
END_S=${END_S:-3600}
WPID=''
CPID=''
LPID=''
UID_CF=''
NET_OFF=''

now_ms() { node -e 'process.stdout.write(String(Date.now()))' }
say() { print -r -- "$(now_ms) $(date -u +%H:%M:%SZ) $*" | tee -a $OUT.log }
net_on() { adb -s $SERIAL shell svc wifi enable >/dev/null 2>&1; adb -s $SERIAL shell svc data enable >/dev/null 2>&1; NET_OFF='' }
cleanup() {
  [[ -n $NET_OFF ]] && net_on
  for pid in $WPID $CPID $LPID; do [[ -n $pid ]] && kill $pid 2>/dev/null; done
  WPID=''; CPID=''; LPID=''
}
die() {
  say "FATAL: $*"
  adb -s $SERIAL shell am force-stop com.seazn.capture >/dev/null 2>&1 && say "force-stopped the app"
  cleanup
  if [[ -n $UID_CF ]]; then
    ( cd $REPO && node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 ) | grep -E "^deleted|rror" | while read -r line; do say "cleanup: $line"; done
  fi
  exit 1
}
trap cleanup EXIT INT TERM
pull() { adb -s $SERIAL pull $CSV $OUT.device.csv >/dev/null 2>&1 || die "csv pull failed" }
wait_until() { while (( $(now_ms) < $1 )); do sleep 5; done }
events_since() { awk -F, -v t=$1 -v k="$2" 'NR > 1 && $1 >= t && $2 ~ ("^(" k ")$") {print}' $OUT.device.csv | cut -c1-200 }
# One outage: no network for $2 seconds, then the app's own events until $3 seconds after the restore.
outage() {
  local label=$1 secs=$2 watch=$3 cut back
  cut=$(now_ms)
  say "$label: Wi-Fi and mobile data OFF for $secs s"
  NET_OFF=yes
  adb -s $SERIAL shell svc wifi disable; adb -s $SERIAL shell svc data disable
  sleep $secs
  net_on
  back=$(now_ms)
  say "$label: network ON; watching $watch s"
  sleep $watch
  pull
  say "$label: events from the cut:"
  events_since $cut 'dropped|connecting|publishing|fell-back|video-stalled|video-recovery|video-recovered' | grep -v connect-failed | while read -r line; do say "  $line"; done
  local pub=$(awk -F, -v t=$back 'NR > 1 && $1 >= t && $2 == "publishing" {print $1; exit}' $OUT.device.csv)
  [[ -n $pub ]] && say "$label: publishing again $(( (pub - back) / 1000 )).$(( (pub - back) % 1000 / 100 )) s after the network came back" \
    || say "$label: NOT publishing again within $watch s of the network coming back"
}

mkdir -p $REPO/.p5
: > $OUT.log
say "Run B run=$RUN cut1=${CUT1_S}s cut2=${CUT2_S}s end=${END_S}s"
adb -s $SERIAL logcat -v threadtime > $OUT.logcat.txt 2>&1 &
LPID=$!
adb devices | grep -q "^$SERIAL" || die "phone not attached"
adb -s $SERIAL shell wm dismiss-keyguard >/dev/null 2>&1
sleep 1
locked=yes
for i in {1..6}; do
  adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -qiE "(mKeyguardShowing|isKeyguardShowing)=true" || { locked=''; break }
  sleep 1
done
[[ -z $locked ]] || die "phone is locked; unlock it and run again"
net_on; sleep 3
adb -s $SERIAL shell dumpsys connectivity | tr -d '\r' | grep -q "Active default network" || die "no active network"
adb -s $SERIAL shell dumpsys connectivity | tr -d '\r' | grep -qE "ni\{WIFI CONNECTED" || die "phone is not on Wi-Fi"
adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall $FILES/p5-f10-mode

cd $REPO || die "repo missing"
created=$(node --env-file=.env.local scripts/p5/cf.ts create $RUN 2>/dev/null) || die "cf.ts create failed"
UID_CF=$(print -r -- "$created" | awk '/^uid/{print $2}')
PLAYBACK=$(print -r -- "$created" | awk '/^playback/{print $2}')
[[ -n $UID_CF && -n $PLAYBACK ]] || die "could not read uid or playback"
say "input uid=$UID_CF"
adb -s $SERIAL push $OUT.session.json $FILES/p5-session.json >/dev/null 2>&1 || die "session push failed"
adb -s $SERIAL shell am force-stop com.seazn.capture
adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP
adb -s $SERIAL shell monkey -p com.seazn.capture -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 10
CSV=$(adb -s $SERIAL shell "ls -t $FILES/p5-*.csv | head -1" | tr -d '\r')
adb -s $SERIAL shell "grep -q ',armed,' $CSV" || die "app did not arm ($CSV)"
# Retried: at 21:12Z on 2026-09-28 the first dump missed a control that was there seconds later.
HOLD_XY=''
for attempt in {1..5}; do
  resolved=$(node $HERE/tap-visible.mjs "^Hold to stop$" $SERIAL 100 --dry 2>>$OUT.log)
  HOLD_XY=$(print -r -- "$resolved" | awk '/^DRY:/{for (i = 1; i <= NF; i++) if ($i == "at") print $(i + 1)}')
  [[ $HOLD_XY == *,* ]] && break
  sleep 2
done
[[ $HOLD_XY == *,* ]] || die "could not resolve Hold to stop"
say "armed; csv $CSV"

node scripts/p5/hls-watch.ts "$PLAYBACK" 2000 > $OUT.hls.csv 2> $OUT.hls.err &
WPID=$!
node --env-file=.env.local $HERE/cf-status-watch.mjs $UID_CF 2000 > $OUT.cfstatus.csv 2> $OUT.cfstatus.err &
CPID=$!

started=''
for attempt in 1 2 3; do
  node $HERE/tap-visible.mjs "^Start RTMPS$" $SERIAL >> $OUT.log 2>&1 || continue
  for i in {1..10}; do adb -s $SERIAL shell "grep -q ',connecting,' $CSV" && { started=yes; break }; sleep 1; done
  [[ -n $started ]] && break
done
[[ -n $started ]] || die "Start RTMPS never produced a connecting event"
for i in {1..30}; do adb -s $SERIAL shell "grep -q ',publishing,.*transport=rtmps' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',publishing,.*transport=rtmps' $CSV" || die "never publishing over RTMPS"
T0=$(now_ms)
say "publishing over RTMPS; the run ends at +${END_S} s"
sleep 60
adb -s $SERIAL exec-out screencap -p > $OUT.hud-start.png

wait_until $(( T0 + CUT1_S * 1000 ))
outage CUT1 20 60
wait_until $(( T0 + CUT2_S * 1000 ))
outage CUT2 200 90
adb -s $SERIAL exec-out screencap -p > $OUT.hud-after-cut2.png
wait_until $(( T0 + END_S * 1000 ))

HX=${HOLD_XY%,*}; HY=${HOLD_XY#*,}
say "stop: hold at $HX,$HY"
adb -s $SERIAL shell input motionevent DOWN $HX $HY; sleep 1.5; adb -s $SERIAL shell input motionevent UP $HX $HY
for i in {1..10}; do adb -s $SERIAL shell "grep -q ',service-stopped,' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',service-stopped,' $CSV" || { adb -s $SERIAL shell am force-stop com.seazn.capture; say "WARN: clean stop did not register; force-stopped"; }
pull
sleep 10
kill $WPID $CPID 2>/dev/null; WPID=''; CPID=''

node scripts/p5/telemetry-report.ts $OUT.device.csv > $OUT.report.json 2> $OUT.report.err && say "telemetry report: $OUT.report.json"
say "playlist verdicts: $(awk -F, 'NR > 1 {print $7}' $OUT.hls.csv | sort | uniq -c | tr '\n' ';')"
say "playlist ENDLIST rows: $(awk -F, 'NR > 1 && $6 == "true"' $OUT.hls.csv | wc -l | tr -d ' ')"
say "cloudflare status changes: $(awk -F, 'NR > 1 && $3 != p {print $1 " " $3; p = $3}' $OUT.cfstatus.csv | tr '\n' ';')"
say "waiting for recordings to finalise before cleanup"
for i in {1..40}; do
  vids=$(node --env-file=.env.local scripts/p5/cf.ts videos $UID_CF 2>/dev/null)
  total=$(print -r -- "$vids" | awk '/^count/{print $2}'); ready=$(print -r -- "$vids" | grep -c ' ready ')
  [[ -n $total && $ready -eq $total ]] && break
  sleep 15
done
say "recordings (criteria 4 and 5 want 2: one across the 20 s outage, a second after the 200 s one): $(print -r -- "$vids" | tr '\n' ';')"
node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|eliminate this\|trace-warnings" | while read -r line; do say "cleanup: $line"; done
UID_CF=''
say "DONE run=$RUN"
