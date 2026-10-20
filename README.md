# STU1504 | BOSTON DATA CENTER DECISION MAPPING

By Jingyi Zoe Liu.

An English, local interactive rendering of `Frame12_Database.xlsx`. The iOS-style interface uses system typography, frosted toolbars, rounded controls and a dedicated detail inspector. Bold, condensed folder labels contrast with the quiet interface. Mobile uses bottom navigation and a detail sheet. Four section colors organize the white or graphite canvas, with a neutral dot grid and no background rectangles.

## Run locally

Requires Node.js. No npm packages or build step are needed.

```powershell
npm start
```

Open **http://127.0.0.1:4173**. Keep that terminal running; press `Ctrl+C` to stop. Serve the files over HTTP rather than opening `index.html` directly, because the application loads its data as JSON.

All fonts, scripts and diagram data are stored locally. Original evidence links and the Miro links open external websites only when clicked. Nothing is deployed or published.

## Explore

- Drag the diagram to pan; use the wheel or `+` / `−` to zoom. Mouse/touch interaction does not add a canvas focus frame; keyboard Tab focus retains an accent outline.
- Select a node to open its grouped notes under **Description**, **Public Influence**, **Evidence**, and **Time Scope**. Redundant section prefixes, empty blocks and adjacent identical blocks are omitted from the display; meaningful text and evidence links remain intact. Section headings use a larger, heavier style than body text.
- Numbered Public Influence questions appear on separate bold lines, with answers below and space between questions, including source fragments that combine an answer with the next question.
- In every Explore view, **Public Influence · 31** toggles emphasis for the 31 nodes marked red in the workbook and carrying a Public Influence note. They use larger solid regional surfaces and elevation shadows, with related connections emphasized and other nodes subdued. The section camera stays in place; the heading reports the count in that section. The toggle stays enabled across Explore sections, pauses in Discover and returns with Explore. Spider searches, the diagram index and layout editing clear it. Click again to restore the ordinary view.
- Select a connection to inspect its source, destination and label. Select an endpoint to navigate to that node. Raw item IDs, recorded line-style metadata and the repeated routing notice are omitted from the inspector; the source data and Source dialog retain provenance.
- Use the search control or `/` to find labels, node codes, IDs or original note text.
- Use the sidebar or mobile bottom navigation to focus a source area. Its nodes, connections and headings remain clear while the other sections fade. **Overview**, **Fit** or `0` restores the whole frame and all section colors. Search results and explicitly selected items remain visible across section boundaries; closing their inspector returns to the chosen section's emphasis.
- `Escape` closes the index or detail panel. Nodes and connections support keyboard activation with Enter or Space.
- A selected item has a shareable local URL fragment. The source dialog contains the provenance and verification files.
- **Light / Dark** changes the display theme and remembers the preference locally. Light uses white and soft gray; Dark uses graphite. The detail pane follows the theme. Original colors remain in the workbook, JSON, SVG source attributes and rich-text color metadata. Source records, IDs and shape types are unchanged.
- **Land Use / Grid / Environment / Operation** use bright sky blue / lemon / mint / orange folder edges, with darker related colors for readable interface accents and connections. Cross-section connections follow their source node's section, falling back to the destination when the source is ungrouped. Original background rectangles are hidden but still determine membership: 30 / 29 / 52 / 9 nodes. G26–G28 sit in the Operation rows and use orange. Eight nodes outside the panels use a separate fallback color; moving a node does not reclassify its section.
- Explore uses **102 standard squared folders and 26 rounded diamonds**. Both rectangular source types share the standard folder; diamonds have smooth corners and no tab. Inactive nodes keep pale centers, stationary grain and bright color diffusing inward from the edge. Base shapes are **25% wider and taller**, centered on their source positions; surfaces, hit targets, attachment ports and route validation share the exact silhouette. Original shape types remain unchanged in source data and retained as `source_shape`.
- Query matches and selected nodes use a **solid bright regional fill**, with two neutral shadow layers creating a raised-card effect. Active nodes have no colored border, gradient, black inversion or breathing animation. Keyboard focus underlines the label. Actual clicks or Enter/Space activation retain two circular ripple rings lasting about 900ms; reduced motion skips the ripple. Decoration never intercepts clicks.
- Explore temporarily scales folders around their centers: **1.16× for a query match, 1.12× for manual selection, and 1.20× for both**. Connector display routes follow the enlarged boundaries and return when emphasis clears. Base positions, source records and saved layouts remain unchanged; layout editing uses the base size. Only actual clicks or Enter/Space activation trigger the one-shot ripple.
- Node labels use Title Case while preserving source codes, acronyms and names such as MassDEP. Both views, tooltips, search results and the inspector share this capitalization. Diagram titles use bundled variable **Noto Sans**, weight **850**, width **75%**. Explore labels fit inside each variant's safe body area, starting at **25px** and shrinking to **18px** when needed; connector labels remain 18px in diagram coordinates. Original source text and font metadata remain archived.

The earlier restored implementation is archived locally in `.preview/style-snapshots/frosted-restored-20261020-030521/`, with all 16 top-level web files and a verified SHA-256 manifest. It predates the enlarged cards and updated system interface.

## Community landscape

Choose **Landscape** in the left navigation (bottom navigation on mobile) to explore the same 128 nodes as a free, connected network. Select one or more general lenses—**Grid, Environment, Government, Public Influence, Hearing, Land Use, Construction, Operations**—to animate nodes into thematic groups. **Reset view** clears the lenses and restores the free network. Nodes without a selected-topic match remain visible at the periphery. Drag nodes, pan, zoom, search and open the original notes. **Fit** fits the current landscape without clearing the lenses. The URL preserves the view, chosen lenses and selected item.

**Discover** appears before **Explore** in navigation. Its page has a single **Network lenses** heading. The prominent **Untangle to overview** button unfolds the network into Overview over about 2.4 seconds: suggested links and labels fade, source nodes move to their Overview positions, and the connections settle into the actual Overview routes before the diagram appears. The animation uses the rendered destination, including any locally saved layout, and does not edit positions or routes. You can replay it by returning to Landscape; selected lenses remain available. **Cancel**, Escape, navigation, a theme change, or resizing safely ends the transition. Reduced-motion preferences open Overview immediately.

Explore's top toolbar also includes **Untangle to Discover**, available from Overview and each section. It reverses the journey over the same 2.4 seconds: the visible flowchart nodes move into the network and their connections reshape with them. Decision diamonds morph into Discover folders. The destination retains the selected lenses and current spider query; pending network motion finishes behind the overlay before the handoff. The same cancellation and reduced-motion controls apply in both directions. On narrow screens the button becomes a 44px icon control with an accessible label and tooltip.

Labels use concise source codes where available and avoid overlapping at the current zoom. More labels appear as space allows; hovering or selecting a node reveals its label and original title. Mobile shows fewer labels and keeps them inside the viewport. The shared **Labels** control toggles these labels in Landscape and connection labels in the source diagram.

Discover uses the standard tabbed folder silhouette for all nodes, sharing Explore's inactive inward diffusion, solid regional active fills, neutral elevation shadows, poster typography and palette. Its degree-based size parameter remains **1.4 times** the earlier size, with a zoom-aware minimum footprint. Temporary emphasis scales are **1.26× for query matches, 1.20× for selection and 1.32× for both**; links follow the visible folder boundaries. Query, hover and selection bring relevant labels forward. Transparent hit targets retain at least an 18px screen height. Compact controls leave the lower-left search tool clear.

Solid arrows preserve all **181 directed source connections** and meet the actual folder boundaries. Dashed lines are **114 calculated, undirected similarities**, with a maximum of three per node, and can be hidden using **Show related links**. Folder size reflects the original connection count, not influence. Click a dashed line for its score breakdown; open a node's **Topic affinities** to inspect the source evidence for each score. **How it works** explains the rules in the interface.

This is a deterministic, authored rule model, not an embedding or learned classification. Its heuristic weights are chosen for exploration and have not been empirically calibrated. Node titles, display codes, connection labels and URLs are excluded from scoring. Each theme has a small dictionary of broad concept groups in `web/landscape-model.js`. Repeated words in the same concept group do not increase its contribution.

For node \(i\) and theme \(t\), the affinity is:

```text
q(i,t) = 1 − exp[−(0.55D + 0.25S + 0.65R + 0.65P)]
```

- `D`: distinct matching concept groups in Description, capped at three.
- `S`: distinct matching concept groups across Evidence, Time Scope and Public Influence, capped at three.
- `R`: one when the original display region corresponds to the theme, zero otherwise. Original regions provide context, not an authority classification.
- `P`: one only for the Public Influence theme when its dedicated note contains an affirmative participation concept. Simple negative clauses are excluded from Public Influence and Hearing matches; this rule does not provide full natural-language understanding.

For candidate nodes \(a,b\), the suggested relationship score is:

```text
relatedness(a,b) = 0.60 × cosine(q_a,q_b)
                + 0.30 × Jaccard(originalNeighbors_a, originalNeighbors_b)
                + 0.10 × sameKnownOriginalRegion(a,b)
```

The first term compares the eight-dimensional theme vectors. The second measures shared original neighbors, treating direction as irrelevant only for this comparison. Empty vectors and empty neighbor unions score zero; two unknown regions do not count as a match. Existing source pairs and self-pairs are excluded from inference. Retain a candidate only if its score is at least **0.62** and the two nodes are in **each other's top three**; ties use stable node IDs.

When lenses are selected, each node is assigned to its highest-scoring selected theme if that score is at least **0.25**, with ties resolved by the fixed theme order. A force layout draws the thematic clusters while retaining the source connections across clusters. For nodes matching other selected themes too, the target blends **87% of the primary anchor with 13% of the other anchors' score-weighted mean**, plus deterministic local spacing. This changes only the Landscape display; the source diagram and locally edited positions remain independent. Multi-topic scores stay visible in the inspector even though each node has one primary displayed cluster.

`npm run check:landscape` checks deterministic scores, source retention, evidence ownership, title independence, empty vectors, negation handling and inferred-link constraints. `npm run check:landscape:browser` checks the integrated experience against the local server and dedicated Edge/Chromium DevTools instance on port 9224.

`npm run check:untangle:browser` verifies the Discover-to-Overview animation, endpoint alignment, cancellation, replay, reduced motion and preservation of source and saved layout geometry against the same local browser.

Focused bidirectional validation is recorded in `.preview/reverse-untangle-report.json`: actual movement and final alignment for all 128 nodes and 181 source connections, query retention, section entry, cancellation, repeated activation, light/dark themes, 320/390px layouts, reduced motion and unchanged source/layout data.

## Spider search

Discover and Explore share a compact input at the lower-left of the canvas and a monochrome spider drawn only with fine contours. All interface guidance is in English. Type a word or short question, or press Enter to search immediately. Try `public hearings about water` or `noise complaints`. Explore highlights matching nodes and their title words. Source excerpts stay collapsed until **View notes** is selected; choosing an excerpt opens its highlighted original notes in the inspector and closes the popover. Discover casts fine silk, pulls the matching nodes into a radial web and connects that web to the spider. These threads visualize the search, rather than adding recorded relationships.

Clear the input or press Escape while typing to release the web and restore the previous Landscape positions and camera. Switching between Discover and Explore keeps the query, including both **Untangle** transitions. Choosing a topic lens, opening the original index, resetting Landscape or starting layout editing clears the spider query. Source geometry and saved local edits remain unchanged. Reduced-motion preferences skip the gathering animation.

Matching runs locally with an explicit bilingual vocabulary and simple sentence fillers; it is not an LLM or unrestricted semantic understanding. It looks at source titles/codes and the four original note sections. Broad queries can also use the existing theme affinities. Each distinct query concept contributes its strongest evidence weight: code `1`, title `.96`, Description `.86`, other notes `.70`, or `.55 × theme affinity` for a broad concept with no literal match (minimum affinity `.25`). The score is `.78 × sum(weights)/conceptCount + .22 × matchedConceptCount/conceptCount`. Results retain the highest available concept coverage, then sort by score: if full matches exist, partial matches are omitted; otherwise the interface states the partial coverage. Thus “water hearings” gathers nodes addressing both ideas. A result based only on the original diagram region is identified as such in its evidence.

`npm run check:spider` verifies bilingual queries, source evidence, ranking, concept coverage and safe literal matching. `npm run check:spider:browser` verifies highlighting, source preservation, weaving, reset, mode changes, mobile layout, reduced motion and Overview handoff using the existing local browser on port 9224.

## Arrange your local layout

- Choose **Edit layout** to arrange the diagram. Drag a node to move it, or drag a connector segment or its round handles to adjust its route. Node centers and connector lanes snap to the visible grid. Endpoints remain attached to their original nodes.
- The grid follows the diagram while panning and zooming. Its spacing adapts to roughly 8–16 screen pixels; a gesture uses the grid step visible when that gesture starts.
- Connected lines follow node drags immediately. On release, routes are recalculated to clear nodes and separate parallel runs. A blocked move returns to its previous position. Editing a line rejects node traversal, overlapping line segments and self-crossings; ordinary crossings between different connections remain possible.
- Drag empty space to pan, or hold **Space** while dragging an item. Arrow keys move a focused node or line handle by a grid step; Shift moves five steps. **Escape** cancels an active drag, or exits editing when no drag is active. **Done** returns to reading notes.
- **Undo / Redo**, **Ctrl / ⌘ Z**, and **Ctrl / ⌘ Shift Z** step through up to 40 layout changes in the current session. **Reset** returns enlarged cards to their source centers and recomputes their routes; it can itself be undone.
- Changes are stored only in this browser under `frame12-layout-v1`. Saved coordinates retain the original-size top-left convention, so older layouts preserve their node centers when loaded into the enlarged view. Manual routes are revalidated and rerouted when their endpoints or surrounding geometry no longer fit. If storage is unavailable, editing remains usable for the current session and the status says so.

All edits affect display geometry only. The workbook, source JSON, node text, evidence ownership and connection direction remain unchanged. Reset restores the initial enlarged display, while the original sizes remain available in the source data.

## Content and provenance

The workbook is the content database. It contains **128 nodes**, **181 connectors**, **115 explicit node–note pairs**, **639 sidebar fragments**, **144 hyperlink occurrences**, and **440 archived source items**. All IDs remain strings. The 13 nodes without grouped notes receive no authored explanation. The two independent Grid notes remain in the source data; the current app omits them from the displayed canvas, with no inferred node association.

The Explore Public Influence toggle derives its set from the original `Nodes` fields: `fill_color = #ffc6c6`, `border_color = #ff6464`, and a nonempty `Public Influence` note. These source colors match the workbook's red cell swatches. All 31 marked nodes satisfy the rule: 7 Land Use, 6 Grid, 12 Environment, 5 Operation and the ungrouped X02. G26 belongs to the Operation area. The original workbook and exported records remain unchanged.

The supplied Miro link targets node `3458764686135816236` inside original frame `3458764686135623201`. The separate “Copy of 12” is excluded. The original frame is **15200 × 10200** units. Original positions, sizes and shape types remain intact in source records; Explore enlarges cloned folders around the same centers while retaining rich-text emphasis and the three rotated labels. User layout adjustments are stored separately. Original colors and font metadata remain recorded. Explore does not use a force layout; the separate Landscape view does.

`source/miro-frame12.svg` preserves the Miro canvas-composer export read during implementation. It is a semantic source archive, not a native visual SVG with usable connector paths. Its 440 item IDs, attributes and authored HTML were checked against the workbook. The export's `skipped_count=489` is an unscoped diagnostic, not a confirmed count of missing Frame 12 items.

### Supplemental site codes

The 13 originally uncoded nodes receive stable site codes, mapped by node ID during loading. This enrichment affects presentation and search only: the existing **115 source codes**, workbook, exported JSON, original titles, IDs, links and topology remain unchanged. Original values are retained on the enriched records. In Grid codes, `-R` means the resolved outcome of the corresponding decision branch.

| Site code | Original node title |
| --- | --- |
| `P01` | PROPOSED BOSTON DATA CENTER |
| `P02` | SHARED INPUTS: Boston parcel, lawful use, added load, equipment, cooling / discharge, work phase |
| `G14-R` | Boston Public-Way Approval or Confirmed N/A |
| `G16-R` | Applicable DPU Requirements Resolved |
| `G18-R` | Applicable Energy-Facility Siting Approvals |
| `G22-R` | Applicable Regional / Federal Requirements Resolved |
| `EM10` | MEPA Review Completed or Confirmed N/A |
| `EA09` | Applicable Air Approvals & Noise Requirements |
| `EW07` | Applicable Wetlands Approvals & Conditions |
| `ES05` | BWSC Drainage & Applicable Stormwater Requirements |
| `EH08` | Applicable Water Supply & Discharge Authorizations |
| `EC06` | Chapter 91 Authorization or Confirmed N/A |
| `O01` | LAWFUL BOSTON DATA-CENTER OPERATION |

## Visual limit requiring an original export

The workbook and current Miro export omit **all 181 original connector routes** and **all 105 connector label positions**. Their source fields remain null. `routing.js` derives provisional display paths from known endpoints and attachment sides; the interface labels them as approximate. Automatic routes use separate attachment points and staggered lanes to avoid overlapping runs and passing through nodes. Automatically routed parallel runs have at least 24 source units of separation. Manual adjustments use the visible grid instead. Crossing lines can still intersect at individual points.

Every connection, endpoint, direction, dash pattern and label is retained. Original colors and line types remain recorded as source metadata. In the initial layout, all 93 recorded straight connections remain straight; all nine recorded curves use elbowed display routes for a consistent style. Manual adjustments can turn straight connectors into elbowed routes while preserving endpoints. The diagram contains no curved display routes. These display changes never overwrite the workbook or JSON records.

Exact original routing still needs a vector PDF/SVG or high-resolution image of Frame 12. Missing border widths, corner radii, text padding/line spacing and stacking use documented display defaults. The site is content-verified, with enlarged cards arranged at fixed source centers, and is **not claimed to be a pixel-exact visual replica**. See `web/data/integrity.json` and the workbook's `Fidelity` sheet.

Original rich text is rebuilt using a safe tag allowlist. Validated source text colors are retained as `data-source-color` metadata; displayed text follows the current theme. HTTP(S) links retain their destinations, and source markup is never executed. System fonts resolve locally; diagram titles load the bundled Noto Sans variable font. Noto Sans and Open Sans assets and their OFL licenses remain under `web/fonts`.

## Regenerate and verify

Requires Python and `openpyxl` only for workbook conversion, not for running the site.

```powershell
python -m pip install -r scripts/requirements.txt
npm run export
npm run check
```

The exporter regenerates `web/data/frame12.json` and `web/data/integrity.json` deterministically. Its 40 checks cover record counts, exact IDs, all 362 endpoint references, explicit note associations, fragment reconstruction, hyperlinks, geometry, styling and agreement with the retained live Miro export. It exits unsuccessfully if any required check fails. Update workbook content and associated blocks consistently before exporting. `scripts/routing-check.mjs` independently audits original shapes, mixed folder variants and all folders at 1.20× emphasis: deterministic routes, exact boundary endpoints, triangulated nonconvex interiors, safe text areas, editing validation, overlapping runs, spacing and source immutability.

`scripts/browser-check.mjs` is a historical browser baseline using a local server and a dedicated Edge/Chromium DevTools instance on port 9224. Its raw inspector block/order and click-ripple assertions predate the current presentation. Current inspector and title-formatting checks are included in `npm run check` through `scripts/inspector-content-check.mjs` and `scripts/node-label-check.mjs`; focused browser captures and the current inspector validation report are saved as `.preview/inspector-refined-*`.

`scripts/layout-check.mjs` checks snapping and segment geometry against all 181 connectors. `scripts/layout-browser-check.mjs` exercises real pointer editing, node and line snapping, endpoint attachment, local persistence, undo/redo, reset and cancellation. Browser tests use a dedicated profile and restore its pre-test layout storage.

`scripts/focus-browser-check.mjs` checks display silhouettes, source-shape metadata, inactive inward diffusion, active solid fills and shadows, decoration alignment, regional focus, circular ripples, zoom, sharp text and reduced motion. Spider checks distinguish temporary query growth from saved layout changes; untangle checks compare final visible outlines. These broad scripts have updated presentation assertions but were not rerun for this revision. Current focused browser QA uses the `.preview/folder-solid-*` capture and report prefix.

## Files

| File | Purpose |
| --- | --- |
| `web/index.html` | English interface and source dialog |
| `web/styles.css` | Reference-inspired interface and responsive layout |
| `web/app.js` | Search, inspector, navigation and source ownership |
| `web/inspector-content.js` | Inspector section order and safe removal of repeated display headings |
| `web/node-label.js` | Shared title capitalization with source codes, acronyms and rich text preserved |
| `web/node-codes.js` | Stable supplemental site codes for 13 uncoded nodes, preserving original source values |
| `web/node-ripple.js` | Circular node activation ripples with cancellation and reduced-motion support |
| `web/graph.js` | Source rendering, local layout editing, history and interaction |
| `web/glow.js` | Inactive inward diffusion and grain, solid regional active faces and neutral elevation shadows |
| `web/folder-shape.js` | Squared folders and rounded diamonds; safe label boxes; cardinal/radial ports and interior tests |
| `web/layout.js` | Centered display enlargement, grid snapping, segment editing and geometry validation |
| `web/routing.js` | Separate attachment points and staggered provisional routes |
| `web/regions.js` | Display color mapping based on original background geometry |
| `web/landscape-model.js` | General themes, traceable affinity scores and sparse inferred similarities |
| `web/landscape.js` | Independent force network, topic clustering and accessible interaction |
| `web/landscape-transition.js` | Bidirectional screen-space morph between the rendered Explore flowchart and Discover network |
| `web/landscape.css` | Landscape controls, network appearance and responsive layout |
| `web/spider-search.js` | Local bilingual concept matching, evidence and ranking |
| `web/spider-highlights.js` | Safe word highlighting that preserves original rich text |
| `web/spider-companion.js` | Articulated SVG spider and interaction states |
| `web/spider.css` | Floating search, spider, highlights and silk |
| `web/public-influence.css` | Explore's responsive toggle for original red Public Influence nodes |
| `web/data/frame12.json` | Deterministic source data |
| `web/data/integrity.json` | Detailed data verification and unresolved visual fields |
| `scripts/export-data.py` | Workbook conversion and validation |
| `scripts/serve.mjs` | Local static server bound to loopback only |
