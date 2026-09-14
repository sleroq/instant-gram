---
name: chrome-devtools
description: Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This skill does not apply to `--slim` mode (MCP configuration).
---

## Core Concepts

**Browser lifecycle**: Browser starts automatically on first tool call using a persistent Chrome profile. Configure via CLI args in the MCP server configuration: `npx chrome-devtools-mcp@latest --help`.
Additional tooling can be enabled by providing the following flags:

- For extension tooling, use the `--categoryExtensions` flag.
- For memory tooling, use the `--memoryDebugging` flag.

**Page selection**: Tools operate on the currently selected page. Use `list_pages` to see available pages, then `select_page` to switch context.
**Element interaction**: Use `take_snapshot` to get page structure with element `uid`s. Each element has a unique `uid` for interaction. If an element isn't found, take a fresh snapshot - the element may have been removed or the page changed.

## Workflow Patterns

### Before interacting with a page

1. Navigate: `navigate_page` or `new_page`
2. Wait: `wait_for` to ensure content is loaded if you know what you look for.
3. Snapshot: `take_snapshot` to understand page structure
4. Interact: Use element `uid`s from snapshot for `click`, `fill`, etc.

### Efficient data retrieval

- Use `filePath` parameter for large outputs (screenshots, snapshots, traces)
- Use pagination (`pageIdx`, `pageSize`) and filtering (`types`) to minimize data
- Set `includeSnapshot: false` on input actions unless you need updated page state

### Tool selection

- **Automation/interaction**: `take_snapshot` (text-based, faster, better for automation)
- **Visual inspection**: `take_screenshot` (when user needs to see visual state)
- **Additional details**: `evaluate_script` for data not in accessibility tree

### Parallel execution

You can send multiple tool calls in parallel, but maintain correct order: navigate → wait → snapshot → interact.

### Testing an extension

> **Before proceeding**: Extension tools (`install_extension`, `list_extensions`, etc.) are only available when the MCP server process is started with the `--categoryExtensions` flag. A "connected" MCP status only confirms the handshake; it does not confirm that optional tool categories are enabled.
>
> ```sh
> npx chrome-devtools-mcp@latest --categoryExtensions
> ```
>
> Configuration shapes differ between MCP clients. Inspect the effective launcher, including project wrapper scripts and the running process arguments, rather than assuming a particular config format. If the flag is missing, update the owning configuration or wrapper when authorized; otherwise ask the user to do so. Restart the MCP server or client afterward. Restarting a shared service may interrupt the current tool call.

1. **Install**: Use `install_extension` with the path to the unpacked extension.
2. **Identify**: Get the extension ID from the response or by calling `list_extensions`.
3. **Trigger Action**: Use `trigger_extension_action` to open the extension's configured action, then call `list_pages` again to find any new extension page or side panel.
4. **Open Full-page UI**: If action-triggered page discovery is unreliable and the extension exposes a known page, use `new_page` with `chrome-extension://<id>/<page>`.
5. **Verify Service Worker**: Reacquire its ID from `list_pages`, then use `evaluate_script` with `serviceWorkerId` to check extension state or trigger background actions.
6. **Verify Page Behavior**: Navigate to a page where the extension operates and use `take_snapshot` to check if content scripts injected elements or modified the page correctly.

Extension pages can contain private account data. Do not reproduce sensitive snapshot or screenshot contents when a concise behavioral summary is sufficient.

## Troubleshooting

If `chrome-devtools-mcp` is insufficient, guide users to use Chrome DevTools UI:

- https://developer.chrome.com/docs/devtools
- https://developer.chrome.com/docs/devtools/ai-assistance

After a browser restart or MCP reconnect, page and service-worker IDs are stale. Call `list_extensions` and `list_pages` again before continuing. For `Target closed`, connection-refused, or browser-crash errors, first ensure the browser is running and reconnect, then reacquire all IDs instead of retrying with old ones.

If there are errors launching `chrome-devtools-mcp` or Chrome, refer to https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md.
