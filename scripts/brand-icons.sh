#!/usr/bin/env bash
# Regenerates the PNG, ICO and logo.webp icons from the brand SVGs. Run after editing an SVG in
# src/webpage/public/brand/ (production: Machloket) or brand/dev/ (dev server: Machlakot),
# then commit the outputs. Needs rsvg-convert (host) and ImageMagick (the `tools` distrobox).
set -euo pipefail

brand="$(cd "$(dirname "$0")/.." && pwd)/src/webpage/public/brand"
work="$(mktemp -d "${CLAUDE_JOB_DIR:-$HOME/.cache}/brand-icons.XXXXXX")"
trap 'rm -r -- "$work"' EXIT

render() { rsvg-convert --width "$2" --height "$2" --output "$3" "$1"; }

# $1 = variant folder, $2 = where its favicon.ico goes, $3 = where its logo.webp goes
build() {
	local dir="$1" ico="$2" webp="$3"
	for size in 192 512; do
		render "$dir/icon.svg" "$size" "$dir/icon-$size.png"
		render "$dir/icon-maskable.svg" "$size" "$dir/icon-maskable-$size.png"
	done
	for size in 16 32 48; do
		render "$dir/icon.svg" "$size" "$work/favicon-$size.png"
	done
	distrobox enter tools -- magick "$work/favicon-16.png" "$work/favicon-32.png" \
		"$work/favicon-48.png" "$ico"
	distrobox enter tools -- magick "$dir/icon-512.png" -define webp:lossless=true "$webp"
}

build "$brand" "$brand/../favicon.ico" "$brand/../logo.webp"
build "$brand/dev" "$brand/dev/favicon.ico" "$brand/dev/logo.webp"
echo "Icons written under $brand"
