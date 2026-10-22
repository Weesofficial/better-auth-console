import { HTML, SCRIPT_HASHES, STYLE_HASHES } from "./ui.generated.js";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The console app, one HTML file with its script and styles inline, under a CSP that allows only them. */
export function page(basePath: string, consolePath: string) {
  const csp = [
    "default-src 'none'",
    `script-src ${SCRIPT_HASHES.map((h) => `'${h}'`).join(" ")}`,
    `style-src ${STYLE_HASHES.map((h) => `'${h}'`).join(" ")}`,
    "connect-src 'self'",
    "img-src data: https:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const html = HTML.replace("__AUTH_BASE__", escape(basePath)).replace("__CONSOLE_BASE__", escape(`${basePath}${consolePath}`));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  });
}
