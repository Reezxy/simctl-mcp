# ios-simulator-mcp — Full Claude Code Build Prompt (v2)

## Project Goal

Build a production-grade, open-source MCP (Model Context Protocol) server called **ios-simulator-mcp** that gives Claude Code full autonomous testing capabilities for iOS apps running in the Xcode Simulator.

The north star: a developer runs `claude "test my entire app and give me a bug report"` and Claude autonomously navigates every screen, handles auth, waits for async content, tracks state, makes assertions, and outputs a structured markdown + JSON report — without any pre-written test scripts.

This must work on real-world apps, not just simple demos.

---

## Architecture Overview

Three layers:

1. **MCP Server** (TypeScript) — exposes tools Claude calls
2. **Simulator Bridge** (idb + xcrun simctl) — executes actions on the simulator
3. **State Engine** (in-process) — tracks screen graph, visited states, test results

Claude is the orchestrator. It calls tools in sequence, reasons about what it sees, decides what to test next.

---

## Tech Stack

- TypeScript (strict mode), Node.js 20+
- `@modelcontextprotocol/sdk` for MCP
- `idb` (Meta's iOS Development Bridge) — primary interface
- `xcrun simctl` — fallback + simulator management
- `sharp` — screenshot resizing before base64 encoding
- `ws` or HTTP — optional mock server for network interception
- Jest — unit tests for tree-parser and state engine

---

## Full Project Structure

```
ios-simulator-mcp/
├── src/
│   ├── index.ts                    # MCP server entry, tool registration
│   ├── tools/
│   │   ├── simulator.ts            # list, boot, install, launch app
│   │   ├── accessibility.ts        # get_tree, find_element, describe_screen
│   │   ├── interaction.ts          # tap, swipe, scroll, input, press_button
│   │   ├── wait.ts                 # wait_for_element, wait_for_stable_screen
│   │   ├── screenshot.ts           # take_screenshot, diff_screenshots
│   │   ├── assertions.ts           # assert_element_exists, assert_text, assert_state
│   │   ├── diagnostics.ts          # get_logs, get_crashes, get_network_calls
│   │   ├── auth.ts                 # inject_credentials, skip_onboarding, reset_app
│   │   └── state.ts                # get_screen_graph, mark_visited, get_test_summary
│   ├── engine/
│   │   ├── screen-graph.ts         # directed graph of visited screens
│   │   ├── element-finder.ts       # fuzzy label matching, fallback strategies
│   │   ├── screenshot-processor.ts # resize, diff, base64
│   │   └── report-generator.ts     # markdown + JSON bug report builder
│   ├── utils/
│   │   ├── exec.ts                 # promisified exec with timeout + retry
│   │   ├── idb-check.ts            # detect idb, graceful fallback to xcrun
│   │   └── tree-flattener.ts       # recursive idb JSON → flat element array
│   └── types.ts                    # all shared TypeScript interfaces
├── mock-server/
│   ├── index.ts                    # lightweight HTTP mock server
│   ├── routes.ts                   # configurable mock API responses
│   └── config.example.json         # example mock route definitions
├── test-flows/
│   └── example-flow.yaml           # example predefined user journey
├── CLAUDE.md                       # skill definition — how Claude should test
├── README.md
├── package.json
├── tsconfig.json
├── jest.config.ts
└── .github/
    └── workflows/ci.yml
```

---

## MCP Tools — Complete Specification

Implement every tool below with full JSON Schema descriptions. Claude reads these descriptions to know when and how to use each tool.

### 1. Simulator Management

**`list_simulators`**
Returns all available simulators. Output: array of `{ udid, name, os, state }`.

**`get_booted_simulator`**
Returns UDID + metadata of the currently booted simulator. Errors clearly if none is booted.

**`install_app(app_path: string)`**
Installs a `.app` bundle to the booted simulator via `xcrun simctl install booted`.

**`launch_app(bundle_id: string, reset_state?: boolean)`**
Launches the app. If `reset_state: true`, runs `xcrun simctl privacy booted reset all {bundle_id}` + deletes UserDefaults before launching. This simulates a first-run experience.

**`terminate_app(bundle_id: string)`**
Terminates the running app.

**`get_app_info(bundle_id: string)`**
Returns version, build number, minimum OS, entitlements from the installed bundle.

---

### 2. UI Inspection

**`get_accessibility_tree()`**
Calls `idb ui describe-all --udid booted`. Parses the nested JSON with `tree-flattener.ts` into a flat array. Each element:
```typescript
interface UIElement {
  label: string;
  type: string;         // Button, TextField, StaticText, Image, etc.
  value?: string;       // current value for inputs
  frame: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  visible: boolean;
  depth: number;
  parent_label?: string;
  children_count: number;
}
```
Max 500 elements returned. If tree exceeds 500, include a `truncated: true` flag and summary count.

**`describe_current_screen()`**
Higher-level than raw tree. Returns:
- Screen title (navigation bar label if present)
- List of interactive elements (buttons, inputs, links) only
- List of visible text content
- Detected screen type: "list", "detail", "form", "modal", "tab-bar", "onboarding", "auth", "unknown"
- Suggested next actions based on screen type

This is what Claude should call first when arriving at a new screen — cheaper than full tree.

**`find_element(query: string, strategy: "label" | "type" | "value" | "fuzzy")`**
Searches the accessibility tree. Fuzzy strategy uses substring matching + Levenshtein distance for tolerance against small label differences (e.g. "Sign In" vs "Sign in"). Returns best match + confidence score.

---

### 3. Interaction

**`tap_by_label(label: string, fallback_screenshot?: boolean)`**
Primary tap method. Finds element by label, calculates center `(x + w/2, y + h/2)`, taps via `idb ui tap`. If element not found and `fallback_screenshot: true`, takes a screenshot and returns it with an error so Claude can decide the next step visually.

**`tap_at(x: number, y: number)`**
Coordinate tap fallback. Use only when accessibility tree fails.

**`input_text(text: string, clear_first?: boolean)`**
Types into the focused element. If `clear_first: true`, sends Cmd+A then Delete before typing.

**`swipe(direction: "up" | "down" | "left" | "right", distance_percent?: number)`**
Swipe gesture. `distance_percent` (0–100) controls how far. Defaults to 50%.

**`scroll_to_element(label: string, max_scrolls?: number)`**
Scrolls down (or up if needed) until the element appears in the accessibility tree. Stops after `max_scrolls` (default: 10) to prevent infinite scroll. Returns `found: boolean`.

**`press_hardware_button(button: "home" | "lock" | "rotate_left" | "rotate_right")`**
Simulates hardware buttons via `xcrun simctl ui booted button`.

**`long_press(label: string, duration_ms?: number)`**
Long press on element. Uses `idb ui long-press`. Default 1000ms.

**`drag(from_label: string, to_label: string)`**
Drag from one element to another. Calculates both center points.

---

### 4. Waiting & Stability (Critical for Async Apps)

**`wait_for_element(label: string, timeout_ms?: number, poll_interval_ms?: number)`**
Polls the accessibility tree until element appears or timeout. Default: 5000ms timeout, 500ms poll. Returns `{ found: boolean, elapsed_ms: number }`.

**`wait_for_screen_stable(timeout_ms?: number)`**
Takes two screenshots 300ms apart. If pixel diff < 2%, considers screen stable (animations done, loading complete). Retries up to `timeout_ms`. This must be called after every navigation action before reading the accessibility tree. Default timeout: 3000ms.

**`wait_for_element_gone(label: string, timeout_ms?: number)`**
Waits until element disappears. Useful after dismissing modals, loaders, toasts.

---

### 5. Assertions

**`assert_element_exists(label: string, should_exist?: boolean)`**
Checks if element is present in tree. `should_exist` defaults to true. Returns `{ passed: boolean, message: string }`. Never throws — always returns result for Claude to evaluate.

**`assert_text_equals(label: string, expected_text: string)`**
Finds element by label and checks its `value` or text content matches expected. Case-insensitive by default.

**`assert_element_enabled(label: string, should_be_enabled?: boolean)`**
Checks enabled state of a button or input.

**`assert_no_crash()`**
Checks crash logs for any crash since last call. Returns `{ crashed: boolean, crash_summary?: string }`.

**`assert_no_error_in_logs(patterns?: string[])`**
Scans console logs for error patterns. Default patterns: `["Error", "Exception", "fatal", "crash", "nil", "undefined", "NaN"]`. Returns matched lines.

**`compare_screenshot(baseline_path: string, threshold_percent?: number)`**
Diffs current screenshot against a saved baseline using pixel comparison. Returns `{ matches: boolean, diff_percent: number, diff_image_path: string }`. Useful for visual regression.

---

### 6. Auth & App State (Critical for Real Apps)

**`inject_user_defaults(key: string, value: string | number | boolean)`**
Writes to the app's UserDefaults via `xcrun simctl spawn booted defaults write {bundle_id} {key} {value}`. Use this to skip onboarding flags, set feature flags, inject mock user IDs.

**`read_user_defaults(key: string)`**
Reads a UserDefaults key. Useful for asserting that app saved state correctly.

**`set_keychain_value(account: string, service: string, value: string)`**
Injects a keychain entry via `security` CLI on the simulator. Allows pre-seeding auth tokens so Claude can start testing logged-in flows directly.

**`reset_app_state(bundle_id: string)`**
Full reset: terminates app, deletes container, clears UserDefaults, clears keychain entries for the app. Equivalent to deleting and reinstalling. Call this before testing first-run flows.

**`set_location(latitude: number, longitude: number)`**
Sets simulated GPS location via `xcrun simctl location booted set`. For apps that use location.

**`set_permissions(bundle_id: string, permission: string, value: "grant" | "revoke" | "unset")`**
Controls app permissions (camera, location, notifications, contacts) via `xcrun simctl privacy`.

---

### 7. Network & Diagnostics

**`get_console_logs(lines?: number, filter?: string)`**
Returns last N lines of `xcrun simctl spawn booted log stream`. If `filter` provided, grep for that string. Default: 100 lines.

**`get_crash_logs(bundle_id?: string)`**
Returns crash reports from `~/Library/Logs/DiagnosticReports/` for the simulator. Summarizes: exception type, backtrace top 5 frames, timestamp.

**`get_network_calls(since_ms?: number)`**
Requires the mock server to be running. Returns all HTTP requests the app made since timestamp. Includes method, URL, request body, response status.

**`start_mock_server(port?: number, routes_config?: object)`**
Starts the bundled lightweight mock HTTP server. Routes config defines which endpoints return what. The app must point to `http://localhost:{port}` (via launch argument or scheme).

**`stop_mock_server()`**
Stops the mock server and returns a summary of all calls that were made.

---

### 8. State Engine

**`register_screen(name: string, description?: string)`**
Registers the current screen in the screen graph. Claude calls this whenever it identifies a new screen.

**`mark_screen_tested(name: string, result: "pass" | "fail" | "skip", notes?: string)`**
Marks a screen as tested with result.

**`get_screen_graph()`**
Returns the full directed graph of discovered screens: nodes (screens) + edges (navigation actions that led between them). JSON format.

**`add_bug(severity: "critical" | "high" | "medium" | "low", title: string, description: string, screen: string, screenshot_path?: string, log_excerpt?: string)`**
Adds a bug to the report. Claude calls this whenever it finds unexpected behavior.

**`get_test_report(format: "markdown" | "json")`**
Generates the final report. Markdown format includes:
- Summary table: screens tested, bugs found by severity, coverage %
- Screen-by-screen results
- Bug list with full details + screenshot references
- Console log excerpts for each bug
- Recommendations

---

## CLAUDE.md — Skill Definition

Write a thorough `CLAUDE.md` that defines exactly how Claude should conduct autonomous testing. Include:

### Testing Algorithm

```
1. SETUP
   - Call get_booted_simulator() — error if none booted
   - Call describe_current_screen() to get starting state
   - If auth screen detected: attempt login using injected credentials or skip via inject_user_defaults

2. SCREEN DISCOVERY LOOP
   For each screen:
     a. Call wait_for_screen_stable() before reading anything
     b. Call describe_current_screen() for overview
     c. Call register_screen() with detected name
     d. Call get_accessibility_tree() for full element list
     e. Call assert_no_crash() — log any crashes immediately
     f. For each interactive element not yet tested on this screen:
        - Tap/interact with it
        - Call wait_for_screen_stable()
        - If new screen appeared: push to discovery queue
        - If same screen: assert expected state change happened
        - If modal appeared: test modal, dismiss, continue
     g. Call mark_screen_tested() with result
     h. Navigate back (tap Back button or swipe right)
     i. Repeat for next item in queue

3. ASSERTION STRATEGY
   - After every tap: call assert_no_crash() + assert_no_error_in_logs()
   - For forms: fill all fields with valid test data, submit, assert success state
   - For lists: scroll to bottom, assert at least one item renders
   - For empty states: check if empty state UI is visible and labeled correctly
   - For destructive actions (delete, logout): test last to avoid losing state

4. BUG DETECTION TRIGGERS
   Call add_bug() when:
   - App crashes (assert_no_crash returns crashed: true)
   - Error messages appear unexpectedly in UI
   - Tapping a button has no visible effect after wait_for_screen_stable
   - Element exists in tree but is not enabled when it should be
   - assert_no_error_in_logs returns matches
   - Navigation leads to blank/empty screen
   - Form submission doesn't give feedback (success or error)
   - Loading spinner runs longer than 5 seconds

5. LOOP PREVENTION
   - Never visit the same screen (by name + entry path) more than twice
   - If scroll_to_element returns found: false after max_scrolls, stop and log
   - If wait_for_element times out 3 times in a row: mark screen as "blocked" and move on

6. FINAL REPORT
   - Call get_test_report("markdown") for human-readable output
   - Call get_test_report("json") for machine-readable output
   - Save both to ./test-results/ with timestamp
```

### Test Data Defaults
Define default test data Claude should use for form filling:
- Email: `test@example.com`
- Password: `TestPass123!`
- Name: `Test User`
- Phone: `+1 555 000 0001`
- Address: `123 Test Street, San Francisco, CA 94105`
- Date: today's date
- Number fields: `42`
- Search fields: `test`

### Predefined Flow Format
Support a `test-flows/*.yaml` format developers can use to define critical user journeys:
```yaml
name: "Checkout Flow"
description: "Full purchase from product to confirmation"
steps:
  - action: tap_by_label
    label: "Add to Cart"
  - action: wait_for_element
    label: "Cart (1)"
  - action: assert_element_exists
    label: "Checkout"
  - action: tap_by_label
    label: "Checkout"
  - action: assert_text_equals
    label: "Order Total"
    expected: "$9.99"
```
Claude should load and execute any YAML files in `test-flows/` before starting free exploration.

---

## Mock Server Specification

Build a lightweight Express HTTP server in `mock-server/`:

- Configurable via `routes.json`: `{ "GET /api/user": { "status": 200, "body": {...} } }`
- Logs all incoming requests with timestamp, method, URL, body
- Returns 200 with empty JSON `{}` for any unmatched route (never 404)
- Exposes `/mock/calls` endpoint to retrieve all logged requests
- Supports response delays: `{ "delay_ms": 500 }` in route config
- Supports error simulation: `{ "status": 500, "error": "Internal Server Error" }`

---

## Error Handling & Fallback Strategy

Implement this fallback chain for every user-facing tool:

```
Primary:   idb (most accurate accessibility data)
Fallback:  xcrun simctl (basic operations)
Last:      screenshot + return error (let Claude decide visually)
```

Specific cases:
- idb not installed → warn once, use xcrun for all operations
- Element not found → return `{ found: false, suggestion: "Try take_screenshot to see current state" }`
- Tap target outside screen bounds → clamp to screen bounds + warn
- Timeout in wait_for_element → return partial result with `timed_out: true`, never hang
- exec throws → catch, return structured error `{ error: true, message: string, command: string }`

---

## Screenshot Processor

In `screenshot-processor.ts`:
- Always resize to max 1024px width (maintain aspect ratio) using `sharp`
- Convert to JPEG at 85% quality for token efficiency (PNG for diffs)
- Save with timestamp + screen name: `screenshot_2024-01-15_143022_HomeScreen.jpg`
- For diffs: use pixel-by-pixel comparison, highlight diff regions in red, save diff image
- Provide `get_screenshot_stats()`: dimensions, file size, estimated token cost

---

## Report Generator

The markdown report must include:

```markdown
# iOS Test Report — [App Name] [Version]
Generated: [timestamp] | Duration: [Xmin Ysec] | Screens: X | Bugs: Y

## Summary
| Metric | Value |
|--------|-------|
| Screens discovered | 12 |
| Screens fully tested | 10 |
| Screens blocked | 2 |
| Bugs — Critical | 1 |
| Bugs — High | 3 |
| Bugs — Medium | 5 |
| Bugs — Low | 2 |
| Crashes | 0 |

## Bugs Found

### [CRITICAL] App crashes when submitting empty form
**Screen**: CheckoutScreen
**Steps to reproduce**: Navigate to checkout → tap "Place Order" without filling fields
**Expected**: Validation error shown
**Actual**: App crashes
**Logs**: `Fatal error: unexpectedly found nil while unwrapping...`
**Screenshot**: ![screenshot](./screenshots/bug_001.jpg)

## Screen Coverage
[table of all screens + test status]

## Recommendations
[bulleted list of highest priority fixes]
```

---

## README Requirements

The README must be genuinely useful to an iOS developer who has never heard of MCP. Include:

1. What this is (2 sentences)
2. How it works — accessibility tree + screenshot hybrid, why it beats XCUITest
3. Demo GIF placeholder with note "Run the demo app to generate yours"
4. Requirements with exact versions
5. Installation — step by step
6. Claude Code config JSON snippet
7. Quick start (3 commands)
8. Full tools reference table
9. How to define custom test flows (YAML format)
10. How to use the mock server
11. Known limitations (honest):
    - Heavy custom drawing / Metal / SpriteKit UIs won't appear in accessibility tree
    - Very large apps (50+ screens) need predefined flows to be efficient
    - Physical device testing not supported (simulator only)
    - No multi-app flows (only tests one app at a time)
12. Contributing guide
13. License: MIT

---

## Implementation Order

Build in this sequence so it's testable at each step:

1. `exec.ts` + `idb-check.ts` (foundation)
2. `simulator.ts` tools (list, boot, install, launch)
3. `tree-flattener.ts` + `accessibility.ts` (core inspection)
4. `screenshot.ts` + `screenshot-processor.ts`
5. `interaction.ts` (tap, input, swipe)
6. `wait.ts` (stability + polling — critical before anything else works reliably)
7. `assertions.ts`
8. `auth.ts` + `diagnostics.ts`
9. `screen-graph.ts` + `state.ts`
10. `report-generator.ts`
11. `mock-server/`
12. `CLAUDE.md` (write last, after you know exactly what each tool does)
13. `README.md`

Write Jest unit tests for `tree-flattener.ts`, `element-finder.ts`, `screen-graph.ts`, and `report-generator.ts` as you go — these are pure logic and easy to test without a simulator.

---

## Definition of Done

The project is complete when:

- [ ] All MCP tools are implemented and registered
- [ ] `wait_for_screen_stable` reliably detects when animations finish
- [ ] Fuzzy element finding handles label mismatches gracefully
- [ ] Auth injection works via UserDefaults + Keychain
- [ ] Mock server intercepts and logs network calls
- [ ] Screen graph prevents infinite loops
- [ ] Bug report generates valid markdown + JSON
- [ ] Jest tests pass for core engine modules
- [ ] README has a complete quick-start that works in under 10 minutes
- [ ] CLAUDE.md gives Claude enough context to test a real app end-to-end without additional prompting

Start with step 1 (exec.ts + idb-check.ts) and work through the implementation order. Ask before making architectural decisions that deviate from this spec.