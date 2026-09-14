import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WordPressApiError, WordPressClient } from "../wordpress-client.js";

function toToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toErrorResult(error: unknown) {
  const message =
    error instanceof WordPressApiError
      ? `WordPress API error (HTTP ${error.status}${error.code ? `, code: ${error.code}` : ""}): ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

export function registerThemeTools(server: McpServer, client: WordPressClient): void {
  server.registerTool(
    "get_theme_styles",
    {
      title: "Get a page's real rendered theme styles",
      description:
        "Inspect the actual rendered HTML of a page path on the connected WordPress site and return its theme name plus " +
        "the stylesheet URLs, script URLs, inline <style> CSS and inline <script> JS it really loads. Theme-agnostic: " +
        "works by parsing the rendered HTML rather than relying on theme.json, so it reflects what a browser truly " +
        "receives (colors resolved by PHP at runtime, page-builder output, etc). Calls the site-local " +
        "wp-mcp-bridge/v1 REST route.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Relative path of the page to inspect, e.g. "/" or "/about/". Defaults to the homepage.'),
      },
    },
    async ({ path }) => {
      try {
        const styles = await client.getThemeStyles(path ?? "/");
        return toToolResult(styles);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_asset_content",
    {
      title: "Get the raw content of a theme CSS/JS asset",
      description:
        "Fetch the raw text content of a CSS or JS asset URL discovered via get_theme_styles. The URL must belong to " +
        "the same host as the connected WordPress site (enforced server-side as a basic SSRF guard). Calls the " +
        "site-local wp-mcp-bridge/v1 REST route.",
      inputSchema: {
        url: z.string().url().describe("Absolute URL of the CSS/JS asset to fetch, as returned by get_theme_styles."),
      },
    },
    async ({ url }) => {
      try {
        const asset = await client.getAssetContent(url);
        return toToolResult(asset);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
