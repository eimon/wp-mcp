# wp-mcp-server

An MCP (Model Context Protocol) server that lets an AI design agent connect to **any** WordPress
site, inspect its real rendered CSS/JS/theme, and create/update pages. It is a standalone,
reusable server — nothing in it is tied to a specific WordPress install; the target site is
configured entirely through environment variables at runtime.

It combines two things:

- WordPress's native REST API (`wp/v2/pages`), authenticated with **Application Passwords**.
- A small companion plugin, `wp-mcp-theme-bridge` (bundled in this repo under
  `wordpress-plugin/wp-mcp-theme-bridge/`), that exposes three extra read-only routes
  (`wp-mcp-bridge/v1/theme-styles`, `wp-mcp-bridge/v1/asset-content` and
  `wp-mcp-bridge/v1/page-templates`) so the agent can see
  exactly which CSS/JS a page actually renders — theme-agnostic, since it parses the real
  rendered HTML instead of relying on `theme.json` (many themes, including Astra, resolve colors
  at PHP runtime, not in static files).

## Prerequisites

- Node.js >= 18 (for global `fetch`)
- A WordPress site with:
  - Application Passwords enabled (WordPress core, no plugin needed for the page tools)
  - The `wp-mcp-theme-bridge` plugin installed and **activated**, if you want `get_theme_styles` /
    `get_asset_content` to work (see below)

## Installing the WordPress-side plugin

`get_theme_styles` and `get_asset_content` need `wp-mcp-theme-bridge` running on the target
WordPress site — it's a regular plugin (not a must-use/`mu-plugins` one), so it needs manual
activation like any other plugin:

1. Copy `wordpress-plugin/wp-mcp-theme-bridge/` from this repo into that site's
   `wp-content/plugins/` directory (git, SFTP, your host's file manager — whatever you already use
   to deploy). The folder must keep its name (`wp-mcp-theme-bridge/`) with
   `wp-mcp-theme-bridge.php` directly inside it.
2. In `wp-admin → Plugins`, find **WP MCP Theme Bridge** and activate it.
3. Verify it: `curl -H "Authorization: Basic <base64 user:app-password>" "https://your-site.com/wp-json/wp-mcp-bridge/v1/theme-styles?path=/"` should return JSON, not a 404.

The four page tools (`list_pages`, `get_page`, `create_page`, `update_page`) and `wp.pages` work
without this plugin — it's only required for the two theme-inspection tools (`wp.theme`, `wp.assets`
in Code Mode).

## Install & build

```bash
cd mcp-server
npm install
npm run build
```

This compiles `src/` to `dist/`. `npm start` runs the built server (`dist/index.js`) directly over
stdio — this is what an MCP client will actually spawn.

## Generating a WordPress Application Password

1. Log into `wp-admin` as a user with the `edit_pages` capability (e.g. an Editor or
   Administrator).
2. Go to **Users → Profile**.
3. Scroll to **Application Passwords**, give it a name (e.g. `wp-mcp-server`), and click
   **Add New Application Password**.
4. Copy the generated password immediately — WordPress only shows it once. It's fine to keep the
   spaces WordPress displays it with; Basic Auth works either way.

## Configuration (environment variables)

| Variable                 | Description                                              |
| ------------------------- | --------------------------------------------------------- |
| `WORDPRESS_URL`           | Base URL of the WordPress site, no trailing slash (e.g. `http://localhost:8080`) |
| `WORDPRESS_USERNAME`      | WordPress username to authenticate as                     |
| `WORDPRESS_APP_PASSWORD`  | The Application Password generated above                  |
| `WP_MCP_MODE`             | Optional. `code` (default: only `execute`), `tools` (only the classic per-endpoint tools) or `both` |

Copy `.env.example` to `.env` and fill it in for local development (`.env` is git-ignored and is
**not** read automatically by the built server — it's there for your own tooling/reference; pass
the variables through your process environment or your MCP client's `env` config, as shown below).

The server validates the three `WORDPRESS_*` variables at startup and exits with a clear error message if any
is missing.

## Registering with an MCP client

### From a local checkout (development)

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/absolute/path/to/wp-mcp-server/dist/index.js"],
      "env": {
        "WORDPRESS_URL": "http://localhost:8080",
        "WORDPRESS_USERNAME": "your-wp-username",
        "WORDPRESS_APP_PASSWORD": "your-application-password"
      }
    }
  }
}
```

Point `args` at the built `dist/index.js` for the WordPress site you want this instance of the
server to manage. To manage a different site, register another entry with different `env` values
— the server itself is stateless and reusable.

### Straight from GitHub (no local checkout, no npm registry)

This package isn't published to the npm registry. Any MCP client that can run a command can still
add it directly from the git repository — `npx` clones it, installs dependencies, runs `prepare`
(which builds `dist/`), then runs the `bin` entry, all in one shot:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "github:eimon/wp-mcp"],
      "env": {
        "WORDPRESS_URL": "https://your-site.example.com",
        "WORDPRESS_USERNAME": "your-wp-username",
        "WORDPRESS_APP_PASSWORD": "your-application-password"
      }
    }
  }
}
```

With the Claude Code CLI specifically:

```bash
claude mcp add wordpress-<site-name> \
  -e WORDPRESS_URL=https://your-site.example.com \
  -e WORDPRESS_USERNAME=your-wp-username \
  -e WORDPRESS_APP_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx' \
  -- npx -y github:eimon/wp-mcp
```

Pin to a tag or commit (`github:eimon/wp-mcp#v0.1.0`) once you cut a release, so a client's config
doesn't silently pick up unreleased changes from the default branch.

## Available tools

### Code Mode (default): `execute`

Instead of one MCP tool per endpoint, the server exposes a single `execute` tool whose description
carries a small TypeScript API (`wp.pages`, `wp.theme`, `wp.assets`). The model writes an async
JavaScript snippet against it; the server runs it in a fresh [QuickJS](https://github.com/justjake/quickjs-emscripten)
WASM sandbox and returns only what the snippet `return`s. This follows Cloudflare's
[Code Mode](https://blog.cloudflare.com/code-mode/) approach:

- **Big payloads stay out of the model's context.** Avada's compiled CSS is ~1 MB and an unfiltered
  `list_pages` is ~450 KB for 10 pages; a snippet that extracts the CSS custom properties and a page
  index returns ~1 KB.
- **Several calls in one round-trip**, including `Promise.all`.
- **Credentials never enter the sandbox.** It has no `fetch`, `require`, `process` or filesystem; its
  only way out is the `wp` object, whose calls are executed by the host with the Application Password.

```js
const s = await wp.theme.styles("/");
const css = (await wp.assets.get(s.stylesheets[0])).content;
const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]));
return { theme: s.theme.name, vars };
```

Per-execution limits: 60 s, 256 MB, 50 API calls, 10 page writes (`create`/`update`), 40 000 output
characters. `wp.pages.list()` returns light fields only unless you pass `fields`. `wp.pages.create`/`update` accept a `template`
(e.g. `"100-width.php"` on Avada); `wp.pages.templates()` lists the ones the active theme offers. The sandbox also
has `base64Encode(text)` (UTF-8 → base64), since QuickJS has no `btoa`.

On Avada sites the bridge plugin registers the `fusion_builder_status` page meta for REST, so the agent
can create pages Fusion Builder treats as its own (`meta: { fusion_builder_status: "active" }`). Avada
then strips the empty `<p>` that `wpautop` leaves around shortcodes and opens the page in its builder.

### Classic tools (`WP_MCP_MODE=tools` or `both`)

| Tool                | Description                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `list_pages`         | List/search WordPress pages (`search`, `page`, `per_page`, `status`)        |
| `get_page`           | Fetch a single page by ID                                                    |
| `create_page`        | Create a new page (`title`, `content` HTML, `status`, optional `template`, `meta`) |
| `update_page`        | Update an existing page by ID (same fields as create, all optional)          |
| `get_theme_styles`   | Inspect a page path's real rendered theme name, stylesheets, scripts, inline CSS/JS |
| `get_asset_content`  | Fetch the raw text content of a same-origin CSS/JS asset URL                 |

## Verifying it works: the smoke test

There's no human clicking through this — `scripts/smoke-test.ts` is the verification. It spawns
the built server as a child process using the official MCP SDK's `Client` + `StdioClientTransport`,
calls `tools/list`, then exercises `get_theme_styles`, `list_pages` and `execute` (including a
check that the sandbox has no `fetch`/`require`/`process`) against a real WordPress instance:

```bash
npm run build
WORDPRESS_URL=http://localhost:8080 \
WORDPRESS_USERNAME=your-wp-username \
WORDPRESS_APP_PASSWORD=your-application-password \
npm run smoke-test
```

It exits non-zero and prints the failure if any tool errors or an expected shape isn't found.

## Agent skill: Avada / Fusion Builder

`skills/avada-fusion-builder/` is a [Claude skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
that teaches an agent to author pages on Avada sites through this server: native Fusion Builder
shortcodes instead of raw HTML, calibrating attribute syntax against real pages, using the site's
`--awb-*` tokens, and the layout/CSS behavior of Avada's rendered DOM (`references/css-integration.md`).

To install it, zip the folder and upload it in claude.ai → Settings → Skills, or copy it into
`~/.claude/skills/` for Claude Code:

```bash
cd skills && zip -r avada-fusion-builder.zip avada-fusion-builder
```

## Troubleshooting

### Silent `rest_not_logged_in` / 401 errors despite correct credentials

On a **non-HTTPS** WordPress site, Application Passwords are silently disabled unless
`wp_get_environment_type()` returns `'local'` — WordPress core requires
`is_ssl() || wp_get_environment_type() === 'local'` before it will accept them
(`wp_is_application_passwords_supported()`). If you point this server at your own local
(non-HTTPS) WordPress install and get `401 rest_not_logged_in` even though the username and
Application Password are correct, this is almost certainly the cause.

Fix it by setting the environment type to `local`, e.g. in `wp-config.php`:

```php
define( 'WP_ENVIRONMENT_TYPE', 'local' );
```

(or the equivalent `WORDPRESS_CONFIG_EXTRA` env var if you're running the official
`wordpress` Docker image.)

### `get_theme_styles` / `get_asset_content` return 404

These two tools depend on the `wp-mcp-theme-bridge` plugin (bundled in this repo under
`wordpress-plugin/`) being installed **and activated** on the target site — see "Installing the
WordPress-side plugin" above. If it isn't, only the four page tools (`list_pages`, `get_page`,
`create_page`, `update_page`) will work.

### 403 / capability errors

Both bridge routes and the page-write routes require the authenticated user to have the
`edit_pages` capability (Editor role or above). Application Passwords authenticate as that
WordPress user, so permissions follow normal WordPress role rules.
