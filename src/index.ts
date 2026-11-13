#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadWordPressConfigFromEnv, WordPressClient } from "./wordpress-client.js";
import { registerPageTools } from "./tools/pages.js";
import { registerThemeTools } from "./tools/theme.js";
import { registerCodeTools } from "./tools/code.js";

async function main(): Promise<void> {
  const config = loadWordPressConfigFromEnv();
  const client = new WordPressClient(config);

  const server = new McpServer({
    name: "wp-mcp-server",
    version: "0.2.0",
  });

  // "code" (default): a single `execute` tool, Code Mode style.
  // "tools": the original one-tool-per-endpoint surface. "both": everything.
  const mode = process.env.WP_MCP_MODE ?? "code";
  if (!["code", "tools", "both"].includes(mode)) {
    // eslint-disable-next-line no-console
    console.error(`[wp-mcp-server] Invalid WP_MCP_MODE "${mode}". Use "code", "tools" or "both".`);
    process.exit(1);
  }

  if (mode !== "tools") {
    registerCodeTools(server, client);
  }
  if (mode !== "code") {
    registerPageTools(server, client);
    registerThemeTools(server, client);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // eslint-disable-next-line no-console
  console.error(`[wp-mcp-server] Connected via stdio. Target WordPress site: ${config.baseUrl}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[wp-mcp-server] Fatal error:", error);
  process.exit(1);
});
