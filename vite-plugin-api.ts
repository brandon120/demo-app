import type { Plugin } from "vite";
import { handleApiRequest } from "./server/api";

function normalizeApiPath(url: string, base: string): string | null {
  const [pathname, search = ""] = url.split("?");
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  let apiPath = pathname;

  if (normalizedBase && normalizedBase !== "/" && pathname.startsWith(normalizedBase)) {
    apiPath = pathname.slice(normalizedBase.length);
  }

  if (!apiPath.startsWith("/api/")) {
    return null;
  }

  return search ? `${apiPath}?${search}` : apiPath;
}

export function apiPlugin(): Plugin {
  return {
    name: "demo-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const apiUrl = normalizeApiPath(req.url, server.config.base);
        if (!apiUrl) {
          next();
          return;
        }

        const url = new URL(apiUrl, "http://localhost");
        const handled = await handleApiRequest(req, res, url);
        if (!handled) {
          next();
        }
      });
    },
  };
}
