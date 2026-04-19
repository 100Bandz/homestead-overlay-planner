# Privacy Policy for Homestead Overlay Planner

Effective date: April 19, 2026

Homestead Overlay Planner is a Chrome extension that adds drawing and measurement tools on top of Google Maps for property planning.

## What this extension does

- Lets users draw lines, rectangles, polygons, and labels on Google Maps.
- Stores plans so users can reopen and edit them later.

## Data we process

We only process data needed for the extension's single purpose.

### 1) Location data

- The extension stores map-related location values (for example map center, zoom, and shape coordinates) as part of saved plans.
- This data is provided by the Google Maps page and by user actions in the planner.

### 2) Website content

- The extension reads limited Google Maps page state needed to align overlays and tools with the map view.
- We do not collect page content from unrelated websites.

## Where data is stored

- Data is stored locally in the user's browser using `chrome.storage.local`.
- We do not send plan data to our servers.

## Data sharing and selling

- We do not sell user data.
- We do not transfer user data to third parties, except as required by law.

## Data retention

- Plans remain in local browser storage until the user deletes them, clears browser/extension data, or uninstalls the extension.

## Permissions and why they are used

- `activeTab`: run the extension on the current tab when the user starts it.
- `scripting`: inject packaged extension scripts/styles into Google Maps.
- `storage`: save plans and extension settings locally.
- Google Maps host permissions: access Google Maps pages to render and keep overlays aligned.

## Security

- All extension code is packaged with the extension.
- No remote code execution is used.

## Children's privacy

This extension is not directed to children under 13.

## Changes to this policy

We may update this policy. Updates will be reflected by changing the effective date above.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/100Bandz/homestead-overlay-planner/issues
