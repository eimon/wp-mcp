/**
 * Thin wrapper around WordPress's REST API (core `wp/v2` routes plus the
 * site-local `wp-mcp-bridge/v1` routes exposed by the wp-mcp-theme-bridge
 * must-use plugin). Authenticates via HTTP Basic Auth using an Application
 * Password, as documented at:
 * https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
 */

export interface WordPressConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Shape WordPress uses for REST API errors, e.g. { code, message, data }.
 * The site-local wp-mcp-bridge/v1 routes (theme-styles, asset-content) don't
 * follow that convention and instead return { error: "..." } — both shapes
 * are handled below so neither source of errors gets swallowed.
 */
interface WordPressErrorBody {
  code?: string;
  message?: string;
  error?: string;
  data?: unknown;
}

export class WordPressApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "WordPressApiError";
  }
}

export interface ListPagesParams {
  search?: string;
  page?: number;
  per_page?: number;
  status?: string;
  /** Maps to WordPress's `_fields`, e.g. ["id", "title"]. Omit for full objects. */
  fields?: string[];
}

export interface PagePayload {
  title?: string;
  content?: string;
  status?: "draft" | "publish" | "pending" | "private" | "future";
  meta?: Record<string, unknown>;
}

export interface ThemeStylesResult {
  inspected_url: string;
  theme: {
    name: string;
    stylesheet: string;
    template: string;
  };
  stylesheets: string[];
  scripts: string[];
  inline_styles: string[];
  inline_scripts: string[];
}

export interface AssetContentResult {
  url: string;
  content_type: string;
  content: string;
}

/**
 * Reads and validates the three required env vars. Call this once at
 * startup; it exits the process with a clear message if anything is
 * missing, since a partially-configured server can't do anything useful.
 */
export function loadWordPressConfigFromEnv(): WordPressConfig {
  const baseUrl = process.env.WORDPRESS_URL;
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;

  const missing: string[] = [];
  if (!baseUrl) missing.push("WORDPRESS_URL");
  if (!username) missing.push("WORDPRESS_USERNAME");
  if (!appPassword) missing.push("WORDPRESS_APP_PASSWORD");

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[wp-mcp-server] Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "Set them in your environment or in mcp-server/.env before starting the server.\n" +
        "See .env.example for the expected shape.",
    );
    process.exit(1);
  }

  return {
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    username: username!,
    appPassword: appPassword!,
  };
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: WordPressConfig) {
    this.baseUrl = config.baseUrl;
    const token = Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const rawBody = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      parsedBody = rawBody;
    }

    if (!response.ok) {
      const errorBody = (typeof parsedBody === "object" && parsedBody !== null
        ? (parsedBody as WordPressErrorBody)
        : {}) as WordPressErrorBody;
      const message =
        errorBody.message ??
        errorBody.error ??
        (typeof parsedBody === "string" && parsedBody.length > 0
          ? parsedBody
          : `WordPress request failed with HTTP ${response.status}`);
      throw new WordPressApiError(message, response.status, errorBody.code, errorBody.data);
    }

    return parsedBody as T;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    return qs ? `?${qs}` : "";
  }

  // ---- wp/v2 pages ----------------------------------------------------

  async listPages(params: ListPagesParams = {}): Promise<unknown[]> {
    const query = this.buildQuery({
      search: params.search,
      page: params.page,
      per_page: params.per_page,
      status: params.status,
      _fields: params.fields?.join(","),
    });
    return this.request<unknown[]>(`/wp-json/wp/v2/pages${query}`);
  }

  async getPage(id: number): Promise<unknown> {
    // context=edit is required to get content.raw (the actual stored
    // shortcodes/HTML) instead of only content.rendered (post-processed
    // output, e.g. Fusion Builder shortcodes already expanded into HTML) —
    // needed to calibrate real page-builder syntax from an existing page.
    return this.request<unknown>(`/wp-json/wp/v2/pages/${id}?context=edit`);
  }

  async createPage(payload: PagePayload): Promise<unknown> {
    return this.request<unknown>("/wp-json/wp/v2/pages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updatePage(id: number, payload: PagePayload): Promise<unknown> {
    return this.request<unknown>(`/wp-json/wp/v2/pages/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async deletePage(id: number, force = true): Promise<unknown> {
    return this.request<unknown>(`/wp-json/wp/v2/pages/${id}?force=${force}`, {
      method: "DELETE",
    });
  }

  // ---- wp-mcp-bridge/v1 -------------------------------------------------

  async getThemeStyles(path = "/"): Promise<ThemeStylesResult> {
    const query = this.buildQuery({ path });
    return this.request<ThemeStylesResult>(`/wp-json/wp-mcp-bridge/v1/theme-styles${query}`);
  }

  async getAssetContent(url: string): Promise<AssetContentResult> {
    const query = this.buildQuery({ url });
    return this.request<AssetContentResult>(`/wp-json/wp-mcp-bridge/v1/asset-content${query}`);
  }
}
