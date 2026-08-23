#!/usr/bin/env node
// funnelkeeper-mcp — stdio MCP server wrapping the FunnelKeeper API 1:1.
//
// Key resolution: FUNNELKEEPER_API_KEY env → shared CLI config
// (~/.config/funnelkeeper/config.json) → keyless setup mode (signup_account
// only). After signup the key is held in memory and written to that config
// so the next launch boots fully armed.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools, type ToolDef } from "./tools.js";
import { makeClient, ApiError } from "../shared/apiClient.js";
import { readConfig, writeConfig, configPath } from "../shared/cliConfig.js";

const VERSION = "0.2.0";
const DEFAULT_API = "https://api.funnelkeeper.com";
const SIGNUP_TOOL = "signup_account";

function resolveApiUrl(): string {
  return process.env.FUNNELKEEPER_API_URL ?? readConfig()?.api_url ?? DEFAULT_API;
}

function resolveApiKey(): string | null {
  const env = process.env.FUNNELKEEPER_API_KEY;
  if (env) return env;
  return readConfig()?.api_key ?? null;
}

type Api = ReturnType<typeof makeClient>;
let api: Api | null = null;

function attachKey(key: string, url: string): Api {
  api = makeClient({ apiUrl: url, apiKey: key, client: "mcp", version: VERSION });
  return api;
}

function registerHttpTool(server: McpServer, tool: ToolDef): void {
  server.tool(
    tool.name,
    tool.description,
    tool.input.shape,
    {
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.destructive ?? false,
      openWorldHint: false,
    },
    async (args: Record<string, unknown>) => {
      if (!api) {
        return { content: [{ type: "text" as const, text: "Error — no API key. Call signup_account first." }], isError: true };
      }
      try {
        const result =
          tool.method === "GET"
            ? await api.get(tool.path(args))
            : tool.method === "DELETE"
            ? await api.delete(tool.path(args))
            : await api.post(tool.path(args), tool.body ? tool.body(args) : undefined);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof ApiError ? `${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `Error — ${msg}` }], isError: true };
      }
    }
  );
}

const signupDef = tools.find((t) => t.name === SIGNUP_TOOL);
if (!signupDef) throw new Error("signup_account is missing from the tool registry");
const authenticatedTools = tools.filter((t) => t.name !== SIGNUP_TOOL);

const server = new McpServer({ name: "funnelkeeper", version: VERSION });
const apiUrl = resolveApiUrl();
const existingKey = resolveApiKey();

if (existingKey) {
  attachKey(existingKey, apiUrl);
  for (const tool of authenticatedTools) registerHttpTool(server, tool);
} else {
  const registeredSignup = server.tool(
    signupDef.name,
    signupDef.description,
    signupDef.input.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async (args: Record<string, unknown>) => {
      try {
        const anon = makeClient({ apiUrl, apiKey: "", client: "mcp", version: VERSION });
        const result = await anon.post<{
          account_id: string; api_key: string; claim_url: string; claim_expires_at: string;
        }>(signupDef.path(args), signupDef.body ? signupDef.body(args) : args);
        attachKey(result.api_key, apiUrl);
        writeConfig({
          api_url: apiUrl,
          api_key: result.api_key,
          account_email: String(args.email ?? "").trim().toLowerCase(),
        });
        for (const tool of authenticatedTools) registerHttpTool(server, tool);
        registeredSignup.disable();
        server.sendToolListChanged();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              ...result,
              note: `API key stored in ${configPath()} (0600). Remaining FunnelKeeper tools are now available. Hand the claim_url to the human so they can set a password and take over the account.`,
            }, null, 2),
          }],
        };
      } catch (e) {
        const msg = e instanceof ApiError ? `${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `Error — ${msg}` }], isError: true };
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`funnelkeeper-mcp ${VERSION} up (api: ${apiUrl}${existingKey ? "" : ", setup mode"})`);
