#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/store-assets"

if ! command -v sips >/dev/null 2>&1; then
  echo "Error: 'sips' is required on macOS to validate image sizes."
  exit 1
fi

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "Error: store-assets directory not found at: $ASSETS_DIR"
  exit 1
fi

get_dim() {
  local file="$1"
  local key="$2"
  sips -g "$key" "$file" 2>/dev/null | awk -F': ' "NR==2 {print \$2}"
}

require_exact_size() {
  local file="$1"
  local expected_w="$2"
  local expected_h="$3"

  if [[ ! -f "$file" ]]; then
    echo "✗ Missing file: $file"
    return 1
  fi

  local w h
  w="$(get_dim "$file" pixelWidth)"
  h="$(get_dim "$file" pixelHeight)"
  if [[ "$w" != "$expected_w" || "$h" != "$expected_h" ]]; then
    echo "✗ $file has ${w}x${h}, expected ${expected_w}x${expected_h}"
    return 1
  fi
  echo "✓ $file ${w}x${h}"
}

require_min_size() {
  local file="$1"
  local min_w="$2"
  local min_h="$3"

  if [[ ! -f "$file" ]]; then
    echo "✗ Missing file: $file"
    return 1
  fi

  local w h
  w="$(get_dim "$file" pixelWidth)"
  h="$(get_dim "$file" pixelHeight)"
  if [[ "$w" -lt "$min_w" || "$h" -lt "$min_h" ]]; then
    echo "✗ $file has ${w}x${h}, minimum is ${min_w}x${min_h}"
    return 1
  fi
  echo "✓ $file ${w}x${h} (min ${min_w}x${min_h})"
}

status=0

require_exact_size "$ASSETS_DIR/icon-16.png" 16 16 || status=1
require_exact_size "$ASSETS_DIR/icon-32.png" 32 32 || status=1
require_exact_size "$ASSETS_DIR/icon-48.png" 48 48 || status=1
require_exact_size "$ASSETS_DIR/icon-128.png" 128 128 || status=1
require_exact_size "$ASSETS_DIR/promo-small-440x280.png" 440 280 || status=1
require_exact_size "$ASSETS_DIR/promo-marquee-1400x560.png" 1400 560 || status=1
require_min_size "$ASSETS_DIR/screenshot.png" 1280 800 || status=1

if [[ "$status" -ne 0 ]]; then
  echo
  echo "Store asset validation failed."
  exit 1
fi

echo
echo "Store asset validation passed."
