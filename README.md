# ios-simulator-mcp

An MCP (Model Context Protocol) server that gives Claude Code autonomous iOS testing capabilities — navigate screens, interact with UI elements, detect bugs, and generate structured test reports, all without writing a single line of XCUITest.

## How It Works

Claude reads the iOS accessibility tree (via Meta's `idb` tool) to understand every element on screen — labels, types, enabled state, frame coordinates — and combines that with screenshots when visual confirmation is needed. Unlike XCUITest, there are no fragile element locators to maintain: Claude finds elements by label using fuzzy matching, adapts when the UI changes, and builds a directed screen graph to track coverage and prevent infinite navigation loops.

## Demo

> ![Demo GIF placeholder](./docs/demo.gif)
> *Run the demo app to generate yours: `npm run demo`*

---

## Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| macOS | 13+ | Ventura or later |
| Xcode | 15+ | With iOS 17+ simulator runtime |
| Node.js | ≥ 20.0.0 | LTS recommended |
| Claude Code | latest | `npm install -g @anthropic/claude-code` |
| idb | any | Strongly recommended — install via `brew install idb-companion` |

`idb` is optional but highly recommended. Without it, accessibility tree inspection is unavailable and Claude falls back to screenshot-only mode.

---

## Installation

**1. Clone the repo and install dependencies**

```bash
git clone https://github.com/your-org/ios-simulator-mcp
cd ios-simulator-mcp
npm install
```

**2. Build**

```bash
npm run build
```

**3. Install idb companion (recommended)**

```bash
brew tap facebook/fb
brew install idb-companion
```

**4. Add to your Claude Code config**

Open `~/.claude/claude_desktop_config.json` (create it if it doesn't exist) and add:

```json
{
  "mcpServers": {
    "ios-simulator": {
      "command": "node",
      "args": ["/absolute/path/to/ios-simulator-mcp/dist/src/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/ios-simulator-mcp` with the actual path on your machine.

**5. Restart Claude Code**

The `ios-simulator` tools will appear in Claude's tool list on next startup.

---

## Quick Start

```bash
# 1. Boot a simulator
xcrun simctl boot "iPhone 15 Pro"

# 2. Install your app
xcrun simctl install booted /path/to/YourApp.app

# 3. Ask Claude to test it
# In Claude Code:
# "Test com.yourcompany.YourApp and generate a bug report"
```

Claude will navigate all reachable screens, interact with UI elements, detect crashes and errors, and produce a markdown report with severity-ranked bugs and coverage statistics.

---

## Tools Reference

### Simulator Management

| Tool | Description |
|------|-------------|
| `list_simulators` | Lists all available simulators with UDID, name, OS, and state |
| `get_booted_simulator` | Returns UDID and metadata of the currently booted simulator |
| `install_app(app_path)` | Installs a `.app` bundle to the booted simulator |
| `launch_app(bundle_id, reset_state?)` | Launches the app; `reset_state: true` simulates first-run |
| `terminate_app(bundle_id)` | Terminates the running app |
| `get_app_info(bundle_id)` | Returns version, build, minimum OS, entitlements |

### UI Inspection

| Tool | Description |
|------|-------------|
| `get_accessibility_tree()` | Returns all UI elements as a flat array with labels, types, frames |
| `describe_current_screen()` | Identifies the current screen type and suggests next test actions |
| `find_element(query, strategy?)` | Finds an element by label, type, value, or fuzzy match |

### Screenshots

| Tool | Description |
|------|-------------|
| `take_screenshot(screen_name?)` | Captures a screenshot (resized to ≤1024px, JPEG 85%) |
| `compare_screenshot(baseline_path, threshold?)` | Diffs current screen against a baseline; highlights changes in red |

### Interaction

| Tool | Description |
|------|-------------|
| `tap_by_label(label, screenshot_on_fail?)` | Taps an element by fuzzy label match |
| `tap_at(x, y)` | Taps at absolute screen coordinates |
| `input_text(label, value, clear_first?)` | Types text into a field (clears first by default) |
| `swipe(direction, distance_percent?, screen_width?, screen_height?)` | Swipes in a direction |
| `scroll_to_element(label, direction?, max_scrolls?)` | Scrolls until element is visible |
| `press_hardware_button(button)` | Presses home, lock, rotate_left, or rotate_right |
| `long_press(label, duration_ms?)` | Long-presses an element |
| `drag(from_label, to_label)` | Drags from one element to another |

### Waiting

| Tool | Description |
|------|-------------|
| `wait_for_element(label, timeout_ms?, poll_interval_ms?)` | Polls until element appears |
| `wait_for_screen_stable(timeout_ms?)` | Waits until screen stops changing (animations done) |
| `wait_for_element_gone(label, timeout_ms?)` | Polls until element disappears |

### Assertions

| Tool | Description |
|------|-------------|
| `assert_element_exists(label)` | Fails if element is not in the accessibility tree |
| `assert_text_equals(label, expected)` | Fails if element's text doesn't match |
| `assert_element_enabled(label)` | Fails if element is disabled |
| `assert_no_crash()` | Checks DiagnosticReports for new crash logs |
| `assert_no_error_in_logs(patterns?)` | Scans console logs for error patterns |

### Auth & State

| Tool | Description |
|------|-------------|
| `inject_user_defaults(bundle_id, key, value)` | Sets a UserDefaults key before launch |
| `read_user_defaults(bundle_id, key)` | Reads a UserDefaults key |
| `set_keychain_value(bundle_id, key, value)` | Injects a keychain entry (idb only) |
| `reset_app_state(bundle_id)` | Clears all app storage and relaunches fresh |
| `set_location(latitude, longitude)` | Spoofs GPS location |
| `set_permissions(bundle_id, permissions)` | Sets app permissions (camera, location, etc.) |

### Diagnostics

| Tool | Description |
|------|-------------|
| `get_console_logs(lines?, filter?)` | Returns recent simulator console output |
| `get_crash_logs(bundle_id?)` | Returns crash report summaries from DiagnosticReports |
| `get_network_calls(since_ms?)` | Returns HTTP calls recorded by the mock server |
| `start_mock_server(port?, routes_config?)` | Starts the bundled HTTP mock server |
| `stop_mock_server()` | Stops the mock server and returns the full call log |

### Test Session State

| Tool | Description |
|------|-------------|
| `register_screen(name, description?)` | Registers a screen in the coverage graph |
| `mark_screen_tested(name, result, notes?)` | Records pass / fail / skip / blocked for a screen |
| `add_navigation_edge(from, to, action)` | Records a screen transition in the graph |
| `get_screen_graph()` | Returns the full directed graph with coverage stats |
| `add_bug(severity, title, description, screen, ...)` | Records a bug with severity, screen, and optional screenshot |
| `get_test_report(format, app_name?, app_version?)` | Generates markdown or JSON test report |
| `reset_test_session()` | Clears all state to start a fresh test run |

---

## Custom Test Flows (YAML)

Place `.yaml` files in `test-flows/` to define critical user journeys. Claude executes these before free exploration, so important paths are always tested first.

```yaml
name: "Checkout Flow"
description: "Full purchase from product selection to confirmation"
steps:
  - action: tap_by_label
    label: "Add to Cart"

  - action: wait_for_element
    label: "Cart (1)"
    timeout_ms: 3000

  - action: tap_by_label
    label: "Checkout"

  - action: wait_for_screen_stable

  - action: input_text
    label: "Card Number"
    value: "4111111111111111"

  - action: assert_text_equals
    label: "Order Total"
    expected: "$9.99"

  - action: tap_by_label
    label: "Place Order"

  - action: wait_for_element
    label: "Order Confirmed"
    timeout_ms: 10000

  - action: assert_no_crash
```

Supported actions mirror the tool names: `tap_by_label`, `tap_at`, `input_text`, `swipe`, `scroll_to_element`, `press_hardware_button`, `wait_for_element`, `wait_for_element_gone`, `wait_for_screen_stable`, `assert_element_exists`, `assert_text_equals`, `assert_element_enabled`, `assert_no_crash`, `assert_no_error_in_logs`, `take_screenshot`.

---

## Mock Server

Use the built-in HTTP mock server to test network-dependent features without a real backend.

**1. Start the server before launching your app**

```javascript
// Via Claude tool call:
start_mock_server(3210, {
  "GET /api/user":    { "status": 200, "body": { "id": 1, "name": "Test User" } },
  "POST /api/login":  { "status": 200, "body": { "token": "mock-token-123" } },
  "GET /api/feed":    { "status": 200, "delay_ms": 500, "body": { "items": [] } },
  "POST /api/purchase": { "status": 500, "error": "Payment unavailable" }
})
```

**2. Point your app at the mock server**

```javascript
inject_user_defaults("com.your.app", "APIBaseURL", "http://127.0.0.1:3210")
```

**3. Inspect captured calls**

```javascript
get_network_calls()  // returns all calls since server started
get_network_calls(since_ms)  // filter by timestamp
```

**4. Stop and review**

```javascript
stop_mock_server()  // returns full call log with methods, URLs, bodies, status codes
```

Any route not in your config returns `200 {}` — the app never hangs waiting for an unmatched endpoint.

You can also hit `GET http://127.0.0.1:3210/mock/calls` directly from any HTTP client to inspect captured requests.

See `mock-server/config.example.json` for a full example configuration.

---

## Known Limitations

- **Custom-drawn UIs**: Screens rendered with Metal, SpriteKit, or OpenGL won't appear in the accessibility tree. Claude will fall back to screenshot analysis for these, with reduced interaction capability.
- **Large apps**: Apps with 50+ screens need predefined flows in `test-flows/` to be efficient. Free exploration alone will not provide full coverage in a reasonable time.
- **Simulator only**: Physical device testing is not supported. The tools rely on `xcrun simctl` and `idb`, both of which target simulators.
- **Single app**: Multi-app flows (e.g. testing a share sheet that opens another app) are not supported. Testing is scoped to one app at a time.
- **idb dependency**: Accessibility tree inspection requires `idb-companion`. Without it, `get_accessibility_tree` is unavailable and Claude relies entirely on screenshots.
- **Network proxy**: The mock server works for apps that accept a configurable API base URL. Apps with hardcoded production URLs cannot be redirected without a proper network proxy.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Run tests before and after your changes: `npm test`
3. Keep TypeScript strict — no `any` casts without a comment explaining why.
4. New tools need both an implementation in `src/tools/` and tests in `src/__tests__/`.
5. Update the tools reference table in this README.
6. Open a pull request with a description of what changed and why.

Bug reports and feature requests are welcome via GitHub Issues.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
