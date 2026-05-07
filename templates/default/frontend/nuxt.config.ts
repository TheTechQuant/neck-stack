const encoreToolbarEnabled = process.env.NUXT_PUBLIC_ENCORE_TOOLBAR !== "false";
const encoreToolbarEnvName = process.env.NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME
  || (process.env.NODE_ENV === "production" ? "production" : "local");
const encoreToolbarSrc = process.env.NUXT_PUBLIC_ENCORE_TOOLBAR_SRC
  || `https://encore.dev/encore-toolbar.js?appId=__APP_ID__&envName=${encodeURIComponent(encoreToolbarEnvName)}`;

export default defineNuxtConfig({
  compatibilityDate: "__CURRENT_DATE__",
  devtools: { enabled: true },
  modules: ["@nuxt/scripts"],
  scripts: {
    globals: encoreToolbarEnabled
      ? {
          encoreToolbar: [
            { src: encoreToolbarSrc, defer: false, async: false },
            {
              trigger: "server",
              bundle: false,
              proxy: false,
              warmupStrategy: false,
            },
          ],
        }
      : {},
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || "http://localhost:4000",
    },
  },
  nitro: {
    preset: "node-server",
  },
});
