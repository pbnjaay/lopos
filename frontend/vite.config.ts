import { execSync } from "node:child_process"

import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim()
  } catch {
    return "dev"
  }
}

function offlineShellPlugin(release: string): Plugin {
  return {
    name: "lopos-offline-shell",
    enforce: "post",
    generateBundle(_options, bundle) {
      const precacheUrls = [...new Set([
        "/index.html",
        ...Object.keys(bundle)
          .filter((fileName) => !fileName.endsWith(".map") && fileName !== "sw.js")
          .map((fileName) => `/${fileName}`),
      ])]
      const source = `const CACHE_NAME = ${JSON.stringify(`lopos-shell-${release}`)};
const CACHE_PREFIX = "lopos-shell-";
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});
`
      this.emitFile({ type: "asset", fileName: "sw.js", source })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const release = env.VITE_SENTRY_RELEASE || gitShortSha()
  return {
    plugins: [react(), offlineShellPlugin(release)],
    // Sentry release: use the explicitly configured value if set, otherwise
    // fall back to the current git SHA — there is no CI to inject one.
    define: {
      "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(
        release,
      ),
    },
    // Readable Sentry stack traces in production. Upload to Sentry (and then
    // remove from dist/) is a separate documented step — see README, not run
    // here to avoid bundling SENTRY_AUTH_TOKEN into the build process.
    build: {
      sourcemap: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  }
})
