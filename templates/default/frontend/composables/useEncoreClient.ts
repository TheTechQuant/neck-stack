import Client from "~/lib/encore-client.gen";

function resolveApiBaseUrl() {
  const config = useRuntimeConfig();
  const publicBaseUrl = String(config.public.apiBaseUrl || "/api");

  if (import.meta.server) {
    return String(config.apiInternalBaseUrl || publicBaseUrl);
  }

  if (publicBaseUrl.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${publicBaseUrl}`;
  }

  return publicBaseUrl;
}

export function useEncoreClient() {
  return new Client(resolveApiBaseUrl());
}
