#!/bin/sh
# Joins video/NN-*.mp4 into video/aeroguard-api3-full.mp4: constant 30 fps (CFR, GOP 30), a 0.15 s fade out/in at every cut
# (0.3 s through the dark), 0.5 s held first frame before the title, faststart. No audio. Prints the clip timings.
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d); i=0; start=0
printf '| # | Clip | Start (s) | Length (s) |\n|---|---|---|---|\n' > /tmp/api3-timings.md
for f in [0-9][0-9]-*.mp4; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  vf="fps=30,scale=1920:1080,format=yuv420p"
  if [ $i -eq 0 ]; then vf="$vf,tpad=start_duration=0.5:start_mode=clone"; d=$(echo "$d + 0.5" | bc); fi
  [ $i -gt 0 ] && vf="$vf,fade=t=in:st=0:d=0.15"
  vf="$vf,fade=t=out:st=$(echo "$d - 0.15" | bc):d=0.15"
  ffmpeg -loglevel error -y -i "$f" -an -vf "$vf" -r 30 -vsync cfr -c:v libx264 -crf 18 -g 30 -pix_fmt yuv420p "$T/$(printf %02d $i).mp4"
  printf '| %s | %s | %.2f | %.2f |\n' "$((i+1))" "$f" "$start" "$d" >> /tmp/api3-timings.md
  start=$(echo "$start + $d" | bc); i=$((i+1))
done
ls "$T"/*.mp4 | sed "s/^/file '/; s/$/'/" > "$T/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$T/list.txt" -c copy -movflags +faststart aeroguard-api3-full.mp4
rm -rf "$T"
cat /tmp/api3-timings.md
echo "total $(ffprobe -v error -show_entries format=duration -of csv=p=0 aeroguard-api3-full.mp4) s"
