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
  const fetcher = (async (input, init) => {
    const method = String(init?.method || "GET").toUpperCase();
    const target = method === "GET" ? cacheBustedURL(input) : input;
    return fetch(target, { ...init, cache: "no-store" });
  }) as typeof fetch;

  return new Client(useDashApiBaseURL(), {
    fetcher,
    requestInit: { cache: "no-store" },
  });
}

function cacheBustedURL(input: RequestInfo | URL) {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw, import.meta.client ? window.location.origin : "http://localhost");
  url.searchParams.set("_neckdash", String(Date.now()));
  return url.toString();
}
