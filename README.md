# Homestead Overlay Planner

Homestead Overlay Planner is a Chrome Manifest V3 extension that adds an SVG planning overlay on top of Google Maps pages. You can draw homestead layouts (line, rectangle, circle, polygon, and labels), save plans locally, and reload them later while keeping shapes anchored to the same map area during pan/zoom.

## What It Does

- Injects a transparent SVG overlay into Google Maps tabs on demand.
- Draws and stores geometry in canonical Web Mercator global pixels at zoom 24.
- Tracks map center/zoom from Google Maps URLs and reprojects shapes as URL state changes.
- Saves plans in `chrome.storage.local` only (no backend).
- Auto-saves plan edits while planning mode is active (debounced).
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
- `Lasso`
- `Pan Mode`
- `Connection`
- `Line`
- `Rectangle`
- `Circle`
- `Polygon`
- `Label`
- `Lengths: On/Off`
- `Areas: On/Off`
- `Show/Unshow Length`
- `Show/Unshow Area`
- `Copy`
- `Paste`
- `Undo`
- `Redo`
- `Delete Selected`
- `Save`
- `Exit`

`Pan Mode` is the default tool when the overlay starts or when a plan is loaded.

Copy/Paste shortcuts are also available while not typing:
- `Ctrl/Cmd + C` to copy the selected line/rectangle/circle/polygon/label
- `Ctrl/Cmd + V` to paste a cloned shape
- `Ctrl/Cmd + A` to select all shapes for group move
- `Shift + Click` to add/remove shapes from selection

## Shape Navigator

- A collapsible **Shapes** panel appears in-map (top-left) while planning is active.
- The panel is draggable, starts collapsed by default, and its collapsed/position state is restored.
- Each saved shape/line/label appears with a **Find** button.
- **Find** saves the current plan, navigates Google Maps to that shape's location, and reloads the plan with that shape selected.

## Editing and Interaction

- `Lasso` mode:
  - Click-drag to draw a lasso rectangle and select all intersecting shapes/labels.
  - Shift+drag appends to the current selection.
  - Dragging a selected shape in lasso mode moves the selected group together.
  - Press `Delete`/`Backspace` to remove selected items.
- `Select` mode:
  - Drag line/rectangle/circle/polygon/label to move.
  - Drag selected shape/group to reposition.
  - Press `Delete`/`Backspace` to delete selected shape (and keep using **Delete Selected** button if preferred).
  - Double-click line/rectangle/circle/polygon to toggle vertex edit handles.
  - Drag vertex handles to reshape line endpoints / polygon / rectangle geometry, and adjust circle radius.
  - Rectangle corner drag preserves rectangle geometry (uniformly resizes while keeping right angles).
  - Vertex handles use precise hit targets with grab/grabbing cursor feedback.
  - Selected line/rectangle/polygon shows a rotate handle (`R`) that supports click-hold-drag fluid rotation.
  - Double-click length badge on a side to set exact side length (meters).
  - Double-click polygon/rectangle side to select that side for side-delete operations.
- Labels:
  - Prompted for text after creation.
  - After placing a label, tool switches back to `Select` automatically for quick repositioning.
  - Double-click label or press `Enter` while selected to edit text.
  - Drag label bubble to reposition text box.
  - Drag label resize handle to resize bubble width/height.
- Polygon drawing:
  - Click to add vertices.
  - Shows a strict `90°` indicator when the next segment is at a right angle.
  - Hold the configurable right-angle snap key to force the next segment perpendicular to the previous edge.
  - Double-click to finish.

## Measurements

- Line: length badge.
- Circle: diameter badge and area badge.
- Rectangle/Polygon: side lengths (outside shape) and area (inside shape).
- Closed loops formed by connected line segments also show derived area.
- Area badge placement avoids overlap with side-length badges and stays inside polygon interiors (including concave shapes).
- Length and area visibility controls:
  - Global lengths on/off
  - Global areas on/off
  - Per-side length visibility via `Show/Unshow Length` mode
  - Per-shape area visibility via `Show/Unshow Area` mode

## Saving and Reliability

- Manual **Save** is still available and immediate.
- Auto-save runs after edit operations while a plan is loaded (create, move, resize/reshape, rotate, copy/paste, delete, visibility toggles, side-length edits, undo/redo, connection changes).
- Auto-save is debounced (~900ms) to avoid excessive writes.
- Save and auto-save failures show status messages in-map; extension-context invalidation errors are reported with restart guidance.
- Status toasts auto-dismiss with a smooth fade (default ~4 seconds unless overridden).

## Key Bindings

- Popup includes a **Key Bindings** section with **Customize** panel.
- You can remap:
  - `Select`
  - `Lasso`
  - `Pan Mode`
  - `Connection`
  - `Line`
  - `Rectangle`
  - `Circle`
  - `Polygon`
  - `Label`
  - `Undo`
  - `Redo`
  - `Length Toggle`
  - `Show/Unshow Length`
  - `Show/Unshow Area`
  - `Right-Angle Snap (Hold)`
  - `Save`
  - `Exit`
- Default new bindings:
  - `Lasso` = `Q`
  - `Circle` = `O`
  - `Right-Angle Snap (Hold)` = `A`

## Store Assets

- Store listing images live in `store-assets/`.
- Upload screenshots using exact dimensions: `1280x800` or `640x400`.
- If using PNG screenshots, they must not have an alpha channel.
- Current screenshot (`store-assets/screenshot.png`) is compliant (`1280x800`, PNG, no alpha).
- Validate all listing assets before publishing:

```bash
./scripts/validate-store-assets.sh
```

## Known Limitations

- URL parsing depends on Google Maps URL patterns containing `@lat,lng,zoom` values (supports `z` and meter-based `m` zoom units). Unsupported URL states show a non-blocking message.
- Overlay alignment uses a viewport heuristic (largest visible map canvas). Major Google Maps UI/layout changes can cause minor visual offsets.
- Measurements are approximate and intended for planning, not legal/survey/engineering use.

## Accuracy Disclaimer

This extension is for approximate visual planning only. Drawings are not survey-grade measurements and should not be used as legal, engineering, or cadastral boundaries.
