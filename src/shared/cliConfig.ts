// Shared credential store: ~/.config/funnelkeeper/config.json, mode 0600.
// Holds a long-lived API key — never a session token. Used by the CLI and
// by the MCP server (setup-mode persist + fallback when FUNNELKEEPER_API_KEY
// is unset).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type CliConfig = {
  api_url: string;
  api_key: string;
  account_email: string;
};

const dir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "funnelkeeper");
const file = path.join(dir, "config.json");

export function readConfig(): CliConfig | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as CliConfig;
  } catch {
    return null;
  }
}

export function writeConfig(cfg: CliConfig): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export function deleteConfig(): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

export function configPath(): string {
  return file;
}
