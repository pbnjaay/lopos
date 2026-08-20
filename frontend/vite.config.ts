import { execSync } from "node:child_process"

import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim()
  } catch {
    return "dev"
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react()],
    // Sentry release: use the explicitly configured value if set, otherwise
    // fall back to the current git SHA — there is no CI to inject one.
    define: {
      "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(
        env.VITE_SENTRY_RELEASE || gitShortSha(),
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
