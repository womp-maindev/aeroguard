#!/bin/sh
# Joins the clips in cardano/video/ into one silent full cut: a 0.3 s dip between clips (0.15 s out + 0.15 s in, so every
# clip keeps its length), constant 30 fps, a keyframe every second, faststart. Prints clip → start → length.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
start=0; n=0
printf '%-16s %8s %8s\n' clip start_s length_s
for f in [0-9]*.mp4; do
  case "$f" in aeroguard-*) continue ;; esac
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  out=$(echo "$d - 0.15" | bc -l)
  ffmpeg -nostdin -loglevel error -y -i "$f" -vf "fps=30,fade=t=in:st=0:d=0.15,fade=t=out:st=$out:d=0.15,format=yuv420p" \
    -c:v libx264 -crf 18 -r 30 -an "$TMP/$(printf %02d $n).mp4"
  printf '%-16s %8.2f %8.2f\n' "${f%.mp4}" "$start" "$d"
  echo "file '$TMP/$(printf %02d $n).mp4'" >> "$TMP/list.txt"
  start=$(echo "$start + $d" | bc -l); n=$((n+1))
done
ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$TMP/list.txt" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -r 30 -fps_mode cfr -g 30 \
  -movflags +faststart aeroguard-cardano-full.mp4
printf 'total %.2f s -> cardano/video/aeroguard-cardano-full.mp4\n' "$start"
