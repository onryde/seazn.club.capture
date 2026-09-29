#!/bin/zsh
# The final soak: every pass criterion a driver can reach without a person, in one 3 h run on the current build.
#
#   soak-final.sh                  SRT over Wi-Fi, 3 h, on a fresh Cloudflare input deleted at the end
#   PEEK1_S=… CUT_LONG_S=0 … soak-final.sh      the same timeline, rescaled; 0 skips a step (smoke runs)
#
# Timeline, in seconds from publishing (each overridable):
#   PROBE_S      240    peek-probe.mjs from the laptop: which playlist request 404s   output check
#   PEEK1_S      300    Peek default UA                          output check row 1
#   PEEK2_S      420    Peek browser UA                          output check row 2
#   CUT_SHORT_S  480    Wi-Fi and data off 20 s, during the peek criterion 4; output check row 3
#   PEEKOFF_S    600    Peek off
#   AUDIO_S      "660 3600 9000"  20 s of the delivered HLS through volumedetect   criterion 8
#   CUT_LONG_S   1800   Wi-Fi and data off 200 s                 criterion 5
#   LOCK_S       9600   simulated unplug + screen off and locked criterion 6
#   LOCK_END_S   10200  battery reset (the phone stays locked: see below)
#   END_S        10800  stop
#
# The lock is last on purpose: this handset has a secure keyguard, so once it locks nothing on adb can unlock it.
# That also means the run cannot end with Hold to stop; it ends with a force-stop, which is marked in the CSV.
# The unplug is simulated (`dumpsys battery unplug`) because adb rides the USB cable; see Run A's note.
# Criteria 1, 2, 3 and 9 are read afterwards from the CSV, the playlist watch and Cloudflare's status.
# Criterion 7 (a 180° flip) needs hands and is not attempted.
set -u

SERIAL=12be753e
HERE=${0:a:h}
REPO=${HERE:h:h:h}   # scripts/p5/device -> repo root
FILES=/sdcard/Android/data/com.seazn.capture/files
RUN=p5-soakf-$(date -u +%Y%m%dT%H%M%SZ)
OUT=$REPO/.p5/$RUN
PROBE_S=${PROBE_S:-240}
PEEK1_S=${PEEK1_S:-300}
PEEK2_S=${PEEK2_S:-420}
CUT_SHORT_S=${CUT_SHORT_S:-480}
PEEKOFF_S=${PEEKOFF_S:-600}
AUDIO_S=${AUDIO_S-660 3600 9000}   # "-", not ":-": an empty list means no samples
CUT_LONG_S=${CUT_LONG_S:-1800}
LOCK_S=${LOCK_S:-9600}
LOCK_END_S=${LOCK_END_S:-10200}
END_S=${END_S:-10800}
WPID=''
CPID=''
LPID=''
UID_CF=''
NET_OFF=''
UNPLUGGED=''
CSV=''

now_ms() { node -e 'process.stdout.write(String(Date.now()))' }
say() { print -r -- "$(now_ms) $(date -u +%H:%M:%SZ) $*" | tee -a $OUT.log }
net_on() { adb -s $SERIAL shell svc wifi enable >/dev/null 2>&1; adb -s $SERIAL shell svc data enable >/dev/null 2>&1; NET_OFF='' }
cleanup() {
  [[ -n $NET_OFF ]] && net_on
  [[ -n $UNPLUGGED ]] && { adb -s $SERIAL shell dumpsys battery reset >/dev/null 2>&1; UNPLUGGED=''; }
  for pid in $WPID $CPID $LPID; do [[ -n $pid ]] && kill $pid 2>/dev/null; done
  WPID=''; CPID=''; LPID=''
}
die() {
  say "FATAL: $*"
  [[ -n $CSV ]] && adb -s $SERIAL pull $CSV $OUT.device.csv >/dev/null 2>&1
  adb -s $SERIAL shell am force-stop com.seazn.capture >/dev/null 2>&1 && say "force-stopped the app"
  cleanup
  if [[ -n $UID_CF ]]; then
    ( cd $REPO && node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 ) | grep -E "^deleted|rror" | while read -r line; do say "cleanup: $line"; done
  fi
  exit 1
}
trap cleanup EXIT INT TERM
mark() { adb -s $SERIAL shell "echo $1 > $FILES/p5-mark"; say "mark $1" }
alive() { [[ -n $(adb -s $SERIAL shell pidof com.seazn.capture | tr -d '\r') ]] }
pull() { adb -s $SERIAL pull $CSV $OUT.device.csv >/dev/null 2>&1 || say "WARN: csv pull failed" }
# Battery floor: on the laptop's 4.5 W USB port the phone drains under this load (2026-09-28: 0.35 %/min at full
# brightness), so a soak that would flatten it ends early and cleanly instead, and the CSV says why.
BATT_FLOOR=${BATT_FLOOR:-12}
END_NOW=''
battery() { adb -s $SERIAL shell dumpsys battery | tr -d '\r' | awk '/^  level:/{print $2; exit}' }
at() {
  [[ -n $END_NOW ]] && return 1
  (( $1 > 0 )) || return 1
  local last=0 lvl
  while (( $(now_ms) < T0 + $1 * 1000 )); do
    if (( $(now_ms) - last > 60000 )); then
      last=$(now_ms); lvl=$(battery)
      if [[ -n $lvl ]] && (( lvl < BATT_FLOOR )); then
        mark battery-floor-stop; say "battery $lvl% < $BATT_FLOOR%: ending the soak early"; END_NOW=yes; return 1
      fi
    fi
    sleep 5
  done
  alive || die "app process gone before step at +$1 s"
  return 0
}
# While publishing, uiautomator never sees an idle UI (1 Hz HUD, live overlay), so tap-visible cannot run then
# (smoke run 2026-09-28 23:56Z: "no fresh uiautomator dump", three minutes per tap). Everything tapped while
# live is resolved before the publish, with the control list scrolled to its top, and tapped by coordinates
# after the same scroll. The peek's own `peek-*` marks in the CSV prove each tap landed.
typeset -A XY
scroll_top() { repeat 2 { adb -s $SERIAL shell input swipe $LIST_X $(( LIST_T + 20 )) $LIST_X $(( LIST_B - 10 )) 300; sleep 0.6 } }
resolve() {   # resolve <key> <pattern>
  local out xy
  for attempt in 1 2 3; do
    out=$(node $HERE/tap-visible.mjs "$2" $SERIAL 60 --dry 2>>$OUT.log)
    xy=$(print -r -- "$out" | awk '/^DRY:/{for (i = 1; i <= NF; i++) if ($i == "at") print $(i + 1)}')
    [[ $xy == *,* ]] && { XY[$1]=$xy; return 0 }
    sleep 2
  done
  return 1
}
tap() { scroll_top; adb -s $SERIAL shell input tap ${XY[$1]%,*} ${XY[$1]#*,}; say "tapped $1 at ${XY[$1]}" }
events_since() { awk -F, -v t=$1 -v k="$2" 'NR > 1 && $1 >= t && $2 ~ ("^(" k ")$") {print}' $OUT.device.csv | cut -c1-200 }
outage() {
  local label=$1 secs=$2 watch=$3 cut back pub
  mark "$label-off"
  cut=$(now_ms)
  NET_OFF=yes
  adb -s $SERIAL shell svc wifi disable; adb -s $SERIAL shell svc data disable
  say "$label: Wi-Fi and mobile data OFF for $secs s"
  sleep $secs
  net_on
  back=$(now_ms)
  mark "$label-on"
  sleep $watch
  alive || die "$label: the app process is gone"
  pull
  events_since $cut 'dropped|publishing|fell-back|video-stalled|video-recovery|video-recovered|uncaught-swallowed' | while read -r line; do say "  $line"; done
  pub=$(awk -F, -v t=$back 'NR > 1 && $1 >= t && $2 == "publishing" {print $1; exit}' $OUT.device.csv)
  [[ -n $pub ]] && say "$label: publishing again $(( (pub - back) / 1000 )).$(( (pub - back) % 1000 / 100 )) s after the network came back" \
    || say "$label: NOT publishing again within $watch s of the network coming back"
}
# Criterion 8: 20 s of what viewers get, not what the phone sent. perl's alarm bounds a playlist that hangs.
audio() {
  local n=$1
  perl -e 'alarm 90; exec @ARGV' ffmpeg -hide_banner -nostats -i "$PLAYBACK" -t 20 -vn -af volumedetect -f null - > $OUT.audio-$n.txt 2>&1
  say "audio $n: $(grep -hE 'mean_volume|max_volume' $OUT.audio-$n.txt | sed 's/.*\] //' | tr '\n' ' ')"
}

mkdir -p $REPO/.p5
: > $OUT.log
say "final soak run=$RUN peek=$PEEK1_S/$PEEK2_S/$PEEKOFF_S cuts=$CUT_SHORT_S/$CUT_LONG_S audio=($AUDIO_S) lock=$LOCK_S-$LOCK_END_S end=$END_S"
adb -s $SERIAL logcat -v threadtime > $OUT.logcat.txt 2>&1 &
LPID=$!
adb devices | grep -q "^$SERIAL" || die "phone not attached"
adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP
adb -s $SERIAL shell wm dismiss-keyguard >/dev/null 2>&1
sleep 1
adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -qiE "(mKeyguardShowing|isKeyguardShowing)=true" && die "phone is locked; unlock it and run again"
net_on; sleep 3
adb -s $SERIAL shell dumpsys connectivity | tr -d '\r' | grep -qE "ni\{WIFI CONNECTED" || die "phone is not on Wi-Fi"
adb -s $SERIAL shell rm -f $FILES/p5-simulate-video-stall $FILES/p5-f10-mode $FILES/p5-no-wakelock

cd $REPO || die "repo missing"
created=$(node --env-file=.env.local scripts/p5/cf.ts create $RUN 2>/dev/null) || die "cf.ts create failed"
UID_CF=$(print -r -- "$created" | awk '/^uid/{print $2}')
PLAYBACK=$(print -r -- "$created" | awk '/^playback/{print $2}')
[[ -n $UID_CF && -n $PLAYBACK ]] || die "could not read uid or playback"
say "input uid=$UID_CF"
adb -s $SERIAL push $OUT.session.json $FILES/p5-session.json >/dev/null 2>&1 || die "session push failed"
adb -s $SERIAL shell am force-stop com.seazn.capture
adb -s $SERIAL shell monkey -p com.seazn.capture -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 10
CSV=$(adb -s $SERIAL shell "ls -t $FILES/p5-*.csv | head -1" | tr -d '\r')
adb -s $SERIAL shell "grep -q ',armed,' $CSV" || die "app did not arm ($CSV)"
say "armed; csv $CSV"
list=$(adb -s $SERIAL shell uiautomator dump /sdcard/soak-ui.xml >/dev/null 2>&1; adb -s $SERIAL shell cat /sdcard/soak-ui.xml | tr '>' '\n' | grep -m1 'scrollable="true"' | grep -oE 'bounds="[^"]+"' | tr -c '0-9\n' ' ')
read -r l t r b <<< "$list"
[[ -n ${b:-} ]] || die "could not find the control list"
LIST_X=$(( (l + r) / 2 )); LIST_T=$t; LIST_B=$b
scroll_top
resolve default "^Peek default UA$" || die "could not resolve Peek default UA"
resolve browser "^Peek browser UA$" || die "could not resolve Peek browser UA"
resolve off "^Peek off$" || die "could not resolve Peek off"
say "list x=$LIST_X y=$LIST_T..$LIST_B; peeks at default=${XY[default]} browser=${XY[browser]} off=${XY[off]}"

node scripts/p5/hls-watch.ts "$PLAYBACK" 2000 > $OUT.hls.csv 2> $OUT.hls.err &
WPID=$!
node --env-file=.env.local $HERE/cf-status-watch.mjs $UID_CF 2000 > $OUT.cfstatus.csv 2> $OUT.cfstatus.err &
CPID=$!

started=''
for attempt in 1 2 3; do
  node $HERE/tap-visible.mjs "^Start SRT$" $SERIAL >> $OUT.log 2>&1 || { sleep 2; continue; }
  for i in {1..10}; do adb -s $SERIAL shell "grep -q ',connecting,' $CSV" && { started=yes; break }; sleep 1; done
  [[ -n $started ]] && break
done
[[ -n $started ]] || die "Start SRT never produced a connecting event"
for i in {1..60}; do adb -s $SERIAL shell "grep -q ',publishing,' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',publishing,' $CSV" || die "never publishing"
T0=$(now_ms)
mark soak-publishing
say "publishing ($(adb -s $SERIAL shell "grep -m1 ',publishing,' $CSV" | tr -d '\r' | cut -d, -f14)); ends at +$END_S s"

at $PROBE_S && { node $HERE/peek-probe.mjs "$PLAYBACK" > $OUT.probe.txt 2>&1; say "probe: $(tr '\n' ';' < $OUT.probe.txt | cut -c1-900)"; }
at $PEEK1_S && { mark peek-default; tap default; }
at $PEEK2_S && { mark peek-browser; tap browser; }
at $CUT_SHORT_S && outage cut-short 20 60
# No screenshots: the frame is the camera's view of wherever the phone stands. The peek marks carry the evidence.
at $PEEKOFF_S && { mark peek-off; tap off; }
audio_n=0
for a in ${=AUDIO_S}; do
  if (( CUT_LONG_S > 0 && a > CUT_LONG_S )) && [[ -z ${long_done:-} ]]; then
    at $CUT_LONG_S && outage cut-long 200 90; long_done=yes
  fi
  audio_n=$(( audio_n + 1 ))
  at $a && audio $audio_n
done
[[ -z ${long_done:-} ]] && at $CUT_LONG_S && outage cut-long 200 90

if at $LOCK_S; then
  mark lock-unplug-simulated
  UNPLUGGED=yes
  adb -s $SERIAL shell dumpsys battery unplug
  adb -s $SERIAL shell input keyevent KEYCODE_SLEEP
  sleep 5
  say "locked: $(adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -m1 -oiE '(mKeyguardShowing|isKeyguardShowing)=[a-z]+'); screen $(adb -s $SERIAL shell dumpsys power | tr -d '\r' | grep -m1 -oE 'mWakefulness=[A-Za-z]+')"
  at $LOCK_END_S
  adb -s $SERIAL shell dumpsys battery reset; UNPLUGGED=''
  mark lock-end-battery-reset
fi

at $END_S || true
mark soak-stop-force
pull
if adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -qiE "(mKeyguardShowing|isKeyguardShowing)=true"; then
  say "stop: phone locked (secure keyguard), so force-stop instead of Hold to stop"
else
  say "stop: phone unlocked, force-stop all the same so every soak ends the same way"
fi
adb -s $SERIAL shell am force-stop com.seazn.capture
sleep 60
kill $WPID $CPID 2>/dev/null; WPID=''; CPID=''

node scripts/p5/telemetry-report.ts $OUT.device.csv > $OUT.report.json 2> $OUT.report.err && say "telemetry report: $OUT.report.json"
say "playlist verdicts: $(awk -F, 'NR > 1 {print $7}' $OUT.hls.csv | sort | uniq -c | tr '\n' ';')"
say "playlist ENDLIST rows: $(awk -F, 'NR > 1 && $6 == "true"' $OUT.hls.csv | wc -l | tr -d ' ')"
say "cloudflare status changes: $(awk -F, 'NR > 1 && $3 != p {print $1 " " $3; p = $3}' $OUT.cfstatus.csv | tr '\n' ';')"
say "logcat FATAL EXCEPTION lines: $(grep -c 'FATAL EXCEPTION' $OUT.logcat.txt); guard lines: $(grep -c 'P5KtorGuard' $OUT.logcat.txt)"
say "waiting for recordings to finalise before cleanup"
for i in {1..60}; do
  vids=$(node --env-file=.env.local scripts/p5/cf.ts videos $UID_CF 2>/dev/null)
  total=$(print -r -- "$vids" | awk '/^count/{print $2}'); ready=$(print -r -- "$vids" | grep -c ' ready ')
  [[ -n $total && $total -gt 0 && $ready -eq $total ]] && break
  sleep 15
done
say "recordings (criteria 4 and 5 want 2: one across the 20 s outage, a second after the 200 s one): $(print -r -- "$vids" | tr '\n' ';')"
node --env-file=.env.local scripts/p5/cf.ts cleanup $UID_CF 2>&1 | grep -E "^deleted|rror" | while read -r line; do say "cleanup: $line"; done
UID_CF=''
say "DONE run=$RUN"
