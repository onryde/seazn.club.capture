#!/bin/zsh
# What does the phone's encoder emit when the app goes to the background and comes back?
#
#   capture-background.sh [awaySeconds]
#
# Twice on 2026-09-14 Cloudflare stopped packaging a stream while SRT delivered it cleanly (Soak A 19:12:56Z;
# the auto-rotate run at the app's return from HOME, 22:17:29Z). Hypothesis: the return makes the encoder emit
# something the live packager rejects — a new SPS/PPS, a resolution or orientation change, or a timestamp jump.
#
# This reads the phone's raw output with no Cloudflare and no mobile data: the app publishes RTMP to an ffmpeg
# listener on this laptop through adb reverse (-c copy, so nothing re-encodes), HOME is pressed mid-capture,
# the app is brought back, and the capture is inspected for:
#   - resolution / profile / level changes across the stream (ffprobe frames)
#   - SPS/PPS NAL units after the first keyframe (h264_metadata / trace_headers)
#   - PTS/DTS jumps or backwards steps in video and audio
#   - keyframe spacing around the return
set -u

AWAY_S=${1:-5}
# STALL=1: no HOME; the stall hook forces a video-stall recovery instead, and the listener accepts reconnects so
# a recovery that never dials again shows as no `connecting`, not as a refused reconnect (14 Sep: RTMPS only).
STALL=${STALL:-0}
SERIAL=12be753e
HERE=${0:a:h}
REPO=${HERE:h:h:h}   # scripts/p5/device -> repo root
FILES=/sdcard/Android/data/com.seazn.capture/files
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=$REPO/.p5/p5-capbg-$STAMP
mkdir -p $REPO/.p5
LPID=''
LOGPID=''

now_ms() { node -e 'process.stdout.write(String(Date.now()))' }
say() { print -r -- "$(now_ms) $(date -u +%H:%M:%SZ) $*" | tee -a $OUT.log }
cleanup() {
  [[ -n $LPID ]] && kill $LPID 2>/dev/null
  pkill -f 'rtmp://127.0.0.1:1935/live/capbg' 2>/dev/null
  [[ -n $LOGPID ]] && kill $LOGPID 2>/dev/null
  LPID=''; LOGPID=''
  adb -s $SERIAL reverse --remove tcp:1935 >/dev/null 2>&1
}
die() {
  say "FATAL: $*"
  adb -s $SERIAL shell am force-stop com.seazn.capture >/dev/null 2>&1
  cleanup
  exit 1
}
trap 'cleanup; exit 1' INT TERM
trap cleanup EXIT
focused() { adb -s $SERIAL shell dumpsys window | tr -d '\r' | grep -m1 -E "mCurrentFocus=" | grep -q "com.seazn.capture/" }

: > $OUT.log
adb devices | grep -q "^$SERIAL" || die "phone not attached"
say "background capture, away ${AWAY_S}s, out $OUT"
adb -s $SERIAL logcat -v threadtime > $OUT.logcat.txt 2>&1 &
LOGPID=$!

# The session parser needs an SRT block even though only RTMP is used; its target is never dialled.
cat > $OUT.session.json <<'JSON'
{"srt":{"url":"srt://127.0.0.1:9000","streamId":"unused","latencyMs":2000},
 "rtmps":{"url":"rtmp://127.0.0.1:1935/live","streamKey":"capbg"},
 "overlayUrl":"about:blank",
 "playbackUrl":"about:blank"}
JSON

# Stop any app still publishing before the listener opens. On 2026-09-28 an app left retrying by a killed
# driver reached the new single-shot listener first, died mid-handshake at the force-stop below, and ffmpeg
# exited ("Input/output error"), so the fresh app had no one to publish to.
adb -s $SERIAL shell am force-stop com.seazn.capture
adb -s $SERIAL reverse tcp:1935 tcp:1935 >/dev/null || die "adb reverse failed"
# Null sink: on 2026-09-28 ffmpeg 9.0.1 still never saw the video config record ("No start code is found",
# "Could not write header") even with probe room, so it cannot write a file. A null sink still holds the
# connection open, and its per-second stats show when video packets stop arriving.
# Probe room: at 22:31Z ffmpeg rejected the first packets ("unspecified size", could not write header), exited,
# and turned the whole run into reconnect failures.
if [[ $STALL == 1 ]]; then
  ( while true; do ffmpeg -hide_banner -v warning -listen 1 -timeout 90 -i rtmp://127.0.0.1:1935/live/capbg -c copy -stats -stats_period 1 -f null -; print "listener ended $(date -u +%H:%M:%SZ)"; done ) > $OUT.ffmpeg.log 2>&1 &
else
  ffmpeg -hide_banner -v warning -analyzeduration 10000000 -probesize 20000000 -listen 1 -timeout 90 -i rtmp://127.0.0.1:1935/live/capbg -c copy -t 70 -stats -stats_period 1 -f null - > $OUT.ffmpeg.log 2>&1 &
fi
LPID=$!
sleep 2

adb -s $SERIAL push $OUT.session.json $FILES/p5-session.json >/dev/null 2>&1 || die "session push failed"
[[ $STALL == 1 ]] && { adb -s $SERIAL shell "touch $FILES/p5-simulate-video-stall" || die "hook push failed"; say "stall hook placed"; }
adb -s $SERIAL shell am force-stop com.seazn.capture
adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP
adb -s $SERIAL shell monkey -p com.seazn.capture -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 10
CSV=$(adb -s $SERIAL shell "ls -t $FILES/p5-*.csv | head -1" | tr -d '\r')
adb -s $SERIAL shell "grep -q ',armed,' $CSV" || die "app did not arm ($CSV)"
say "armed; csv $CSV"

node $HERE/tap-visible.mjs "^Start RTMPS$" $SERIAL >> $OUT.log 2>&1 || die "could not tap Start RTMPS"
for i in {1..15}; do adb -s $SERIAL shell "grep -q ',publishing,' $CSV" && break; sleep 1; done
adb -s $SERIAL shell "grep -q ',publishing,' $CSV" || die "never published to the local listener"
PUB_MS=$(now_ms)
say "publishing to the local listener; 25 s before HOME"
sleep 25

if [[ $STALL != 1 ]]; then
HOME_MS=$(now_ms)
adb -s $SERIAL shell input keyevent KEYCODE_HOME
sleep 0.5
focused && say "WARN: app still in front after HOME" || say "app in background"
sleep $AWAY_S
adb -s $SERIAL shell am start -n com.seazn.capture/.MainActivity >/dev/null 2>&1
BACK_MS=$(now_ms)
sleep 2
focused && say "app back in front" || say "WARN: app not in front"
say "HOME at +$(( (HOME_MS - PUB_MS) / 1000 )) s of publishing, back at +$(( (BACK_MS - PUB_MS) / 1000 )) s"
fi

# While the capture runs: if a stall recovery starts and no connecting follows within 8 s, capture the proof a
# log cannot give (OPLUS log flow control dropped the app's logs mid-loop on 2026-09-14): a Java thread dump and
# per-thread CPU, twice, 5 s apart, so a busy loop shows as the same hot thread in both.
PID=$(adb -s $SERIAL shell pidof com.seazn.capture | tr -d '\r' | awk '{print $1}')
dumped=''
for i in {1..80}; do
  rec=$(adb -s $SERIAL shell "awk -F, '\$2==\"video-recovery\" {print \$1; exit}' $CSV" | tr -d '\r')
  if [[ -n $rec && -z $dumped ]]; then
    conn=$(adb -s $SERIAL shell "awk -F, -v t=$rec '\$2==\"connecting\" && \$1>=t' $CSV | wc -l" | tr -d ' \r')
    if [[ ${conn:-0} -eq 0 && $(( $(now_ms) - rec )) -gt 8000 ]]; then
      say "recovery at $rec has no connecting after 8 s: thread dump + per-thread CPU of pid $PID"
      for n in 1 2; do
        adb -s $SERIAL shell top -H -b -n 1 -p $PID > $OUT.top-$n.txt 2>&1
        adb -s $SERIAL shell debuggerd -j $PID > $OUT.threads-$n.txt 2>&1
        say "  sample $n: top $(wc -l < $OUT.top-$n.txt | tr -d ' ') lines, threads $(wc -l < $OUT.threads-$n.txt | tr -d ' ') lines"
        [[ $n == 1 ]] && sleep 5
      done
      dumped=yes
    fi
  fi
  # Watch the full window whatever the listener does: a stall drops the RTMP connection and ends the
  # single-shot listener long before a stuck recovery can be dumped (2026-09-14 22:32Z lost its dump that way).
  [[ -n $dumped ]] && break
  sleep 1
done
adb -s $SERIAL shell am force-stop com.seazn.capture
kill $LPID 2>/dev/null; pkill -f 'rtmp://127.0.0.1:1935/live/capbg' 2>/dev/null; LPID=''
if [[ ! -s $OUT.flv ]]; then
  say "WARN: no capture written (see $OUT.ffmpeg.log); the recovery evidence above still stands"
  say "device events during the capture:"
  adb -s $SERIAL shell "awk -F, -v t=$((PUB_MS - 2000)) '\$1>=t && \$2!=\"sample\"' $CSV" | tr -d '\r' | cut -c1-160 | while read -r line; do say "  $line"; done
  say "DONE (no capture)"
  exit 0
fi
say "captured $(wc -c < $OUT.flv | tr -d ' ') bytes"

# --- What the encoder emitted.
say "stream summary: $(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,level,width,height,has_b_frames -of compact=p=0 $OUT.flv)"
say "distinct frame sizes (width x height : count):"
ffprobe -v error -select_streams v:0 -show_entries frame=width,height -of csv=p=0 $OUT.flv | sort | uniq -c | while read -r line; do say "  $line"; done
say "keyframes (pts_time) and gaps between them:"
ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0 $OUT.flv | awk -F, '$2 ~ /K/ {if (p != "") printf "  key at %8.3f s (gap %6.3f s)\n", $1, $1 - p; else printf "  key at %8.3f s\n", $1; p = $1}' | while read -r line; do say "$line"; done
say "video PTS: backwards steps and gaps > 0.2 s:"
ffprobe -v error -select_streams v:0 -show_entries packet=pts_time -of csv=p=0 $OUT.flv | awk 'NF { if (n) { d = $1 - p; if (d < 0 || d > 0.2) printf "  at %8.3f s: step %+.3f s\n", p, d } p = $1; n++ } END { printf "  %d video packets\n", n }' | while read -r line; do say "$line"; done
say "audio PTS: backwards steps and gaps > 0.1 s:"
ffprobe -v error -select_streams a:0 -show_entries packet=pts_time -of csv=p=0 $OUT.flv | awk 'NF { if (n) { d = $1 - p; if (d < 0 || d > 0.1) printf "  at %8.3f s: step %+.3f s\n", p, d } p = $1; n++ } END { printf "  %d audio packets\n", n }' | while read -r line; do say "$line"; done
say "SPS/PPS occurrences (h264 trace of NAL types 7/8 by packet):"
ffmpeg -hide_banner -v error -i $OUT.flv -map 0:v:0 -c copy -bsf:v trace_headers -f null - 2>&1 | awk '/Packet: / {pkt++} /nal_unit_type/ && ($NF == 7 || $NF == 8) {printf "  packet %d: nal_unit_type %s\n", pkt, $NF}' | uniq | head -40 | while read -r line; do say "$line"; done
say "device events during the capture:"
adb -s $SERIAL shell "awk -F, -v t=$((PUB_MS - 2000)) '\$1>=t && \$2!=\"sample\"' $CSV" | tr -d '\r' | cut -c1-160 | while read -r line; do say "  $line"; done
say "DONE"
