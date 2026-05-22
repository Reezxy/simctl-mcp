# iOS Simulator MCP — Claude Skill Definition

This file defines how Claude should conduct autonomous iOS testing using the tools in this MCP server. Read it completely before starting any test session.

---

## Quick Reference

| Phase | Key tools |
|-------|-----------|
| Setup | `get_booted_simulator`, `reset_test_session`, `describe_current_screen` |
| Auth bypass | `inject_user_defaults`, `set_keychain_value`, `reset_app_state` |
| Discovery | `register_screen`, `get_accessibility_tree`, `describe_current_screen` |
| Interaction | `tap_by_label`, `input_text`, `swipe`, `scroll_to_element`, `press_hardware_button` |
| Stability | `wait_for_screen_stable`, `wait_for_element`, `wait_for_element_gone` |
| Assertions | `assert_no_crash`, `assert_no_error_in_logs`, `assert_element_exists`, `assert_text_equals` |
| Bug tracking | `add_bug`, `add_navigation_edge`, `mark_screen_tested` |
| Reporting | `get_test_report` |

---

## Testing Algorithm

Follow these phases in order. Do not skip phases.

### Phase 1 — Setup

```
1. Call reset_test_session() to clear any state from a previous run.
2. Call get_booted_simulator(). Stop and report error if none is booted.
3. Call describe_current_screen() to understand the starting state.
4. If the current screen is a login/auth screen:
   a. Try inject_user_defaults() with the app's bundle ID and test credentials.
   b. If that fails, attempt UI login using test data defaults (see below).
   c. If login is unavailable, call reset_app_state() and try again.
5. If test-flows/*.yaml files are present, load and execute them first (see Predefined Flows).
```

### Phase 2 — Screen Discovery Loop

Maintain a queue of screens to visit. Start with the current screen.

```
For each screen in the queue:

  a. Call wait_for_screen_stable() — never read the tree while animating.
  b. Call describe_current_screen() for a human-readable overview.
  c. Call register_screen(name) with the detected screen name.
  d. Call get_accessibility_tree() to get all elements.
  e. Call assert_no_crash() — if crashed: call add_bug(critical) immediately.
  f. Call assert_no_error_in_logs() — call add_bug() on any matches.

  For each interactive element not yet tested on this screen:
    - Call tap_by_label() or tap_at() to interact.
    - Call wait_for_screen_stable() after every tap.
    - If a NEW screen appeared:
        → Call add_navigation_edge(from, to, action).
        → Push new screen to discovery queue.
        → Do NOT continue testing the original screen yet — return after exploring.
    - If the SAME screen is still shown:
        → Assert expected state change (element appeared/disappeared, text changed).
    - If a MODAL appeared:
        → Test the modal, dismiss it, continue with the original screen.
    - If the tap had NO visible effect after wait_for_screen_stable:
        → Call add_bug("medium", "No response to tap", ...).

  g. Test forms: fill all fields with test data defaults, submit, assert success OR error feedback.
  h. Test lists: scroll to bottom, assert at least one item renders.
  i. Test destructive actions (delete, logout) LAST — they destroy state.
  j. Call mark_screen_tested(name, result, notes).
  k. Navigate back (tap Back button, swipe right, or press_hardware_button("home")).
  l. Continue with next item in queue.
```

### Phase 3 — Assertion Strategy

Apply these rules throughout, not only at step boundaries:

- **After every tap**: `assert_no_crash()` + `assert_no_error_in_logs()`
- **Forms**: fill all fields → submit → assert success state OR visible error message
- **Lists**: scroll to bottom → confirm at least one item is rendered
- **Empty states**: check that empty-state UI is labeled and visible (not just a blank screen)
- **Loading states**: if spinner runs > 5 seconds, call `add_bug("high", "Loading timeout", ...)`
- **Modals / alerts**: tap through them and assert each button does what it says
- **Navigation**: assert the expected destination screen appeared within 3 seconds

### Phase 4 — Bug Detection Triggers

Call `add_bug()` immediately when any of these occur:

| Trigger | Severity |
|---------|----------|
| App crashes (`assert_no_crash` returns `crashed: true`) | critical |
| Data loss or permanent state corruption | critical |
| Core feature broken (checkout, login, main list) | high |
| Error log matches (`assert_no_error_in_logs` returns matches) | high |
| Tapping interactive element has no visible effect | medium |
| Loading spinner never stops (> 5 seconds) | medium |
| Empty screen with no content and no error message | medium |
| Form gives no feedback on submit (no success, no error) | medium |
| Accessibility label missing on interactive element | low |
| Visual overlap or layout glitch visible in screenshot | low |
| Grammatical errors, placeholder text visible to user | low |

Always include:
- `title`: concise, specific (e.g. "Checkout crashes on empty cart", not "Bug")
- `description`: steps to reproduce + expected vs actual behaviour
- `screen`: the registered screen name where it occurred
- `log_excerpt`: relevant log lines when available
- `screenshot_path`: call `take_screenshot()` when visual evidence helps

### Phase 5 — Loop Prevention

These rules prevent infinite loops in complex navigation:

1. Never visit the same screen by name more than **twice**. On the second visit, check for new elements; on any further visit, skip and mark as "already covered".
2. `register_screen()` returns `tooManyVisits: true` when the threshold is hit — stop navigating to that screen.
3. If `scroll_to_element()` returns `found: false` after `max_scrolls`, stop scrolling and log it.
4. If `wait_for_element()` times out **3 times in a row** on the same screen, call `mark_screen_tested(name, "blocked", reason)` and move on.
5. If the discovery queue exceeds **50 screens**, pause and call `get_test_report()` — the app may have infinite navigation paths.

### Phase 6 — Final Report

```
1. Call get_screen_graph() to review coverage.
2. Call get_test_report("markdown") — print this output to the user.
3. Call get_test_report("json") — save for CI integration.
4. Summarise key findings: bugs by severity, coverage %, blocked screens.
```

---

## Test Data Defaults

Use these values when filling forms unless the user provides custom data:

| Field type | Default value |
|------------|---------------|
| Email | `test@example.com` |
| Password | `TestPass123!` |
| Name (full) | `Test User` |
| First name | `Test` |
| Last name | `User` |
| Phone | `+1 555 000 0001` |
| Address line 1 | `123 Test Street` |
| City | `San Francisco` |
| State / region | `CA` |
| ZIP / postal code | `94105` |
| Country | `United States` |
| Date fields | Today's date |
| Number fields | `42` |
| Search fields | `test` |
| URL fields | `https://example.com` |
| Credit card | `4111 1111 1111 1111` (Stripe test card) |
| CVV | `123` |
| Card expiry | `12/28` |

If a field has validation that rejects these defaults, try the next reasonable value and note it in the bug report.

---

## Predefined Flow Format

Place YAML files in `test-flows/` to define critical user journeys. Claude executes these before free exploration.

```yaml
name: "Checkout Flow"
description: "Full purchase from product selection to confirmation screen"
steps:
  - action: tap_by_label
    label: "Add to Cart"

  - action: wait_for_element
    label: "Cart (1)"
    timeout_ms: 3000

  - action: assert_element_exists
    label: "Checkout"

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

Supported actions: `tap_by_label`, `tap_at`, `input_text`, `swipe`, `scroll_to_element`, `press_hardware_button`, `wait_for_element`, `wait_for_element_gone`, `wait_for_screen_stable`, `assert_element_exists`, `assert_text_equals`, `assert_no_crash`, `assert_no_error_in_logs`, `take_screenshot`.

If a flow step fails: call `add_bug()` with the failing step details, mark the flow as failed, and continue with free exploration.

---

## Mock Server Usage

When testing network-dependent features:

```
1. Call start_mock_server(port, routes_config) before launching the app.
   - Port default: 3210
   - Set the app's API base URL to http://127.0.0.1:3210 via inject_user_defaults()

2. Define routes matching the app's API contract:
   {
     "GET /api/user":    { "status": 200, "body": { "id": 1, "name": "Test User" } },
     "POST /api/login":  { "status": 200, "body": { "token": "mock-token" } },
     "GET /api/feed":    { "status": 200, "delay_ms": 500, "body": { "items": [] } }
   }

3. To test error handling, return non-200 status:
   { "POST /api/purchase": { "status": 500, "error": "Payment gateway unavailable" } }

4. Call get_network_calls() at any time to inspect what the app has sent.

5. Call stop_mock_server() at the end — it returns the full call log.
```

Any route not in your config returns `200 {}` so the app never hangs on an unmocked endpoint.

---

## Tool Selection Guide

When deciding which tool to use:

**"I need to see what's on screen"**
→ `describe_current_screen()` first (fast overview), then `get_accessibility_tree()` if you need element details.

**"I need to tap something"**
→ `tap_by_label(label)` — fuzzy matching handles minor label variations.
→ Fall back to `tap_at(x, y)` only if the element has no accessibility label.

**"I need to type text"**
→ `input_text(label, value)` — it clears the field first by default.

**"I need to wait for the app to finish loading"**
→ `wait_for_screen_stable()` — always call this before reading the tree.

**"I need to check if a feature works"**
→ `assert_element_exists()`, `assert_text_equals()`, `assert_no_crash()`.

**"I found a bug"**
→ `take_screenshot()` to capture evidence, then `add_bug()`.

**"I'm done testing a screen"**
→ `mark_screen_tested(name, result, notes)`.

**"I need to test a different user state (logged out, new user, etc.)"**
→ `reset_app_state(bundle_id)` — terminates, clears storage, relaunches clean.

---

## Common Pitfalls

- **Never read the accessibility tree during an animation.** Always call `wait_for_screen_stable()` first.
- **Never assume an element exists.** Check `get_accessibility_tree()` before tapping.
- **Never hard-code screen coordinates** unless there is no accessibility label. Coordinates break on different device sizes.
- **Never ignore a crash.** If `assert_no_crash()` returns `crashed: true`, log it immediately and do not continue testing that screen.
- **Do not test destructive flows first.** Logout, delete account, and reset flows should be tested last.
- **Do not loop on blocked screens.** Three consecutive timeouts = mark as blocked and move on.
- **idb is preferred over xcrun.** If `get_accessibility_tree()` fails, check whether idb is installed (`idb --help`). Without idb, UI inspection is limited.

---

## Severity Guide (for add_bug)

| Severity | Use when |
|----------|----------|
| `critical` | App crashes, data loss, security issue, core flow completely broken |
| `high` | Important feature broken but app doesn't crash; login/checkout/main list unusable |
| `medium` | Feature works but degrades UX; confusing errors; slow loading |
| `low` | Visual glitch, typo, cosmetic issue, missing icon |
