import Client from "~/lib/neckdash-client.gen";

export function useDashApiBaseURL() {
  const config = useRuntimeConfig();
  const base = String(import.meta.server
    ? config.neckdashApiInternalBaseUrl
    : config.public.neckdashApiBaseUrl
  ).replace(/\/+$/g, "");
  if (import.meta.client && base.startsWith("/")) {
    return `${window.location.origin}${base}`;
  }
  return base;
}

export function useDashClient() {
  return new Client(useDashApiBaseURL(), {
    fetcher: ((input, init) => fetch(input, { ...init, cache: "no-store" })) as typeof fetch,
    requestInit: { cache: "no-store" },
  });
}
