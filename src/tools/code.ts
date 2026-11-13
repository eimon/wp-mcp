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
  id: number; slug: string; link: string; status: string; parent: number; modified: string;
  title: { rendered: string; raw?: string };
  content?: { rendered: string; raw?: string }; // only when requested / from get()
  [field: string]: unknown;
}
type Status = "draft" | "publish" | "pending" | "private" | "future";

declare const wp: {
  pages: {
    /** Search/list pages. Returns only light fields (id, title, slug, link, status, parent, modified)
     *  unless \`fields\` is given — full objects include rendered HTML and can be MBs. */
    list(q?: { search?: string; page?: number; per_page?: number; status?: Status | "any"; fields?: string[] }): Promise<Page[]>;
    /** One page with context=edit. content.raw is the stored source (Fusion Builder shortcodes on Avada,
     *  block markup on Gutenberg) — copy its syntax when writing new content; content.rendered is the HTML output. */
    get(id: number): Promise<Page>;
    /** Creates a page. status defaults to "draft". Max ${MAX_WRITES_PER_EXECUTION} writes per execution. */
    create(p: { title: string; content: string; status?: Status; meta?: Record<string, unknown> }): Promise<Page>;
    update(id: number, p: { title?: string; content?: string; status?: Status; meta?: Record<string, unknown> }): Promise<Page>;
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
`.trim();

const PRELUDE = `
const __call = async (name, args) => JSON.parse(await __host(name, JSON.stringify(args === undefined ? null : args)));
const __fmt = (v) => typeof v === "string" ? v : JSON.stringify(v);
globalThis.console = {
  log: (...a) => __log(a.map(__fmt).join(" ")),
  error: (...a) => __log(a.map(__fmt).join(" ")),
};
globalThis.wp = Object.freeze({
  pages: Object.freeze({
    list: (q) => __call("pages.list", q),
    get: (id) => __call("pages.get", { id }),
    create: (p) => __call("pages.create", p),
    update: (id, p) => __call("pages.update", { ...p, id }),
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
  meta: z.record(z.unknown()).optional(),
});

function buildBindings(client: WordPressClient): Record<string, HostBinding> {
  let writes = 0;
  const countWrite = () => {
    writes += 1;
    if (writes > MAX_WRITES_PER_EXECUTION) {
      throw new Error(`Write limit reached (${MAX_WRITES_PER_EXECUTION} create/update calls per execution).`);
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
        `${MAX_OUTPUT_CHARS} chars. Limits per run: 60 s, 50 API calls, ${MAX_WRITES_PER_EXECUTION} page writes.\n\n` +
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
