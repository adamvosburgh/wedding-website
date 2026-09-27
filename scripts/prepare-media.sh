#!/usr/bin/env bash
# Turns the original videos in originals/videos/ into the web versions in
# site/media/videos/. Run once (or again whenever an original changes) and
# commit the output; the Pages build only copies files, it never runs ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."

out=site/media
mkdir -p "$out/videos"

# Portrait phone videos: 720p at crf 32 (street signs stay readable), faststart
# so they play before fully loading, plus a poster frame for the player.
for src in originals/videos/*.mp4; do
  name=$(basename "$src" .mp4)
  ffmpeg -y -loglevel error -i "$src" \
    -vf "scale=720:-2" -c:v libx264 -preset slow -crf 32 -profile:v high -pix_fmt yuv420p \
    -c:a aac -b:a 96k -movflags +faststart "$out/videos/$name.mp4"
  ffmpeg -y -loglevel error -ss 1 -i "$src" -frames:v 1 -vf "scale=720:-2" -q:v 4 "$out/videos/$name.jpg"
done

ls -lh "$out" "$out/videos"
