#!/bin/zsh
# Device checks for the delivery safeguards (7f714e7 regulation, 41261b3 stall recovery, b6dd050 LIVE
# gating), on one SRT publish over cellular with a fresh input that is deleted at the end.
#
#   verify-safeguards.sh
#
#   A  healthy 150 s: no video-* events, a regulator event, column 25 filled, ~30 fps, HUD "LIVE srt"
#   B  stall hook pushed while video flows: video-stalled 3.0-4.5 s after the push, dropped
#      reason=video-stalled, video-recovery simulated=true, video-recovered, hook file gone, HUD
#      "NO VIDEO" during and "LIVE srt" after
#   C  20 s mobile-data cut: column 25 and egress per second around it — does the target move, and does
#      egress follow the target once reconnected
set -u

SERIAL=12be753e
HERE=${0:a:h}
REPO=${HERE:h:h:h}   # scripts/p5/device -> repo root
FILES=/sdcard/Android/data/com.seazn.capture/files
RUN=p5-safeguards-$(date -u +%Y%m%dT%H%M%SZ)
OUT=$REPO/.p5/$RUN
WPID=''
CPID=''
LPID=''
PUBLISHING=''
DATA_OFF=''
UID_CF=''

now_ms() { node -e 'process.stdout.write(String(Date.now()))' }
say() { print -r -- "$(now_ms) $(date -u +%H:%M:%SZ) $*" | tee -a $OUT.log }
cleanup() {
  if [[ -n $DATA_OFF ]]; then adb -s $SERIAL shell svc data enable >/dev/null 2>&1; DATA_OFF=''; fi
  adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall >/dev/null 2>&1
  for pid in $WPID $CPID $LPID; do [[ -n $pid ]] && kill $pid 2>/dev/null; done
  WPID=''; CPID=''; LPID=''
}
die() {
  say "FATAL: $*"
  # Stop the app whatever it was doing: on 2026-09-28 a run that died "never publishing" left it retrying
  # SRT, and left its input on the shared account. Delete only the input this run created.
  adb -s $SERIAL shell am force-stop com.seazn.capture >/dev/null 2>&1 && say "force-stopped the app"
  cleanup
  adb -s $SERIAL shell svc wifi enable >/dev/null 2>&1
  if [[ -n $UID_CF ]]; then
    ( cd $REPO && node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 ) | grep -E "^deleted|rror" | while read -r line; do say "cleanup: $line"; done
  fi
  exit 1
}
trap cleanup EXIT INT TERM
pull() { adb -s $SERIAL pull $CSV $OUT.device.csv >/dev/null 2>&1 || die "csv pull failed" }
# Events of the given kinds at or after a laptop epoch (device clock is within ~0.2 s).
events_since() { awk -F, -v t=$1 -v k="$2" 'NR > 1 && $1 >= t && $2 ~ ("^(" k ")$") {print}' $OUT.device.csv | cut -c1-200 }

mkdir -p $REPO/.p5
: > $OUT.log
say "safeguards check run=$RUN"
# Continuous logcat for the whole run: the device ring buffer rolled over within minutes on
# 2026-09-14 and took the only evidence of a stuck recovery with it.
adb -s $SERIAL logcat -v threadtime > $OUT.logcat.txt 2>&1 &
LPID=$!
adb devices | grep -q "^$SERIAL" || die "phone not attached"
adb -s $SERIAL shell wm dismiss-keyguard >/dev/null 2>&1
adb -s $SERIAL shell input keyevent 82 >/dev/null 2>&1
sleep 1
# A locked phone launches the app behind the keyguard, where it never arms (2026-09-14: the first
# safeguards check died "app did not arm" with the lock screen up). Fail here, with the reason.
# The keyguard flag can read true for a moment after a successful dismiss, so give it 6 s to clear.
locked=yes
for i in {1..6}; do
  adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -qiE "(mKeyguardShowing|isKeyguardShowing)=true" || { locked=''; break }
  sleep 1
done
[[ -z $locked ]] || die "phone is locked; unlock it and run again"
adb -s $SERIAL shell svc wifi disable; sleep 6
[[ $(adb -s $SERIAL shell cmd wifi status | head -1 | tr -d '\r') == *disabled* ]] || die "wifi did not disable"
adb -s $SERIAL shell ping -c 2 -W 3 1.1.1.1 >/dev/null 2>&1 || die "no cellular reachability"
adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall

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
resolved=$(node $HERE/tap-visible.mjs "^Hold to stop$" $SERIAL 100 --dry 2>>$OUT.log)
HOLD_XY=$(print -r -- "$resolved" | awk '/^DRY:/{for (i = 1; i <= NF; i++) if ($i == "at") print $(i + 1)}')
[[ $HOLD_XY == *,* ]] || die "could not resolve Hold to stop"
say "armed; csv $CSV; hold at $HOLD_XY"

node scripts/p5/hls-watch.ts "$PLAYBACK" 2000 > $OUT.hls.csv 2> $OUT.hls.err &
WPID=$!
node --env-file=.env.local $HERE/cf-status-watch.mjs $UID_CF 2000 > $OUT.cfstatus.csv 2> $OUT.cfstatus.err &
CPID=$!

started=''
for attempt in 1 2 3; do
  node $HERE/tap-visible.mjs "^Start SRT$" $SERIAL >> $OUT.log 2>&1 || continue
  for i in {1..10}; do adb -s $SERIAL shell "grep -q ',connecting,' $CSV" && { started=yes; break }; sleep 1; done
  [[ -n $started ]] && break
done
[[ -n $started ]] || die "Start SRT never produced a connecting event"
for i in {1..30}; do adb -s $SERIAL shell "grep -q ',publishing,' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',publishing,' $CSV" || die "never publishing"
PUBLISHING=yes
A_START=$(now_ms)
say "A: publishing; healthy for 150 s"
sleep 20
adb -s $SERIAL exec-out screencap -p > $OUT.hud-A.png
sleep 130
pull
say "A: video-* events: $(events_since $A_START 'video-stalled|video-recovery|video-recovered|video-recovery-failed' | wc -l | tr -d ' ') (want 0)"
say "A: regulator events: $(awk -F, 'NR > 1 && $2 == "regulator" {print $14}' $OUT.device.csv | tr '\n' ';')"
node -e '
const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>l.split(","));
const t0=+process.argv[2]+2000; const s=rows.filter(r=>r[1]==="sample"&&+r[0]>=t0&&r[10]==="true");
const a=s[0],b=s[s.length-1],secs=(b[0]-a[0])/1000; const filled=s.filter(r=>r[24]!==undefined&&r[24]!=="").length;
const targets=[...new Set(s.map(r=>r[24]))].slice(0,8).join("|");
console.log(`A: ${s.length} publishing samples; video ${((b[14]-a[14])/secs).toFixed(2)} fps; column 25 filled ${filled}/${s.length}; targets seen ${targets}; egress median ${Math.round(s.map(r=>+r[12]).sort((x,y)=>x-y)[s.length>>1]/1000)} kbps`);' $OUT.device.csv $A_START | while read -r line; do say "$line"; done

B_PUSH=$(now_ms)
adb -s $SERIAL shell touch $FILES/p5-simulate-video-stall
say "B: stall hook pushed"
sleep 5
adb -s $SERIAL exec-out screencap -p > $OUT.hud-B-stall.png
for i in {1..40}; do adb -s $SERIAL shell "grep -q ',video-recovered,' $CSV" && break; sleep 1; done
sleep 6
adb -s $SERIAL exec-out screencap -p > $OUT.hud-B-after.png
pull
say "B: events since push:"
events_since $B_PUSH 'video-stalled|dropped|video-recovery|video-stall-simulation|connecting|publishing|video-recovered|video-recovery-failed|regulator' | while read -r line; do say "  $line"; done
stalled_at=$(awk -F, -v t=$B_PUSH 'NR > 1 && $1 >= t && $2 == "video-stalled" {print $1; exit}' $OUT.device.csv)
[[ -n $stalled_at ]] && say "B: video-stalled $(( stalled_at - B_PUSH )) ms after the push (want 3000-4500)" || say "B: NO video-stalled"
say "B: hook file after: $(adb -s $SERIAL shell "ls $FILES/p5-simulate-video-stall 2>/dev/null || echo gone" | tr -d '\r')"

sleep 30
C_CUT=$(now_ms)
say "C: mobile data off for 20 s"
DATA_OFF=yes
adb -s $SERIAL shell svc data disable
sleep 20
adb -s $SERIAL shell svc data enable
DATA_OFF=''
say "C: data on; observing 70 s"
sleep 70
pull
say "C: events since cut:"
events_since $C_CUT 'dropped|connecting|publishing|regulator|video-stalled|video-recovery|video-recovered' | grep -v connect-failed | while read -r line; do say "  $line"; done
node -e '
const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>l.split(","));
const cut=+process.argv[2]; const iso=ms=>new Date(+ms).toISOString().slice(11,19);
let prev=null;
for(const r of rows){ if(r[1]!=="sample") continue; const t=+r[0]; if(t<cut-10000||t>cut+95000){prev=r;continue;}
 const vf=prev?((+r[14]-+prev[14])/((t-+prev[0])/1000)).toFixed(0):"-";
 console.log(`C: ${iso(t)} streaming=${r[10]} net=${r[8]} kbps=${Math.round(+r[12]/1000)} target=${r[24]||"-"} vfps=${vf} sndBuf=${r[21]||"-"} rtt=${r[20]?(+r[20]).toFixed(0):"-"} drops=${r[19]||"-"}`); prev=r; }' $OUT.device.csv $C_CUT | awk 'NR % 2 == 1' | while read -r line; do say "$line"; done

HX=${HOLD_XY%,*}; HY=${HOLD_XY#*,}
say "stop: hold at $HX,$HY"
adb -s $SERIAL shell input motionevent DOWN $HX $HY; sleep 1.5; adb -s $SERIAL shell input motionevent UP $HX $HY
for i in {1..10}; do adb -s $SERIAL shell "grep -q ',service-stopped,' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',service-stopped,' $CSV" || { adb -s $SERIAL shell am force-stop com.seazn.capture; say "WARN: clean stop did not register; force-stopped"; }
PUBLISHING=''
pull
sleep 3
kill $WPID $CPID 2>/dev/null; WPID=''; CPID=''
adb -s $SERIAL shell svc wifi enable

say "waiting for recordings to finalise before cleanup"
for i in {1..30}; do
  vids=$(node --env-file=.env.local scripts/p5/cf.ts videos $UID_CF 2>/dev/null)
  total=$(print -r -- "$vids" | awk '/^count/{print $2}'); ready=$(print -r -- "$vids" | grep -c ' ready ')
  [[ -n $total && $ready -eq $total ]] && break
  sleep 15
done
say "videos: $(print -r -- "$vids" | tr '\n' ';')"
node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|eliminate this\|trace-warnings" | while read -r line; do say "cleanup: $line"; done
say "DONE run=$RUN"
