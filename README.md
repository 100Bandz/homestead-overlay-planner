# Homestead Overlay Planner

Homestead Overlay Planner is a Chrome Manifest V3 extension that adds an SVG planning overlay on top of Google Maps pages. You can draw homestead layouts (line, rectangle, polygon, and labels), save plans locally, and reload them later while keeping shapes anchored to the same map area during pan/zoom.

## What It Does

- Injects a transparent SVG overlay into Google Maps tabs on demand.
- Provides a floating in-page planner toolbar.
- Draws and stores shape geometry in canonical Web Mercator global pixels at zoom 24.
- Tracks map center/zoom from Google Maps URL (`/maps/@lat,lng,zoomz`) and reprojects shapes as the URL changes.
- Saves plans in `chrome.storage.local`.
- Lists, loads, deletes, and exports plans as JSON from the extension popup.

## Load Unpacked In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `homestead-overlay-planner`.
5. Open a Google Maps page and click the extension icon.

## Usage

1. Open Google Maps and navigate to your property.
2. Click the extension icon.
3. Click **Start Planning**.
4. Use the in-page toolbar:
   - `Select`
   - `Pan Mode`
   - `Line`
   - `Rectangle`
   - `Polygon` (click to add vertices, double-click to finish)
   - `Label`
   - `Lengths: On/Off` (global length visibility)
   - `Areas: On/Off` (global area visibility for polygons/rectangles)
   - `Show/Unshow Length` (click individual edges to toggle their length labels)
   - `Undo`
   - `Redo`
   - `Delete Selected`
   - `Save`
   - `Exit`
6. In `Select` mode:
   - Double-click a `line`, `rectangle`, or `polygon` to show vertex handles for reshaping.
   - Double-click a `label` (or press `Enter` when selected) to edit text.
5. Reopen the popup later to load existing plans.
6. Use **Export JSON** in the popup to export a saved plan.

## Known Limitations

- URL parsing currently supports common Google Maps URL forms that include `/maps/@lat,lng,zoomz`.
- If Google Maps is in a non-standard URL/view mode, the planner shows a non-blocking unsupported-view message.
- Shape editing MVP includes selecting/deleting shapes and dragging labels. Full vertex-level shape editing is not included.
- Rendering alignment is based on browser viewport and URL-driven map center/zoom, so unusual Google Maps UI layouts can introduce minor visual offset.

## Accuracy Disclaimer

This extension is for approximate visual planning only. Drawings are not survey-grade measurements and should not be used as legal, engineering, or cadastral boundaries.
