# FunnelKeeper CLI and MCP server

The open-source command-line and Model Context Protocol clients for the
[FunnelKeeper](https://funnelkeeper.com) growth and revenue API.

## CLI

Requires Node.js 20 or newer.

```bash
npm install --global funnelkeeper
fk signup
```

You can also run a command without installing:

```bash
npx funnelkeeper status
```

See the complete [CLI reference](https://funnelkeeper.com/docs/cli/).

## MCP server

Add FunnelKeeper to Claude Code:

```bash
claude mcp add funnelkeeper \
  -e FUNNELKEEPER_API_KEY=fk_live_… \
  -- npx -y --package funnelkeeper funnelkeeper-mcp
```

Or configure any stdio MCP client:

```json
{
  "mcpServers": {
    "funnelkeeper": {
      "command": "npx",
      "args": ["-y", "--package", "funnelkeeper", "funnelkeeper-mcp"],
      "env": {
        "FUNNELKEEPER_API_KEY": "fk_live_…"
      }
    }
  }
}
```

The server can also start without a key and expose the `signup_account` setup
tool. See the complete [MCP reference](https://funnelkeeper.com/docs/mcp/).

## API

Both clients call the same authenticated FunnelKeeper API used by the dashboard.
The [API reference](https://funnelkeeper.com/docs/api/) and
[OpenAPI document](https://funnelkeeper.com/openapi.json) describe the contract.

## Security

API keys are stored at `~/.config/funnelkeeper/config.json` with mode `0600`.
Do not commit that file or put a key directly in an MCP configuration committed
to source control. Report vulnerabilities privately to
[funnelkeeper@aelabs.ai](mailto:funnelkeeper@aelabs.ai).

## License

MIT
