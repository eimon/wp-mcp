/**
 * Standalone smoke test: spawns the built MCP server (dist/index.js) as a
 * child process over stdio, using the official MCP TypeScript SDK's Client
 * + StdioClientTransport, and exercises a few tools against a real
 * WordPress instance.
 *
 * Usage (after `npm run build`):
 *   WORDPRESS_URL=http://localhost:8080 \
 *   WORDPRESS_USERNAME=eimon \
 *   WORDPRESS_APP_PASSWORD=xxxx \
 *   npx tsx scripts/smoke-test.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, "..", "dist", "index.js");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}. Export it before running this smoke test.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const wordpressUrl = requireEnv("WORDPRESS_URL");
  const wordpressUsername = requireEnv("WORDPRESS_USERNAME");
  const wordpressAppPassword = requireEnv("WORDPRESS_APP_PASSWORD");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      // The spawned process needs a minimal PATH etc. from the parent, plus
      // our WordPress credentials.
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      WORDPRESS_URL: wordpressUrl,
      WORDPRESS_USERNAME: wordpressUsername,
      WORDPRESS_APP_PASSWORD: wordpressAppPassword,
    },
  });

  const client = new Client({ name: "wp-mcp-smoke-test", version: "0.1.0" });

  console.log(`Connecting to server (${serverEntry}) targeting ${wordpressUrl} ...`);
  await client.connect(transport);
  console.log("Connected.\n");

  // 1. tools/list
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((t) => t.name).sort();
  console.log("=== tools/list ===");
  console.log(toolNames.join(", "));
  const expected = [
    "create_page",
    "get_asset_content",
    "get_page",
    "get_theme_styles",
    "list_pages",
    "update_page",
  ];
  const missing = expected.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected tools: ${missing.join(", ")}`);
  }
  console.log(`OK: all ${expected.length} expected tools present.\n`);

  // 2. get_theme_styles
  console.log("=== get_theme_styles(path=\"/\") ===");
  const themeResult = await client.callTool({
    name: "get_theme_styles",
    arguments: { path: "/" },
  });
  const themeText = extractText(themeResult);
  console.log(themeText);
  if (themeResult.isError) {
    throw new Error("get_theme_styles returned an error result.");
  }
  const themeData = JSON.parse(themeText);
  if (!themeData.theme?.name) {
    throw new Error("get_theme_styles response missing theme.name.");
  }
  if (!Array.isArray(themeData.stylesheets) || themeData.stylesheets.length === 0) {
    throw new Error("get_theme_styles response missing stylesheets.");
  }
  console.log(`OK: theme.name="${themeData.theme.name}", ${themeData.stylesheets.length} stylesheet(s) found.\n`);

  // 3. list_pages
  console.log("=== list_pages() ===");
  const pagesResult = await client.callTool({ name: "list_pages", arguments: {} });
  const pagesText = extractText(pagesResult);
  console.log(pagesText);
  if (pagesResult.isError) {
    throw new Error("list_pages returned an error result.");
  }
  const pagesData = JSON.parse(pagesText);
  if (!Array.isArray(pagesData)) {
    throw new Error("list_pages did not return an array.");
  }
  console.log(`OK: list_pages returned an array with ${pagesData.length} page(s).\n`);

  await client.close();
  console.log("All smoke tests passed.");
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Tool result did not contain a content array.");
  }
  const textBlock = content.find(
    (block): block is { type: string; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text",
  );
  if (!textBlock?.text) {
    throw new Error("Tool result did not contain a text content block.");
  }
  return textBlock.text;
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
