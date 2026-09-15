import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxy = {
  target: "http://127.0.0.1:9100",
  changeOrigin: true,
  rewrite(path: string) {
    if (path.startsWith("/api/models")) return "/models";
    if (path.startsWith("/api/chat")) return "/chat/completions";
    return path;
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", proxy: { "/api": apiProxy } },
  preview: { host: "0.0.0.0", proxy: { "/api": apiProxy } },
});
