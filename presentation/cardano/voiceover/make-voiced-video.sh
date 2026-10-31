#!/bin/sh
# Builds ../aeroguard-cardano-full-voiced.mp4: the Cardano video with an English voice-over placed on its timecodes.
#
#   ELEVENLABS_API_KEY=sk_... sh make-voiced-video.sh          # ElevenLabs (best); VOICE_ID picks the voice
#   sh make-voiced-video.sh                                    # no key: macOS `say` (VOICE=Samantha, Daniel, …)
#   sh make-voiced-video.sh my-recording.m4a                   # your own recording (one file, 2:20, over the video)
#
# Needs ffmpeg (Mac: brew install ffmpeg). Lines and timecodes: lines.tsv (start, end, text) — same text as VIDEO-SCRIPT.md.
# The key is read from the environment only; it is never written anywhere.
set -e
cd "$(dirname "$0")"
VIDEO=${VIDEO:-../../../cardano/video/aeroguard-cardano-full.mp4}  # the silent full cut; lines.tsv follows its timings
OUT=../aeroguard-cardano-full-voiced.mp4
VOICE=${VOICE:-Samantha}
RATE=${RATE:-175}
VOICE_ID=${VOICE_ID:-JBFqnCBsd6RMkjVDRZzb}
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: brew install ffmpeg"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")

if [ -n "$1" ]; then
  # Your own recording, laid under the video as it is.
  ffmpeg -nostdin -loglevel error -y -i "$VIDEO" -i "$1" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
  echo "done: $OUT"; exit 0
fi

# Speak one line into $1 (wav). Every command reads /dev/null: the loop below reads lines.tsv on stdin.
speak() {
  if [ -n "$SAY_CMD" ]; then "$SAY_CMD" "$1" "$2" </dev/null
  elif [ -n "$ELEVENLABS_API_KEY" ]; then
    body=$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read(), "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}))')
    code=$(curl -sS -o "$1.mp3" -w '%{http_code}' -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID?output_format=mp3_44100_128" \
      -H "xi-api-key: $ELEVENLABS_API_KEY" -H 'Content-Type: application/json' -d "$body" </dev/null)
    [ "$code" = 200 ] || { echo "ElevenLabs answered HTTP $code: $(head -c 300 "$1.mp3")"; exit 1; }
    ffmpeg -nostdin -loglevel error -y -i "$1.mp3" "$1"
  else
    say -v "$VOICE" -r "$RATE" -o "$1.aiff" "$2" </dev/null
    ffmpeg -nostdin -loglevel error -y -i "$1.aiff" "$1"
  fi
}

# Each line: spoken, sped up (at most ×1.35) if it would overrun its slot, then delayed to its start time.
i=0; inputs=""; filters=""; labels=""
while IFS="$(printf '\t')" read -r start end text; do
  [ -z "$text" ] && continue
  speak "$TMP/l$i.wav" "$text"
  len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/l$i.wav")
  slot=$(echo "$end - $start - 0.4" | bc -l)
  tempo=$(echo "t = $len / $slot; if (t < 1) t = 1; if (t > 1.35) t = 1.35; t" | bc -l)
  [ "$(echo "$len / $tempo > $slot + 0.05" | bc -l)" = 1 ] && echo "warning: line $((i+1)) is $(printf %.1f "$len")s for a $(printf %.1f "$slot")s slot and will overlap the next one; shorten it in lines.tsv"
  ms=$(echo "($start + 0.2) * 1000 / 1" | bc)
  inputs="$inputs -i $TMP/l$i.wav"
  filters="$filters[$i:a]atempo=$tempo,adelay=${ms}|${ms}[a$i];"
  labels="$labels[a$i]"
  i=$((i+1))
done < lines.tsv

# 1) one voice track as long as the video, 2) video + voice.
ffmpeg -nostdin -loglevel error -y $inputs \
  -filter_complex "${filters}${labels}amix=inputs=$i:duration=longest:normalize=0,volume=1.6,apad=whole_dur=$DUR[voice]" \
  -map "[voice]" -ar 44100 "$TMP/voice.wav"
ffmpeg -nostdin -loglevel error -y -i "$VIDEO" -i "$TMP/voice.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
if [ -n "$ELEVENLABS_API_KEY" ]; then src="ElevenLabs voice $VOICE_ID"; else src="macOS voice $VOICE"; fi
echo "done: $OUT  ($i lines, $src)"
