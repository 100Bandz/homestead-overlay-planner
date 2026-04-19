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

get_prop() {
  local file="$1"
  local key="$2"
  sips -g "$key" "$file" 2>/dev/null | awk -F': ' "NR==2 {print tolower(\$2)}"
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

require_screenshot_size() {
  local file="$1"

  if [[ ! -f "$file" ]]; then
    echo "✗ Missing file: $file"
    return 1
  fi

  local w h fmt alpha
  w="$(get_dim "$file" pixelWidth)"
  h="$(get_dim "$file" pixelHeight)"
  fmt="$(get_prop "$file" format)"
  alpha="$(get_prop "$file" hasAlpha)"

  if ! { [[ "$w" == "1280" && "$h" == "800" ]] || [[ "$w" == "640" && "$h" == "400" ]]; }; then
    echo "✗ $file has ${w}x${h}, expected exactly 1280x800 or 640x400"
    return 1
  fi

  if [[ "$fmt" != "png" && "$fmt" != "jpeg" ]]; then
    echo "✗ $file has format '$fmt', expected PNG or JPEG"
    return 1
  fi

  if [[ "$fmt" == "png" && "$alpha" != "no" ]]; then
    echo "✗ $file is PNG with alpha channel, screenshots must not include alpha"
    return 1
  fi

  echo "✓ $file ${w}x${h}, format=${fmt}, alpha=${alpha}"
}

status=0

require_exact_size "$ASSETS_DIR/icon-16.png" 16 16 || status=1
require_exact_size "$ASSETS_DIR/icon-32.png" 32 32 || status=1
require_exact_size "$ASSETS_DIR/icon-48.png" 48 48 || status=1
require_exact_size "$ASSETS_DIR/icon-128.png" 128 128 || status=1
require_exact_size "$ASSETS_DIR/promo-small-440x280.png" 440 280 || status=1
require_exact_size "$ASSETS_DIR/promo-marquee-1400x560.png" 1400 560 || status=1
require_screenshot_size "$ASSETS_DIR/screenshot.png" || status=1

if [[ "$status" -ne 0 ]]; then
  echo
  echo "Store asset validation failed."
  exit 1
fi

echo
echo "Store asset validation passed."
