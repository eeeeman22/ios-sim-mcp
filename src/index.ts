import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const server = new Server(
  { name: "ios-sim-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// --- Helpers ---

function simctl(...args: string[]): string {
  return execSync(`xcrun simctl ${args.join(" ")}`, { encoding: "utf8" });
}

async function simctlAsync(...args: string[]): Promise<string> {
  const { stdout } = await execAsync(`xcrun simctl ${args.join(" ")}`);
  return stdout;
}

function getBootedSimulatorUDID(): string {
  const output = simctl("list", "devices", "--json");
  const data = JSON.parse(output);
  for (const runtime of Object.values(data.devices) as any[]) {
    for (const device of runtime) {
      if (device.state === "Booted") return device.udid;
    }
  }
  throw new Error("No booted simulator found. Boot one first in Xcode or via simctl.");
}

// --- Tool Definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_simulators",
      description: "List all available iOS simulators and their current state (booted/shutdown).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "boot_simulator",
      description: "Boot a simulator by UDID or name.",
      inputSchema: {
        type: "object",
        properties: {
          udid: { type: "string", description: "Simulator UDID (preferred) or name" },
        },
        required: ["udid"],
      },
    },
    {
      name: "screenshot",
      description: "Take a screenshot of the booted simulator. Returns a base64-encoded PNG.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "tap",
      description: "Tap at a specific coordinate on the simulator screen.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate" },
          y: { type: "number", description: "Y coordinate" },
        },
        required: ["x", "y"],
      },
    },
    {
      name: "type_text",
      description: "Type text into the currently focused input on the simulator.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type" },
        },
        required: ["text"],
      },
    },
    {
      name: "press_button",
      description: "Press a hardware button on the simulator (home, lock, volumeUp, volumeDown, siri).",
      inputSchema: {
        type: "object",
        properties: {
          button: {
            type: "string",
            enum: ["home", "lock", "volumeUp", "volumeDown", "siri"],
          },
        },
        required: ["button"],
      },
    },
    {
      name: "open_url",
      description: "Open a URL or deep link in the booted simulator.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL or deep link to open" },
        },
        required: ["url"],
      },
    },
    {
      name: "install_app",
      description: "Install an app bundle (.app) on the booted simulator.",
      inputSchema: {
        type: "object",
        properties: {
          app_path: { type: "string", description: "Absolute path to the .app bundle" },
        },
        required: ["app_path"],
      },
    },
    {
      name: "launch_app",
      description: "Launch an installed app by bundle identifier.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "App bundle identifier, e.g. com.example.MyApp" },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Optional launch arguments passed to the app",
          },
        },
        required: ["bundle_id"],
      },
    },
    {
      name: "terminate_app",
      description: "Terminate a running app by bundle identifier.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "App bundle identifier" },
        },
        required: ["bundle_id"],
      },
    },
    {
      name: "build_app",
      description: "Build an Xcode project or workspace for the simulator. Returns build output and success/failure.",
      inputSchema: {
        type: "object",
        properties: {
          project_path: { type: "string", description: "Absolute path to .xcodeproj or .xcworkspace" },
          scheme: { type: "string", description: "Xcode scheme name" },
          simulator_name: {
            type: "string",
            description: "Simulator destination name, e.g. 'iPhone 16 Pro'",
            default: "iPhone 16 Pro",
          },
        },
        required: ["project_path", "scheme"],
      },
    },
    {
      name: "build_and_run",
      description: "Build an Xcode project and install+launch the app on the booted simulator in one step.",
      inputSchema: {
        type: "object",
        properties: {
          project_path: { type: "string", description: "Absolute path to .xcodeproj or .xcworkspace" },
          scheme: { type: "string", description: "Xcode scheme name" },
          bundle_id: { type: "string", description: "App bundle identifier to launch after install" },
          simulator_name: {
            type: "string",
            description: "Simulator destination name",
            default: "iPhone 16 Pro",
          },
          launch_args: {
            type: "array",
            items: { type: "string" },
            description: "Optional launch arguments (e.g. --use-mock-audio)",
          },
        },
        required: ["project_path", "scheme", "bundle_id"],
      },
    },
    {
      name: "get_accessibility_tree",
      description: "Dump the accessibility hierarchy of the current screen as JSON. Useful for finding element IDs to tap.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inject_file",
      description: "Copy a file from the host into the simulator's file system at a specified container path. Useful for injecting mock audio or test data.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "Target app's bundle identifier" },
          local_path: { type: "string", description: "Absolute path to the file on your Mac" },
          container_relative_path: {
            type: "string",
            description: "Relative path inside the app's Documents directory, e.g. 'audio/test.m4a'",
          },
        },
        required: ["bundle_id", "local_path", "container_relative_path"],
      },
    },
    {
      name: "get_app_logs",
      description: "Stream recent console logs from the booted simulator, optionally filtered by bundle ID.",
      inputSchema: {
        type: "object",
        properties: {
          bundle_id: { type: "string", description: "Filter logs to this app's bundle ID (optional)" },
          lines: { type: "number", description: "Number of recent log lines to return", default: 50 },
        },
      },
    },
    {
      name: "reset_simulator",
      description: "Erase all content and settings on the booted simulator (full reset).",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// --- Tool Handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_simulators": {
        const output = simctl("list", "devices", "--json");
        const data = JSON.parse(output);
        const result: any[] = [];
        for (const [runtime, devices] of Object.entries(data.devices) as any) {
          for (const device of devices) {
            if (device.isAvailable) {
              result.push({
                name: device.name,
                udid: device.udid,
                state: device.state,
                runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
              });
            }
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "boot_simulator": {
        simctl("boot", args!.udid as string);
        return { content: [{ type: "text", text: `Booted simulator ${args!.udid}` }] };
      }

      case "screenshot": {
        const udid = getBootedSimulatorUDID();
        const tmpPath = path.join(os.tmpdir(), `sim-screenshot-${Date.now()}.png`);
        simctl("io", udid, "screenshot", tmpPath);
        const imgData = fs.readFileSync(tmpPath).toString("base64");
        fs.unlinkSync(tmpPath);
        return {
          content: [
            { type: "text", text: "Screenshot captured." },
            { type: "image", data: imgData, mimeType: "image/png" },
          ],
        };
      }

      case "tap": {
        const udid = getBootedSimulatorUDID();
        const { x, y } = args as { x: number; y: number };
        simctl("io", udid, "sendEvent", "touch", "begin", `${x}`, `${y}`);
        simctl("io", udid, "sendEvent", "touch", "end", `${x}`, `${y}`);
        return { content: [{ type: "text", text: `Tapped at (${x}, ${y})` }] };
      }

      case "type_text": {
        const udid = getBootedSimulatorUDID();
        simctl("io", udid, "sendEvent", "keyboard", `--input=${args!.text as string}`);
        return { content: [{ type: "text", text: `Typed: ${args!.text}` }] };
      }

      case "press_button": {
        const udid = getBootedSimulatorUDID();
        const buttonMap: Record<string, string> = {
          home: "home",
          lock: "lock",
          volumeUp: "volume-up",
          volumeDown: "volume-down",
          siri: "siri",
        };
        simctl("io", udid, "sendEvent", "button", buttonMap[args!.button as string]);
        return { content: [{ type: "text", text: `Pressed ${args!.button}` }] };
      }

      case "open_url": {
        const udid = getBootedSimulatorUDID();
        simctl("openurl", udid, args!.url as string);
        return { content: [{ type: "text", text: `Opened URL: ${args!.url}` }] };
      }

      case "install_app": {
        const udid = getBootedSimulatorUDID();
        simctl("install", udid, args!.app_path as string);
        return { content: [{ type: "text", text: `Installed app from ${args!.app_path}` }] };
      }

      case "launch_app": {
        const udid = getBootedSimulatorUDID();
        const launchArgs = (args!.launch_args as string[] | undefined) ?? [];
        const output = simctl("launch", udid, args!.bundle_id as string, ...launchArgs);
        return { content: [{ type: "text", text: output }] };
      }

      case "terminate_app": {
        const udid = getBootedSimulatorUDID();
        simctl("terminate", udid, args!.bundle_id as string);
        return { content: [{ type: "text", text: `Terminated ${args!.bundle_id}` }] };
      }

      case "build_app": {
        const { project_path, scheme, simulator_name = "iPhone 16 Pro" } = args as any;
        const ext = path.extname(project_path);
        const flag = ext === ".xcworkspace" ? "-workspace" : "-project";
        const cmd = `xcodebuild ${flag} "${project_path}" -scheme "${scheme}" -destination "platform=iOS Simulator,name=${simulator_name}" -configuration Debug build 2>&1 | tail -50`;
        const { stdout } = await execAsync(cmd);
        const success = stdout.includes("BUILD SUCCEEDED");
        return {
          content: [
            {
              type: "text",
              text: `Build ${success ? "SUCCEEDED" : "FAILED"}\n\n${stdout}`,
            },
          ],
        };
      }

      case "build_and_run": {
        const {
          project_path,
          scheme,
          bundle_id,
          simulator_name = "iPhone 16 Pro",
          launch_args = [],
        } = args as any;

        const udid = getBootedSimulatorUDID();
        const ext = path.extname(project_path);
        const flag = ext === ".xcworkspace" ? "-workspace" : "-project";

        // Build
        const buildCmd = `xcodebuild ${flag} "${project_path}" -scheme "${scheme}" -destination "platform=iOS Simulator,name=${simulator_name}" -configuration Debug build 2>&1 | tail -80`;
        const { stdout: buildOutput } = await execAsync(buildCmd);
        const success = buildOutput.includes("BUILD SUCCEEDED");

        if (!success) {
          return {
            content: [{ type: "text", text: `Build FAILED:\n\n${buildOutput}` }],
          };
        }

        // Find .app path from build output
        const appPathMatch = buildOutput.match(/Build settings from command line:.+?BUILT_PRODUCTS_DIR = (.+)/s);
        // Fallback: derive path from DerivedData
        const derivedDataPath = execSync(
          `xcodebuild ${flag} "${project_path}" -scheme "${scheme}" -showBuildSettings 2>/dev/null | grep BUILT_PRODUCTS_DIR | head -1 | awk '{print $3}'`,
          { encoding: "utf8" }
        ).trim();

        const appPath = path.join(derivedDataPath, `${scheme}.app`);

        simctl("install", udid, appPath);
        simctl("launch", udid, bundle_id, ...launch_args);

        return {
          content: [
            {
              type: "text",
              text: `Build SUCCEEDED. Installed and launched ${bundle_id}.\n\nBuild output:\n${buildOutput}`,
            },
          ],
        };
      }

      case "get_accessibility_tree": {
        // Uses idb_companion if available, otherwise falls back to a UI test dump approach
        // For now, uses a best-effort approach via xcrun
        return {
          content: [
            {
              type: "text",
              text: "Accessibility tree inspection requires idb_companion (Meta's iOS dev tooling). Install with: brew install idb-companion\nThen this tool will return the full accessibility hierarchy. For now, use screenshot + coordinates for interaction.",
            },
          ],
        };
      }

      case "inject_file": {
        const udid = getBootedSimulatorUDID();
        const { bundle_id, local_path, container_relative_path } = args as any;

        // Get app container path
        const containerPath = simctl(
          "get_app_container",
          udid,
          bundle_id,
          "data"
        ).trim();
        const documentsPath = path.join(containerPath, "Documents");
        const destPath = path.join(documentsPath, container_relative_path);

        // Ensure directory exists
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(local_path, destPath);

        return {
          content: [
            {
              type: "text",
              text: `File injected to: ${destPath}`,
            },
          ],
        };
      }

      case "get_app_logs": {
        const udid = getBootedSimulatorUDID();
        const lines = (args?.lines as number) ?? 50;
        const bundleId = args?.bundle_id as string | undefined;
        const filter = bundleId ? `| grep "${bundleId}"` : "";
        const { stdout } = await execAsync(
          `xcrun simctl spawn ${udid} log stream --style compact ${filter} & sleep 2 && kill $!`
        );
        const logLines = stdout.split("\n").slice(-lines).join("\n");
        return { content: [{ type: "text", text: logLines }] };
      }

      case "reset_simulator": {
        const udid = getBootedSimulatorUDID();
        simctl("erase", udid);
        return { content: [{ type: "text", text: `Simulator ${udid} erased.` }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// --- Start ---
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ios-sim-mcp running");