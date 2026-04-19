# Homestead Overlay Planner

Homestead Overlay Planner is a Chrome Manifest V3 extension that adds an SVG planning overlay on top of Google Maps pages. You can draw homestead layouts (line, rectangle, polygon, and labels), save plans locally, and reload them later while keeping shapes anchored to the same map area during pan/zoom.

## What It Does

- Injects a transparent SVG overlay into Google Maps tabs on demand.
- Draws and stores geometry in canonical Web Mercator global pixels at zoom 24.
- Tracks map center/zoom from Google Maps URLs and reprojects shapes as URL state changes.
- Saves plans in `chrome.storage.local` only (no backend).
- Supports JSON export and JSON import for plans.

## Load Unpacked In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `homestead-overlay-planner`.
5. Open a Google Maps page and click the extension icon.

## Popup Workflow

1. Open Google Maps and navigate to your property.
2. Click the extension icon.
3. Click **Start Planning**.
4. Enter a plan name when prompted. A new plan is created immediately and saved (even if empty).
5. Use **Load** on any saved plan to jump to the saved map view and load shapes in one flow.
6. In **Saved Plans**, you can:
   - Click **Load**
   - Click **Export JSON**
   - Click **Delete**
   - Double-click the plan name to rename it inline
7. Use **Import JSON** to restore a plan from an exported `.json` file.

## In-Map Toolbar

- `Select`
- `Pan Mode`
- `Connection`
- `Line`
- `Rectangle`
- `Polygon`
- `Label`
- `Lengths: On/Off`
- `Areas: On/Off`
- `Show/Unshow Length`
- `Undo`
- `Redo`
- `Delete Selected`
- `Save`
- `Exit`

`Pan Mode` is the default tool when the overlay starts or when a plan is loaded.

## Shape Navigator

- A collapsible **Shapes** panel appears in-map (top-left) while planning is active.
- Each saved shape/line/label appears with a **Find** button.
- **Find** saves the current plan, navigates Google Maps to that shape's location, and reloads the plan with that shape selected.

## Editing and Interaction

- `Select` mode:
  - Drag line/rectangle/polygon/label to move.
  - Drag selected shape/group to reposition.
  - Press `Delete`/`Backspace` to delete selected shape (and keep using **Delete Selected** button if preferred).
  - Double-click line/rectangle/polygon to toggle vertex edit handles.
  - Drag vertex handles to reshape line endpoints / polygon / rectangle geometry.
  - Selected line/rectangle/polygon shows a rotate handle (`R`) that supports click-hold-drag fluid rotation.
  - Double-click length badge on a side to set exact side length (meters).
  - Double-click polygon/rectangle side to select that side for side-delete operations.
- Labels:
  - Prompted for text after creation.
  - Double-click label or press `Enter` while selected to edit text.
  - Drag label bubble to reposition text box.
  - Drag label resize handle to resize bubble width/height.
- Polygon drawing:
  - Click to add vertices.
  - Double-click to finish.

## Measurements

- Line: length badge.
- Rectangle/Polygon: side lengths (outside shape) and area (inside shape).
- Closed loops formed by connected line segments also show derived area.
- Length and area visibility controls:
  - Global lengths on/off
  - Global areas on/off
  - Per-side length visibility via `Show/Unshow Length` mode

## Key Bindings

- Popup includes a **Key Bindings** section with **Customize** panel.
- You can remap:
  - `Select`
  - `Pan Mode`
  - `Connection`
  - `Line`
  - `Rectangle`
  - `Polygon`
  - `Label`
  - `Undo`
  - `Redo`
  - `Length Toggle`
  - `Show/Unshow Length`
  - `Save`
  - `Exit`

## Known Limitations

- URL parsing depends on Google Maps URL patterns containing `@lat,lng,zoom` values (supports `z` and meter-based `m` zoom units). Unsupported URL states show a non-blocking message.
- Overlay alignment uses a viewport heuristic (largest visible map canvas). Major Google Maps UI/layout changes can cause minor visual offsets.
- Measurements are approximate and intended for planning, not legal/survey/engineering use.

## Accuracy Disclaimer

This extension is for approximate visual planning only. Drawings are not survey-grade measurements and should not be used as legal, engineering, or cadastral boundaries.
