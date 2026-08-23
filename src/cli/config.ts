// Re-export: the store lives in shared so the MCP server can read/write it
// without importing from src/cli.
export { readConfig, writeConfig, deleteConfig, configPath, type CliConfig } from "../shared/cliConfig.js";
