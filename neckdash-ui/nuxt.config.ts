export default defineNuxtConfig({
  devtools: { enabled: true },
  ssr: false,
  runtimeConfig: {
    neckdashApiInternalBaseUrl: process.env.NUXT_NECKDASH_API_INTERNAL_BASE_URL || "http://localhost:8080",
    public: {
      neckdashApiBaseUrl: process.env.NUXT_PUBLIC_NECKDASH_API_BASE_URL || "http://localhost:8080",
      signozBaseUrl: process.env.NUXT_PUBLIC_SIGNOZ_BASE_URL || "/__neck_dash/signoz",
    },
  },
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "NECK Dash",
      htmlAttrs: { lang: "en" },
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "Self-hosted Encore observability dashboard for NECK stack deployments." },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  routeRules: {
    "/**": {
      headers: {
        "cache-control": "no-store",
      },
    },
  },
  compatibilityDate: "2026-05-08",
});
