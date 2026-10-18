#!/bin/sh
# BestRunning · hoja de contactos de un clip para revisarlo: N fotogramas repartidos (o en los instantes dados).
#   sh tools/capture/sheet.sh clip.mp4 salida.jpg [n=6] [ancho=300]
set -e
IN="$1"; OUT="$2"; N="${3:-6}"; W="${4:-300}"
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
FR=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$IN")
STEP=$(( FR / N )); [ "$STEP" -lt 1 ] && STEP=1
COLS=$N; [ "$N" -gt 6 ] && COLS=6
ROWS=$(( (N + COLS - 1) / COLS ))
ffmpeg -v error -y -i "$IN" -vf "select='not(mod(n+$(( STEP / 2 )),$STEP))',scale=$W:-2,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${COLS}x${ROWS}:padding=4" -frames:v 1 -fps_mode vfr "$OUT"
echo "$OUT ($D s, $FR fotogramas)"
