# ios-sim-mcp

> **v0.1** — functional but early. See [Limitations](#limitations) below.

An MCP server that gives LLMs (Claude, etc.) the ability to drive the iOS Simulator —
build apps, take screenshots, tap, type, inject files, and read logs.

Designed for agentic code→build→test feedback loops.

## Setup
```bash
bun install
bun run build
```

## Add to Claude Code
```bash
claude mcp add ios-sim-mcp -- node /path/to/ios-sim-mcp/dist/index.js
```

Or add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "ios-sim-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/ios-sim-mcp/dist/index.js"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_simulators` | List available simulators |
| `boot_simulator` | Boot a simulator by UDID |
| `screenshot` | Capture current screen (returns image) |
| `tap` | Tap at x,y coordinates |
| `type_text` | Type into focused input |
| `press_button` | Press home/lock/volume/siri |
| `open_url` | Open URL or deep link |
| `install_app` | Install .app bundle |
| `launch_app` | Launch by bundle ID with optional args |
| `terminate_app` | Kill running app |
| `build_app` | Build Xcode project, returns errors |
| `build_and_run` | Build + install + launch in one step |
| `inject_file` | Copy a file into app's Documents dir |
| `get_app_logs` | Stream simulator console logs |
| `reset_simulator` | Erase simulator content |

## Limitations

Most tools work out of the box with just Xcode installed. Two exceptions:

**`tap`** — uses `simctl io sendEvent` under the hood, which is fine for basic taps. For swipes, drags, multi-touch, or anything more complex, we'll want [idb_companion](https://github.com/facebook/idb) from Meta, which has a much richer interaction API. More to come on this in a future release.

**`get_accessibility_tree`** — currently returns a placeholder. Full accessibility tree introspection also requires [idb_companion](https://github.com/facebook/idb). This will be wired up in a future release.

Everything else (`screenshot`, `type_text`, `build_app`, `install_app`, `get_app_logs`, etc.) relies only on `xcrun simctl` and `xcodebuild` — no extra dependencies needed.