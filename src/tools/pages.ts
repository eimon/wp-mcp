import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress-client.js";
import { toErrorResult, toToolResult } from "./results.js";

export function registerPageTools(server: McpServer, client: WordPressClient): void {
  server.registerTool(
    "list_pages",
    {
      title: "List WordPress pages",
      description:
        "List/search pages on the connected WordPress site via GET /wp-json/wp/v2/pages. Supports search, pagination and status filtering.",
      inputSchema: {
        search: z.string().optional().describe("Free-text search term to filter pages by title/content."),
        page: z.number().int().min(1).optional().describe("1-based page number for pagination."),
        per_page: z.number().int().min(1).max(100).optional().describe("Number of results per page (max 100)."),
        status: z
          .string()
          .optional()
          .describe('Page status filter, e.g. "publish", "draft", "any". Defaults to WordPress\'s default (publish).'),
      },
    },
    async (args) => {
      try {
        const pages = await client.listPages(args);
        return toToolResult(pages);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Get a WordPress page",
      description:
        "Fetch a single page by ID via GET /wp-json/wp/v2/pages/<id>?context=edit. Returns both content.rendered (compiled HTML/output) and content.raw (the actual stored source — e.g. real Fusion Builder shortcodes on an Avada site, or Gutenberg block markup) — use content.raw to learn a site's real authoring syntax before writing new content.",
      inputSchema: {
        id: z.number().int().min(1).describe("The numeric WordPress page ID."),
      },
    },
    async ({ id }) => {
      try {
        const page = await client.getPage(id);
        return toToolResult(page);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a WordPress page",
      description:
        "Create a new page via POST /wp-json/wp/v2/pages. `content` is an HTML string. Requires edit_pages capability on the authenticated user. " +
        "WordPress runs wpautop on content (stray/empty <p> around shortcodes and inline elements) unless a page builder disables it via its own meta; " +
        "`meta` keys not registered with show_in_rest are silently dropped.",
      inputSchema: {
        title: z.string().min(1).describe("The page title."),
        content: z.string().describe("The page body as an HTML string."),
        status: z
          .enum(["draft", "publish", "pending", "private", "future"])
          .optional()
          .describe('Publication status. Defaults to "draft" if omitted.'),
        template: z
          .string()
          .optional()
          .describe(
            'Theme page template file, e.g. "100-width.php" (Avada full width). "" = theme default. Invalid values are rejected by WordPress with the list of valid ones.',
          ),
        meta: z.record(z.unknown()).optional().describe("Optional meta fields object to attach to the page."),
      },
    },
    async (args) => {
      try {
        const page = await client.createPage({
          title: args.title,
          content: args.content,
          status: args.status ?? "draft",
          template: args.template,
          meta: args.meta,
        });
        return toToolResult(page);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    "update_page",
    {
      title: "Update a WordPress page",
      description:
        "Update an existing page via POST /wp-json/wp/v2/pages/<id>. Only the fields provided are sent; omit a field to leave it unchanged.",
      inputSchema: {
        id: z.number().int().min(1).describe("The numeric WordPress page ID to update."),
        title: z.string().optional().describe("New page title."),
        content: z.string().optional().describe("New page body as an HTML string."),
        status: z
          .enum(["draft", "publish", "pending", "private", "future"])
          .optional()
          .describe("New publication status."),
        template: z
          .string()
          .optional()
          .describe(
            'Theme page template file, e.g. "100-width.php" (Avada full width). "" = theme default. Invalid values are rejected by WordPress with the list of valid ones.',
          ),
        meta: z.record(z.unknown()).optional().describe("Meta fields object to merge/update on the page."),
      },
    },
    async ({ id, ...payload }) => {
      try {
        const page = await client.updatePage(id, payload);
        return toToolResult(page);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
