export default defineNuxtConfig({
  devtools: { enabled: true },
  ssr: true,
  runtimeConfig: {
    neckdashApiInternalBaseUrl: process.env.NUXT_NECKDASH_API_INTERNAL_BASE_URL || "http://localhost:8080",
    public: {
      neckdashApiBaseUrl: process.env.NUXT_PUBLIC_NECKDASH_API_BASE_URL || "/api",
    },
  },
  app: {
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
  compatibilityDate: "2026-05-08",
});
