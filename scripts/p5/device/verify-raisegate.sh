#!/bin/zsh
# Device check for the F-P5-7 raise gate (31dc781): SRT over cellular on a fresh input, deleted at the end.
#   P1 90 s uncovered, P2 60 s lens covered (quiet picture: the target must not climb), P3 60 s uncovered
#   (busy again: no overrun). The owner covers and uncovers the lens on the prompts.
#
# LAN=1: the same phases on a link that cannot carry the ceiling. This is the overrun F-P5-7 left untested.
# Cellular cannot be capped, so the phone publishes SRT over home Wi-Fi to this laptop, through
# udp-throttle.mjs (LAN_KBPS, default 1500, with a 300 ms drop-tail queue), to srt-live-transmit on loopback.
# The regulator reads only its own SRT link, so a capped laptop leg is a fair stand-in for a thin uplink, and
# no Cloudflare input is needed. Per-second throttle stats go to $OUT.throttle.csv.
# Tried first on 2026-09-28 and rejected:
#   - a gnirehtet USB reverse tether: the Rust relay segfaulted, and the Java relay's tunnel went silent
#     20-40 s after each start while OnePlus's background control cut the app's network;
#   - a pf dummynet cap: it broke the SRT handshake (the listener accepted, the phone's connect failed at
#     3 s), while the same connect uncapped published in 208 ms.
set -u

SERIAL=12be753e
HERE=${0:a:h}
REPO=${HERE:h:h:h}   # scripts/p5/device -> repo root
FILES=/sdcard/Android/data/com.seazn.capture/files
RUN=p5-raisegate-$(date -u +%Y%m%dT%H%M%SZ)
OUT=$REPO/.p5/$RUN
WPID=''
CPID=''
LPID=''
PUBLISHING=''
DATA_OFF=''
UID_CF=''
RPID=''
TPID=''

now_ms() { node -e 'process.stdout.write(String(Date.now()))' }
say() { print -r -- "$(now_ms) $(date -u +%H:%M:%SZ) $*" | tee -a $OUT.log }
cleanup() {
  if [[ -n $DATA_OFF ]]; then adb -s $SERIAL shell svc data enable >/dev/null 2>&1; DATA_OFF=''; fi
  adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall >/dev/null 2>&1
  for pid in $WPID $CPID $LPID $RPID $TPID; do [[ -n $pid ]] && kill $pid 2>/dev/null; done
  pkill -f 'srt://127.0.0.1:9101' 2>/dev/null
  WPID=''; CPID=''; LPID=''; RPID=''; TPID=''
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
if [[ ${LAN:-0} == 1 ]]; then
  LAPTOP_IP=$(ipconfig getifaddr en0) || die "laptop has no Wi-Fi address"
  adb -s $SERIAL shell svc wifi enable; sleep 3
  PHONE_IP=$(adb -s $SERIAL shell ip -4 -o addr show wlan0 | tr -d '\r' | awk '{print $4}' | cut -d/ -f1)
  [[ ${PHONE_IP%.*} == ${LAPTOP_IP%.*} ]] || die "phone ($PHONE_IP) and laptop ($LAPTOP_IP) are not on the same Wi-Fi"
  command -v srt-live-transmit >/dev/null || die "srt-live-transmit missing (brew install srt)"
  lsof -nP -iUDP:9100 -iUDP:9101 >/dev/null 2>&1 && die "UDP 9100 or 9101 already in use on the laptop"
  # A loop, so a reconnect finds a listener: srt-live-transmit serves one connection and exits.
  ( while :; do srt-live-transmit "srt://127.0.0.1:9101?mode=listener&latency=2000" file://con > /dev/null 2>> $OUT.srt-receiver.log; done ) &
  RPID=$!
  node $HERE/udp-throttle.mjs 9100 9101 ${LAN_KBPS:-1500} > $OUT.throttle.csv 2>> $OUT.log &
  TPID=$!
  sleep 1
  kill -0 $TPID 2>/dev/null || die "udp-throttle did not start"
  say "LAN: phone $PHONE_IP -> laptop $LAPTOP_IP:9100, capped at ${LAN_KBPS:-1500} kbps -> srt-live-transmit :9101"
else
  adb -s $SERIAL shell svc wifi disable; sleep 6
  [[ $(adb -s $SERIAL shell cmd wifi status | head -1 | tr -d '\r') == *disabled* ]] || die "wifi did not disable"
  adb -s $SERIAL shell ping -c 2 -W 3 1.1.1.1 >/dev/null 2>&1 || die "no cellular reachability"
fi
adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall

cd $REPO || die "repo missing"
if [[ ${LAN:-0} == 1 ]]; then
  # No passphrase: SessionFile treats it as optional, and nothing leaves the house.
  node -e 'const [f,ip]=process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({v:1, slotId:"lan", holdWindowSeconds:180, preferred:"srt", overlayUrl:"about:blank", playbackUrl:"about:blank", scoreUpdates:"realtime", srt:{url:`srt://${ip}:9100`, streamId:"p5-lan", latencyMs:2000}, rtmps:{url:`rtmps://${ip}:443/live/`, streamKey:"lan"}}))' $OUT.session.json $LAPTOP_IP
else
  created=$(node --env-file=.env.local scripts/p5/cf.ts create $RUN 2>/dev/null) || die "cf.ts create failed"
  UID_CF=$(print -r -- "$created" | awk '/^uid/{print $2}')
  PLAYBACK=$(print -r -- "$created" | awk '/^playback/{print $2}')
  [[ -n $UID_CF && -n $PLAYBACK ]] || die "could not read uid or playback"
  say "input uid=$UID_CF"
fi
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

if [[ ${LAN:-0} != 1 ]]; then
  node scripts/p5/hls-watch.ts "$PLAYBACK" 2000 > $OUT.hls.csv 2> $OUT.hls.err &
  WPID=$!
  node --env-file=.env.local $HERE/cf-status-watch.mjs $UID_CF 2000 > $OUT.cfstatus.csv 2> $OUT.cfstatus.err &
  CPID=$!
fi

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
T0=$(now_ms)
if [[ ${LAN:-0} == 1 ]]; then
  sleep 3
  grep -qi "accepted" $OUT.srt-receiver.log || die "srt-live-transmit shows no accepted connection: SRT is not reaching the laptop"
  say "LAN: receiver accepted the phone's SRT connection"
fi
say "P1: publishing; 90 s UNCOVERED (point it at something that moves if you can)"
sleep 90
P2=$(now_ms)
say ">>> COVER THE LENS NOW (60 s)"
sleep 60
P3=$(now_ms)
say ">>> UNCOVER THE LENS NOW (60 s, something moving if you can)"
sleep 60
P4=$(now_ms)
pull
say "per phase (target changes, egress vs expected at target, send buffer, sender drops):"
node -e '
const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").slice(1).map(l=>l.split(","));
const [t0,p2,p3,p4]=process.argv.slice(2).map(Number);
const s=rows.filter(r=>r[1]==="sample"&&r[10]==="true");
const phase=(name,a,b)=>{const x=s.filter(r=>+r[0]>=a&&+r[0]<b); if(!x.length){console.log(name,"no samples");return;}
 let raises=0,cuts=0; for(let i=1;i<x.length;i++){const d=(+x[i][24])-(+x[i-1][24]); if(d>0)raises++; if(d<0)cuts++;}
 const med=a=>a.sort((p,q)=>p-q)[a.length>>1];
 const ratio=x.map(r=>+r[12]/(((+r[24])+128000)*1.15));
 const maxBuf=Math.max(...x.map(r=>+r[21]||0));
 const drops=(+x[x.length-1][19]||0)-(+x[0][19]||0);
 const vf=((+x[x.length-1][14])-(+x[0][14]))/((x[x.length-1][0]-x[0][0])/1000);
 console.log(`${name}: target ${x[0][24]} -> ${x[x.length-1][24]}, raises ${raises}, cuts ${cuts}, egress median ${Math.round(med(x.map(r=>+r[12]))/1000)} kbps, egress/expected median ${med(ratio).toFixed(2)}, max sndBuf ${maxBuf} ms, new sender drops ${drops}, video ${vf.toFixed(1)} fps`);};
phase("P1 uncovered",t0,p2); phase("P2 covered",p2,p3); phase("P3 uncovered",p3,p4);' $OUT.device.csv $T0 $P2 $P3 $P4 | while read -r line; do say "$line"; done
say "regulator events: $(awk -F, 'NR > 1 && $2 == "regulator" {print $14}' $OUT.device.csv | tr '\n' ';')"

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
if [[ ${LAN:-0} == 1 ]]; then
  kill $RPID $TPID 2>/dev/null; pkill -f 'srt://127.0.0.1:9101' 2>/dev/null; RPID=''; TPID=''
  say "LAN: throttle per phase (kbps forwarded, packets dropped):"
  awk -F, -v p2=$P2 -v p3=$P3 -v t0=$T0 -v p4=$P4 'NR > 1 && $1 >= t0 && $1 < p4 { ph = ($1 < p2) ? "P1" : ($1 < p3) ? "P2" : "P3"; out[ph] += $3; drop[ph] += $4; n[ph]++ }
    END { for (ph in n) printf "  %s: forwarded %d kbps mean, dropped %d packets\n", ph, out[ph] * 8 / 1000 / n[ph], drop[ph] }' $OUT.throttle.csv | sort | while read -r line; do say "$line"; done
else
  say "waiting for recordings to finalise before cleanup"
  for i in {1..30}; do
    vids=$(node --env-file=.env.local scripts/p5/cf.ts videos $UID_CF 2>/dev/null)
    total=$(print -r -- "$vids" | awk '/^count/{print $2}'); ready=$(print -r -- "$vids" | grep -c ' ready ')
    [[ -n $total && $ready -eq $total ]] && break
    sleep 15
  done
  say "videos: $(print -r -- "$vids" | tr '\n' ';')"
  node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|eliminate this\|trace-warnings" | while read -r line; do say "cleanup: $line"; done
fi
say "DONE run=$RUN"
