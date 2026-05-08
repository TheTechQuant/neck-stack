import Client from "~/lib/encore-client.gen";

function normalizeBaseUrl(value: string) {
  return value.length > 1 ? value.replace(/\/+$/g, "") : value;
}

function resolveApiBaseUrl() {
  const config = useRuntimeConfig();
  const publicBaseUrl = normalizeBaseUrl(String(config.public.apiBaseUrl || "/api"));

  if (import.meta.server) {
    return normalizeBaseUrl(String(config.apiInternalBaseUrl || publicBaseUrl));
  }

  if (publicBaseUrl.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${publicBaseUrl}`;
  }

  return publicBaseUrl;
}

export function useEncoreClient() {
  return new Client(resolveApiBaseUrl());
}
