# Fontify roadmap

> Your web, your type. The long-term aim is for replacement typography to feel native: stable while content changes, respectful of the site's semantics, and reversible without side effects.
>
> **Status:** Release sequence agreed: v1.1.1 UI simplification → v1.1.2 blue brand refresh → v1.2.0 font engine modernisation. **Updated:** 12 October 2026. Items below are release intentions, not evidence that a version has shipped.

## Release sequence

The minor patch releases should ship **before** the larger engine work, with clear boundaries between them. Keep their changes independent so visual refinements do not complicate performance diagnosis or regression testing.

### v1.1.1 — UI simplification and anti-bloat cleanup

**Implementation status:** Done on [`cleanup/antislop`](https://github.com/XDanfr/Fontify/tree/cleanup/antislop), as reported by the project owner; **merge/tag/release status is not implied**. The branch is deliberately separate from the engine work.

**Intent:** Make Fontify easier to understand and operate while retaining its Material 3 Expressive personality.

- [x] Complete the UI cleanup work on the dedicated `cleanup/antislop` branch.
- [ ] Before shipping, review the branch diff, check that core controls remain discoverable and keyboard-accessible, and verify light/dark themes, popup/options, narrow windows, settings interactions, and backup-related entry points.
- [ ] Merge and tag v1.1.1 when the cleanup branch is accepted and the build/test/release workflow passes.

**Scope boundary:** No major engine rewrite, typography rule semantics changes, or brand-colour overhaul in v1.1.1. Removing clutter must not remove genuinely useful functions.

### v1.1.2 — Blue brand identity

**Status:** Planned, after v1.1.1. **Direction:** Shift Fontify's brand from purple to **blue** so it has a recognisable identity among the wider family of apps. The precise palette, contrast targets, and icon treatment will be selected during implementation, not guessed in this roadmap.

- [ ] Establish a coherent blue Material 3 Expressive source palette and verify generated primary/secondary/tertiary/on-colour/container roles in both light and dark schemes.
- [ ] Apply the new identity consistently to popup, settings, dialogs, interactive states, onboarding/empty states where present, icons and other bundled branding surfaces; preserve purposeful semantic error/success colours.
- [ ] Audit hover/focus/selected/disabled states, WCAG-appropriate readability and contrast, Windows/macOS/Linux browser rendering where relevant, and reduced-motion compatibility.
- [ ] Update bundled icons and brand assets only if needed for consistency, plus screenshots/docs and release notes when they become stale.
- [ ] Confirm that typography presets, settings, user-imported themes/data, extension IDs and functionality are unchanged; keep this a **visual branding release**, not an engine release.
- [ ] Complete release checks and tag v1.1.2 only after v1.1.1 is integrated.

**Scope boundary:** Avoid unrelated layout churn, new complexity or a rushed switch to a fixed blue for every state. Work with Material 3 Expressive's tonal colour roles and theme behaviour.

### v1.2.0 — Font engine modernisation

**Status:** Research and detailed plan below; implementation not started by this roadmap change. Follow Phases 0–7 after v1.1.2. This is a substantial **content-script engine** modernisation, not a full UI or product rewrite.

- [ ] Establish performance/paint/correctness baselines, including YouTube automatic captions and right-click flashes.
- [ ] Confirm the rewrite decision and hybrid CSS/JS strategy using measurement and regression fixtures.
- [ ] Implement a stable, incremental typography engine, non-disruptive context inspection, better font loading, and bounded mutation work.
- [ ] Preserve all existing settings, custom fonts, exception precedence and reversible disable behaviour.
- [ ] Pass compatibility, Chromium/Firefox, performance and packaging/release gates before tagging v1.2.0.

**Release dependency:** v1.2.0 starts from the accepted 1.1.2 baseline. Engine work remains independently reviewable and should not silently redo the 1.1.x visual changes.

---

## Direction and decision

**Recommendation: substantially rewrite the content-script replacement engine, not the extension as a whole.** The current issues share an architectural cause: ordinary DOM mutations repeatedly schedule a document-wide pass that removes existing overrides before calculating and applying them again. A few isolated fixes would address symptoms, but not the global processing model.

This is a **provisional technical decision**, to be confirmed against a performance and correctness baseline in Phase 0. Do not start by rewriting the settings, Material 3 Expressive UI, catalogue, backup format, or signing/release pipeline. The UI-cleanup branch is independent; this roadmap does not require rebasing, replacing, or changing it. If a smaller redesign meets the acceptance criteria, prefer that over rewriting for its own sake.

Principle: **maintain a stable desired typography state, reconcile only what changed, and restore page-owned values only when an override really ends or must change.**

### Verified findings from the existing code

| Source | Finding | Impact / qualification |
| --- | --- | --- |
| [`src/content.js`](src/content.js) `schedule()` | A 180 ms trailing debounce is reset by later mutations. | Continuous updates can indefinitely defer a new pass; 180 ms is the minimum scheduling delay, not total latency. |
| [`src/content.js`](src/content.js) `apply()`, `restore()` | An ordinary pass disconnects observation, restores every tracked override, scans all accessible elements and open roots, loads required faces, then writes overrides again. | Expensive and creates opportunities for original-font flashes. A visible flicker depends on paint timing; measure rather than assert it on every pass. |
| [`src/content.js`](src/content.js) `contextmenu` listener | Right-click explicitly disconnects observation and calls `restore()` for the entire page just to inspect original typography, then schedules reapplication. | Direct explanation of the reported right-click reversion; the original-font snapshot is needed, but the visible-page restoration is not. |
| [`src/content.js`](src/content.js) `MutationObserver` | Observes `childList` and `class`/`style`, but not `characterData`. It scans open shadow roots anew on each pass. | Newly added captions are seen; changes to text nodes alone do **not** by themselves trigger this observer. Avoid claiming that all text changes cause work. Track text changes only if necessary for newly qualifying text nodes or icon recognition. |
| [`src/content.js`](src/content.js) `originals` map and `protectedElement()` | Holds element references, original inline declarations and current overrides, and pins protected descendants to preserve typography inheritance. | Retain exact rollback and exceptions; review detached-node cleanup and interaction with page-authored inline changes. |
| [`src/fonts.js`](src/fonts.js), [`src/background.js`](src/background.js) | Faces are cached in IndexedDB, returned as data URLs, decoded, instantiated and loaded into each document via the FontFace API. | Cache avoids repeat network downloads, but not message, decode, font registration and other per-document work. Optimise without sacrificing offline/custom-font behaviour. |
| [`scripts/build.mjs`](scripts/build.mjs) | Content scripts use `document_idle`, `all_frames`, and `match_about_blank`. | Contributes to initial flash of unstyled text; `document_start` should be tested, not presented as a complete cure because storage and font bytes remain asynchronous. |
| [`tests/browser.mjs`](tests/browser.mjs) | Existing real-Chromium tests cover dynamic insertion, open Shadow DOM, profiles, exceptions, right-click description, restore, custom fonts, and the UI. | Extend the suite rather than discard it; it currently tests eventual correctness more than frame-to-frame stability, latency and cost. |

Additional risks to validate: stale asynchronous passes and generation handling, font-weight/italic mismatches, CSSOM and inherited-style changes that do not generate relevant DOM mutations, shadow roots created on existing elements after initial observation, page-owned style changes during an active override, memory retained for detached nodes, and conflicts with site styles using `!important`.

**Limits of the diagnosis:** no live YouTube browser trace or cross-browser performance benchmark has been captured yet. The source explains plausible causes and proves explicit restoration, but precise paint timing, CPU budgets, and the relative cost of each stage remain open measurements.

## Open-source comparison notes (research; not code to copy)

| Project and source | Observed implementation | Lesson for Fontify | Caveat |
| --- | --- | --- | --- |
| [Glyphy](https://github.com/kalagar/Glyphy), [`src/content.js`](https://github.com/kalagar/Glyphy/blob/master/src/content.js), [`src/lib/css.js`](https://github.com/kalagar/Glyphy/blob/master/src/lib/css.js), [manifest](https://github.com/kalagar/Glyphy/blob/master/manifest.json) | Starts at `document_start`, keeps a single style element and updates its CSS on settings changes. Broad font selector excludes known icon classes. | Persistent CSS can style new elements automatically and avoid whole-page restore/reapply passes. | One-family global rules are simpler than Fontify's serif/sans/mono profiles, original-family rules, selected blocks and nested exceptions. Do not copy the broad `*` rule blindly. |
| [FontARA](https://github.com/mimalef70/fontara), [observer](https://github.com/mimalef70/fontara/blob/master/src/inject/observer.ts), [DOM processor](https://github.com/mimalef70/fontara/blob/master/src/inject/dom-processor.ts), [style manager](https://github.com/mimalef70/fontara/blob/master/src/inject/font-style-manager.ts) | Combines managed stylesheets/site-specific CSS with incremental DOM processing, owned-style tracking, open-shadow-root support, deduplication and chunked workloads. | Strongest reference for a hybrid engine: separate rendering, detection, ownership, scheduling and lifecycle. | More moving parts, and site-specific CSS needs ongoing maintenance. Adopt concepts only after measuring Fontify's needs. |
| [Font Replacer](https://github.com/pfzim/font-replacer), [`content.js`](https://github.com/pfzim/font-replacer/blob/master/content.js) | Inspects CSS declarations, observes new elements and separately watches newly introduced stylesheets; processes added subtrees. | Incremental processing and stylesheet-change handling can avoid unnecessary total-page traversal. | Rewriting page CSS/CSSOM introduces cascading, CORS, rollback and interference risks. Not a preferred default for Fontify. |
| [Type-X](https://github.com/arrowtype/type-x) | Exposes CSS-selector control, icon exclusions and custom/variable-font testing workflows. | Test font weight/style and icon safety against realistic typography sites; a pure global replacement isn't enough. | Type-X targets live typeface testing more than automatic persistent, multi-profile replacements. |

These are architectural references, not comparative performance benchmarks. Avoid introducing a dependency on any of them or copying source without a deliberate licence and maintenance review.

## v1.2.0 proposed milestones

### Phase 0 — Capture the baseline and define success (required before implementation)

- [ ] Record deterministic Chromium runs and Firefox runs on an agreed test environment; include browser/OS, machine profile, extension state and selected font/cache status. Retain raw timings and traces in reproducible test output, not fabricated README numbers.
- [ ] Instrument extension-only phases: settings acquisition, first content-script execution, DOM discovery, computed-style reads, classification, background round trip, font decoding/loading, style writes, and time until applied computed style.
- [ ] Measure **cold**, **warm-document** and **warm-font** runs separately. A first download is inherently different from a cached reload; don't mix the three.
- [ ] Create synthetic rapid-caption workloads: new spans; reparented spans; unchanged elements with replaced text; repeated 30–100 ms word additions; style/class changes during captions; captions replaced in a single animation frame.
- [ ] Reproduce the user's YouTube automatic captions and right-click scenario manually; log the type of mutations received, frame-level screenshot/video evidence where feasible, and whether default typography actually paints.
- [ ] Profile a long article, a large DOM, infinite scroll, a React-style SPA, nested inheritance, a page with open Shadow DOM, contenteditable, and cross-origin/`about:blank` frame cases where permitted.
- [ ] Add tests for eventual correctness **and** intermediate state: number of full traversals, unnecessary style writes, restoration operations, font requests, p50/p95 latency and heap/retained-node trends.
- [ ] Record baseline limitations and deviations in a focused engineering note; finalise realistic budgets below after measurement.

**Exit gate:** reproducible baseline, at least one confirmed flicker or unnecessary reapplication regression test, and an agreed architecture choice. If a narrow implementation meets the goals at demonstrably lower risk, revisit the rewrite decision here.

### Phase 1 — Specify a stateful replacement lifecycle

- [ ] Document the immutable input settings, per-document active profile, original typography information, managed replacement state, and reasons for invalidation; model **unknown**, **loading**, **active**, **excluded**, **failed**, **disabled**, and **disposed** states as needed.
- [ ] Design an **incremental reconciler**: initial discovery may traverse the document, but ordinary child insertion/replacement should process only a minimal changed subtree; merge overlapping dirty roots and handle disconnected targets.
- [ ] Preserve original CSS and inline values with priority (`!important`), including non-Fontify site mutations while active. Track what **Fontify owns** versus what the page owns. Do not derive an original family by merely stripping an alias without checking inheritance and cascade.
- [ ] Define separate paths for typography-affecting changes (class/style/ancestors, rules, stylesheet changes) versus text-only edits (often no reclassification required). Decide when `characterData` observation helps, without creating an update storm.
- [ ] Specify how enabling/disabling, per-site exceptions, save/remove rule, tab/frame navigation, lifecycle disposal, and aborted/stale asynchronous requests reconcile or restore **only affected elements**.
- [ ] Keep the existing settings schema and backups readable. No forced reset or silently changed rule precedence.

**Exit gate:** documented state machine, ownership semantics and exception precedence backed by adversarial fixture cases.

### Phase 2 — Replace restore-and-rescan with an incremental engine

- [ ] Split the monolithic `src/content.js` by concern, likely into an observer/scheduler, typography analyser/classifier, managed style/ownership store, font-face loader interface and context-target inspector. Specific filenames are an implementation choice, not a requirement.
- [ ] Stop calling global `restore()` on ordinary mutations or right-click. Only remove an override on explicit disable, a changed applicable rule, genuine style reclassification, or element release.
- [ ] Prefer persistent CSS/style rules where they can correctly apply to newly inserted text **without losing** original-family categorisation or element-level exceptions. Use targeted inline or scoped rules for the cases that require them.
- [ ] Coalesce affected roots and schedule work no later than the next suitable frame for warm-font updates, rather than resetting a trailing 180 ms timeout indefinitely. Budget long work in chunks and prioritise visible/currently changing text while avoiding starvation.
- [ ] Prevent self-triggering MutationObserver loops; minimise DOM writes; separate style reads and writes where possible; make ownership markers private/minimal and avoid exposing user text.
- [ ] Handle SVG/icon glyphs, pseudo-elements (where realistically possible), text inputs, code, protected nested children, inherited fonts, and strong site `!important` rules without unconditionally overriding protected typography.
- [ ] Manage open Shadow DOM per root and observe roots added later; state clearly that closed roots, canvas text and inaccessible frames are outside the general guarantee.
- [ ] Prune disconnected references and support body replacement, clone/reinsert, SPA navigation and frame teardown without leaking objects or leaving orphaned overrides.
- [ ] Ensure stylesheet changes, inherited-property changes and media-query/font rule changes are assessed with bounded invalidation rather than assuming every DOM change matters.

**Exit gate:** no whole-document scan or mass font restoration for an isolated warm-font caption update; restored original inline declarations/priority remain correct on disable.

### Phase 3 — Right-click inspector without visual restoration

- [ ] Retrieve original-family and font-stack information from stored or revalidated original-typography metadata, not by stripping *every* override from the page.
- [ ] Preserve selection-based scope, original-font override, selected-block selector, protected code handling, shadow-root indicator and the current `describe` context message contract.
- [ ] Handle context menus on text in descendants, nested styling, newly inserted elements, Shadow DOM and stale metadata. Provide an explicitly tested targeted fallback if original typography cannot be determined.
- [ ] Confirm a right-click causes **zero writes** to unrelated elements and does not emit a page-wide restoration; verify target computed styles remain the replacement through the entire event/menu window.

**Exit gate:** no right-click font flash in controlled Chromium/Firefox cases, and original-font rules still target the website's original family.

### Phase 4 — Font acquisition, registration and initial paint

- [ ] Investigate `document_start` for safe early bootstrap while keeping asynchronous settings and actual font bytes honest; compare against current `document_idle` behaviour in both browsers.
- [ ] De-duplicate in-flight loads by family/weight/style (and descriptors/unicode ranges where needed); register each effective face at most once per document, with correct lifetime and cleanup.
- [ ] Reduce repeated IndexedDB/background lookups, base64 conversion and font decoding where practical; assess structured-clone/byte transport and cross-browser compatibility before changing message formats.
- [ ] Preserve Google Fonts request validation, per-style fallback, offline/cached mode, custom TTF/OTF/variable faces, unicode subsets, italic/weight synthesis and error backoff.
- [ ] Apply typography only once the required face is usable when necessary; avoid blocking unrelated elements while a new face downloads. Ensure failed or missing fonts leave readable page text.
- [ ] Minimise cold-load flash but **do not promise zero FOUT** on the first remote download, a restricted page or font failure.

**Exit gate:** no redundant warm-document fetch/decode/registration for already installed faces; measured cold and warm experience is no worse than baseline.

### Phase 5 — Correctness, compatibility and accessibility

- [ ] Preserve separate default/serif/sans-serif/monospace/bold/italic profiles, existing bold-italic behaviour, category detection, manual font/block rules (newest wins), site/font/selector exceptions, current-site pause and restored inline declaration priority.
- [ ] Verify fixed-pitch detection and glyph protection, including Unicode private-use characters, Material Symbols, Font Awesome, ligatures, fallbacks and icon-only labels.
- [ ] Test inheritance when a protected descendant sits inside a restyled ancestor, and when authors alter an inline `font-family` or `font-weight` after Fontify activates.
- [ ] Test editable text/caret, selections, screen-reader-friendly labels and form controls; preserve legibility rather than aggressively changing semantic glyph fonts.
- [ ] Cover open shadow roots, nested roots, available iframes, CSP-restricted pages, dynamically added stylesheets, computed styles controlled by CSS variables, and SPA route transitions.
- [ ] Test enable/disable cycles, rapid settings changes, failed/cancelled loads, multiple independent frames, extension reload, imported backups and restored defaults.
- [ ] Preserve privacy: no telemetry, raw browsing text in logs, unapproved network hosts, new permissions or content extraction beyond the existing behaviour.

**Exit gate:** existing unit/browser suite passes; new regression cases pass in Chromium **and** Firefox where supported; review documented browser gaps explicitly.

### Phase 6 — Performance budgets and release gates

These are **initial targets**, to confirm or revise with Phase 0 evidence and a documented reference machine. They are not existing measurements.

| Measure | Proposed target / gate |
| --- | --- |
| Right-click in a warm document | Zero unrelated style writes, zero global restore passes, no observed intermediate original-font frame. |
| Ordinary caption update with loaded font | No full-document rescan or global teardown; visible replacement should persist or apply within the next suitable rendering opportunity. |
| Warm incremental application latency | Aim for p95 <= 50 ms on a representative reference fixture; report device/browser variance and don't use a hard 50 ms universal guarantee. |
| Idle page | No periodic polling and no ongoing style mutations/CPU activity attributable to Fontify. |
| Massive/infinite DOM | Bounded batches without long main-thread tasks; no unbounded queues or retained detached-node growth. |
| Font loading | No duplicate effective face registrations in one document; sensible cold/warm separation and recoverable failures. |
| Compatibility | 100% pass on legacy-settings, rule-priority, exception, custom-font and rollback regression fixtures. |
| Release | `npm test`, `npm run build`, `npm run lint:firefox`, `npm run test:browser` and existing packaging/signing checks pass; add Firefox interactive coverage where practical. |

Build a repeatable benchmark harness and record before/after medians and p95s with the same fonts and fixtures. If the new engine makes any key path slower or less correct, investigate before release rather than accepting performance claims based on architecture alone.

### Phase 7 — Delivery, rollout and rollback

- [ ] Implement on a dedicated engine branch, with frequent small commits by component: measurement fixtures → state/ownership → scheduler/observer → CSS/hybrid strategy → inspector → loader → cross-browser tests → docs.
- [ ] Keep the UI-cleanup work separate. Preserve Material 3 Expressive controls and existing storage schema; avoid combining aesthetic changes with engine-risk reviews.
- [ ] If useful during development, keep a **dev-only** old-engine comparison path for A/B benchmarking. Do not ship two competing engine implementations or a permanent hidden settings toggle unnecessarily.
- [ ] Compare old/new behaviour on the same fixtures, then run real YouTube captions, social feeds, documentation pages, large articles and sites using web components.
- [ ] Verify Chrome/Chromium CRX/ZIP and Firefox XPI/ZIP packages and signing workflows; test unpacked development builds before producing a release tag. Do not conflate self-signed CRX with Chrome Web Store signing or unsigned XPI with Mozilla-signed distribution.
- [ ] Update README, behaviour boundaries, tests and release notes to reflect actual behaviour, not aspirational performance. Include a known-issues/rollback procedure and migration notes if anything changes.
- [ ] Merge only after performance and correctness gates are met. If a critical regression is discovered after release, revert the engine commit/release to the last stable code **without deleting user settings or cached fonts**.

## Decision record / questions to settle during Phase 0–1

1. **Rewrite or selective refactor?** Current recommendation: replace `src/content.js` internals substantially; retain UI/model/storage/release foundations. Reconsider if measurements prove the simpler refactor sufficient.
2. **CSS-first vs JS-first?** Prefer persistent CSS for stable, predictable families and JS for original-font-sensitive cases and exceptions. Prototype and measure cascade correctness before locking the strategy.
3. **Early injection?** Trial `document_start` with a minimal bootstrap; do not assume it fixes asynchronous settings or cold font downloading.
4. **Text mutations?** Pure `characterData` edits on an already overridden element shouldn't trigger expensive work. Newly qualifying text nodes and text-based icon detection may require narrowly scoped invalidation.
5. **Original-family discovery?** Must support accurate right-click rules without temporarily altering the rendered document, including when the page changes its own CSS after Fontify has applied an override.
6. **How much site-specific logic?** Start general-purpose, add bounded optional adapters (YouTube captions first) only if general correctness cannot meet measured needs, and test selectors against site changes.
7. **What isn't possible?** No promise of invisible first-time remote font loads, equal metrics/line wrapping, inaccessible frame/root control, or immunity to adversarial site CSS.

## After v1.2.0 (not in this rewrite)

Reassess user-requested features separately: better variable-font axes, richer per-site presets, import/export improvements, accessibility preferences, and further M3E polish. None is a prerequisite for fixing the engine. Do not allow feature expansion to delay stability work.

---

**References:** [Current implementation](src/content.js) · [Font pipeline](src/fonts.js) · [Build manifests](scripts/build.mjs) · [Current browser tests](tests/browser.mjs) · [Glyphy](https://github.com/kalagar/Glyphy) · [FontARA](https://github.com/mimalef70/fontara) · [Font Replacer](https://github.com/pfzim/font-replacer) · [Type-X](https://github.com/arrowtype/type-x).

No implementation or browser-performance claims beyond the inspected source and documented external examples are implied by this roadmap.
