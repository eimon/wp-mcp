import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WordPressClient } from "../wordpress-client.js";
import { runInSandbox, type HostBinding } from "../sandbox.js";
import { formatErrorMessage } from "./results.js";

const STATUS = z.enum(["draft", "publish", "pending", "private", "future"]);
const DEFAULT_LIST_FIELDS = ["id", "title", "slug", "link", "status", "parent", "modified"];
const MAX_WRITES_PER_EXECUTION = 10;
const MAX_OUTPUT_CHARS = 40_000;

/**
 * The API the model programs against, shown verbatim in the tool
 * description. Models have seen far more TypeScript than tool-call JSON, and
 * this lets them chain calls and filter large payloads (Avada's compiled CSS
 * is ~1 MB) inside the sandbox instead of through their context window.
 */
const API_TYPES = `
interface Page {
  id: number; slug: string; link: string; status: string; parent: number; modified: string; template: string;
  title: { rendered: string; raw?: string };
  content?: { rendered: string; raw?: string }; // only when requested / from get()
  meta?: Record<string, unknown>; // only meta keys registered with show_in_rest
  [field: string]: unknown;
}
type Status = "draft" | "publish" | "pending" | "private" | "future";
interface MenuItem { id: number; title: string; url: string; parent: number; order: number; type: string; object: string; object_id: number }

declare const wp: {
  pages: {
    /** Search/list pages. Returns only light fields (id, title, slug, link, status, parent, modified)
     *  unless \`fields\` is given — full objects include rendered HTML and can be MBs. */
    list(q?: { search?: string; page?: number; per_page?: number; status?: Status | "any"; fields?: string[] }): Promise<Page[]>;
    /** One page with context=edit. content.raw is the stored source (Fusion Builder shortcodes on Avada,
     *  block markup on Gutenberg) — copy its syntax when writing new content; content.rendered is the HTML output. */
    get(id: number): Promise<Page>;
    /** Creates a page. status defaults to "draft". Max ${MAX_WRITES_PER_EXECUTION} writes per execution.
     *  template: a file from templates() (e.g. "100-width.php" for full width on Avada); "" or omitted = theme default.
     *  meta: WordPress silently drops keys not registered with show_in_rest — check get(id).meta after writing.
     *  WordPress runs wpautop on content: inline elements at the top level of an HTML chunk get wrapped in <p>,
     *  and empty <p></p> can appear between shortcodes (with a real margin). Page builders turn this off through
     *  their own meta (Avada: meta.fusion_builder_status = "active"); otherwise prefer block-level markup. */
    create(p: { title: string; content: string; status?: Status; template?: string; meta?: Record<string, unknown> }): Promise<Page>;
    update(id: number, p: { title?: string; content?: string; status?: Status; template?: string; meta?: Record<string, unknown> }): Promise<Page>;
    /** Page templates the active theme offers, e.g. { file: "100-width.php", name: "100% Width" }.
     *  file "" is the default template. Needs the wp-mcp-theme-bridge plugin. */
    templates(): Promise<{ file: string; name: string }[]>;
  };
  /** Classic WordPress nav menus (what Avada's [fusion_menu] and most themes render). Needs edit_theme_options.
   *  Changes are live on every page that shows the menu. add/update/remove count as writes. */
  menus: {
    list(): Promise<{ id: number; name: string; slug: string; locations: string[]; count?: number }[]>;
    /** Theme locations, e.g. { main_navigation: { name, description, menu: 28 } }. */
    locations(): Promise<Record<string, { name: string; description: string; menu: number }>>;
    /** Items sorted by order; parent 0 = top level. */
    items(menuId: number): Promise<MenuItem[]>;
    /** Link a page ({ pageId }) or a URL ({ url }). title defaults to the page title. */
    addItem(menuId: number, item: { pageId?: number; url?: string; title?: string; parent?: number; order?: number }): Promise<MenuItem>;
    updateItem(id: number, patch: { title?: string; url?: string; parent?: number; order?: number }): Promise<MenuItem>;
    /** Deletes permanently (menu items have no trash). */
    removeItem(id: number): Promise<{ deleted: boolean; id: number }>;
  };
  theme: {
    /** What a page path really renders: theme info, stylesheet/script URLs, inline <style>/<script> contents. */
    styles(path?: string): Promise<{
      inspected_url: string;
      theme: { name: string; stylesheet: string; template: string };
      stylesheets: string[]; scripts: string[]; inline_styles: string[]; inline_scripts: string[];
    }>;
  };
  assets: {
    /** Raw text of a same-site CSS/JS asset (e.g. a URL from theme.styles().stylesheets). Can be very large: extract, don't return. */
    get(url: string): Promise<{ url: string; content_type: string; content: string }>;
  };
};
declare const console: { log(...args: unknown[]): void };
/** UTF-8 text → base64 (the sandbox has no btoa/TextEncoder). E.g. Avada's [fusion_code] body. */
declare function base64Encode(text: string): string;
`.trim();

const PRELUDE = `
const __call = async (name, args) => JSON.parse(await __host(name, JSON.stringify(args === undefined ? null : args)));
const __fmt = (v) => typeof v === "string" ? v : JSON.stringify(v);
globalThis.console = {
  log: (...a) => __log(a.map(__fmt).join(" ")),
  error: (...a) => __log(a.map(__fmt).join(" ")),
};
globalThis.base64Encode = (text) => {
  const bytes = unescape(encodeURIComponent(String(text)));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes.charCodeAt(i) << 16) | ((bytes.charCodeAt(i + 1) || 0) << 8) | (bytes.charCodeAt(i + 2) || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] +
      (i + 1 < bytes.length ? A[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? A[n & 63] : "=");
  }
  return out;
};
globalThis.wp = Object.freeze({
  pages: Object.freeze({
    list: (q) => __call("pages.list", q),
    get: (id) => __call("pages.get", { id }),
    create: (p) => __call("pages.create", p),
    update: (id, p) => __call("pages.update", { ...p, id }),
    templates: () => __call("pages.templates"),
  }),
  menus: Object.freeze({
    list: () => __call("menus.list"),
    locations: () => __call("menus.locations"),
    items: (menuId) => __call("menus.items", { menuId }),
    addItem: (menuId, item) => __call("menus.addItem", { ...item, menuId }),
    updateItem: (id, patch) => __call("menus.updateItem", { ...patch, id }),
    removeItem: (id) => __call("menus.removeItem", { id }),
  }),
  theme: Object.freeze({ styles: (path) => __call("theme.styles", { path }) }),
  assets: Object.freeze({ get: (url) => __call("assets.get", { url }) }),
});
`;

const listArgs = z
  .object({
    search: z.string().optional(),
    page: z.number().int().min(1).optional(),
    per_page: z.number().int().min(1).max(100).optional(),
    status: z.string().optional(),
    fields: z.array(z.string()).optional(),
  })
  .nullable();
const writeArgs = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  status: STATUS.optional(),
  template: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const menuItemArgs = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  parent: z.number().int().min(0).optional(),
  order: z.number().int().min(1).optional(),
});

function toMenuItem(raw: unknown) {
  const i = raw as {
    id: number; title: { raw?: string; rendered: string } | string; url: string; parent: number;
    menu_order: number; type: string; object: string; object_id: number;
  };
  return {
    id: i.id,
    title: typeof i.title === "string" ? i.title : (i.title.raw ?? i.title.rendered),
    url: i.url,
    parent: i.parent,
    order: i.menu_order,
    type: i.type,
    object: i.object,
    object_id: i.object_id,
  };
}

function buildBindings(client: WordPressClient): Record<string, HostBinding> {
  let writes = 0;
  const countWrite = () => {
    writes += 1;
    if (writes > MAX_WRITES_PER_EXECUTION) {
      throw new Error(`Write limit reached (${MAX_WRITES_PER_EXECUTION} writes per execution: page create/update, menu add/update/remove). Split the work into several runs.`);
    }
  };

  return {
    "pages.list": async (args) => {
      const q = listArgs.parse(args) ?? {};
      return client.listPages({ ...q, fields: q.fields ?? DEFAULT_LIST_FIELDS });
    },
    "pages.get": async (args) => client.getPage(z.object({ id: z.number().int().min(1) }).parse(args).id),
    "pages.create": async (args) => {
      const p = writeArgs.extend({ title: z.string().min(1), content: z.string() }).parse(args);
      countWrite();
      return client.createPage({ ...p, status: p.status ?? "draft" });
    },
    "pages.update": async (args) => {
      const { id, ...p } = writeArgs.extend({ id: z.number().int().min(1) }).parse(args);
      countWrite();
      return client.updatePage(id, p);
    },
    "pages.templates": async () => client.listPageTemplates(),
    "menus.list": async () =>
      (await client.listMenus()).map((m) => {
        const { id, name, slug, locations } = m as { id: number; name: string; slug: string; locations: string[] };
        return { id, name, slug, locations };
      }),
    "menus.locations": async () => {
      const raw = (await client.listMenuLocations()) as Record<string, { name: string; description: string; menu: number }>;
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { name: v.name, description: v.description, menu: v.menu }]));
    },
    "menus.items": async (args) => {
      const { menuId } = z.object({ menuId: z.number().int().min(1) }).parse(args);
      return (await client.listMenuItems(menuId)).map(toMenuItem);
    },
    "menus.addItem": async (args) => {
      const item = menuItemArgs
        .extend({ menuId: z.number().int().min(1), pageId: z.number().int().min(1).optional() })
        .refine((i) => Boolean(i.pageId) !== Boolean(i.url), "Pass exactly one of pageId or url.")
        .parse(args);
      countWrite();
      return toMenuItem(
        await client.createMenuItem({
          menus: item.menuId,
          status: "publish",
          ...(item.pageId
            ? { type: "post_type", object: "page", object_id: item.pageId }
            : { type: "custom", url: item.url }),
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.parent !== undefined ? { parent: item.parent } : {}),
          ...(item.order !== undefined ? { menu_order: item.order } : {}),
        }),
      );
    },
    "menus.updateItem": async (args) => {
      const { id, order, ...rest } = menuItemArgs.extend({ id: z.number().int().min(1) }).parse(args);
      countWrite();
      return toMenuItem(await client.updateMenuItem(id, { ...rest, ...(order !== undefined ? { menu_order: order } : {}) }));
    },
    "menus.removeItem": async (args) => {
      const { id } = z.object({ id: z.number().int().min(1) }).parse(args);
      countWrite();
      await client.deleteMenuItem(id);
      return { deleted: true, id };
    },
    "theme.styles": async (args) =>
      client.getThemeStyles(z.object({ path: z.string().nullish() }).parse(args).path ?? "/"),
    "assets.get": async (args) => client.getAssetContent(z.object({ url: z.string().url() }).parse(args).url),
  };
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    text.slice(0, MAX_OUTPUT_CHARS) +
    `\n…[truncated: ${text.length} chars total. Filter or summarize inside your code and return only what you need.]`
  );
}

export function registerCodeTools(server: McpServer, client: WordPressClient): void {
  server.registerTool(
    "execute",
    {
      title: "Run JavaScript against the WordPress site",
      description:
        "Run an async JavaScript snippet in an isolated sandbox (no network, no filesystem) that has a `wp` object " +
        "already authenticated against the connected WordPress site. Use `return` to send a value back, and " +
        "console.log for notes. Chain several calls in one snippet and filter big payloads (page HTML, theme CSS) " +
        "in code — only the returned value reaches you, truncated at " +
        `${MAX_OUTPUT_CHARS} chars. Limits per run: 60 s, 50 API calls, ${MAX_WRITES_PER_EXECUTION} writes (pages + menus).\n\n` +
        "Available API (TypeScript):\n```ts\n" +
        API_TYPES +
        "\n```\n\nExample:\n```js\n" +
        'const s = await wp.theme.styles("/");\n' +
        "const css = (await wp.assets.get(s.stylesheets[0])).content;\n" +
        "const vars = Object.fromEntries([...css.matchAll(/(--[\\w-]+)\\s*:\\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]));\n" +
        "return { theme: s.theme.name, vars };\n```",
      inputSchema: {
        code: z
          .string()
          .min(1)
          .describe("Body of an async function. Use `await` freely and `return` the result."),
      },
    },
    async ({ code }) => {
      const run = await runInSandbox(code, PRELUDE, buildBindings(client), {
        timeoutMs: 60_000,
        memoryBytes: 256 * 1024 * 1024,
        maxHostCalls: 50,
      });

      const parts: string[] = [];
      if (run.logs.length > 0) parts.push(`console:\n${run.logs.join("\n")}`);
      if (run.ok) {
        const value = run.result === undefined ? "(no return value)" : JSON.stringify(run.result, null, 2);
        parts.push(`result:\n${value}`);
      } else {
        parts.push(`error:\n${formatErrorMessage(run.error)}`);
      }

      return {
        ...(run.ok ? {} : { isError: true as const }),
        content: [{ type: "text" as const, text: truncate(parts.join("\n\n")) }],
      };
    },
  );
}
