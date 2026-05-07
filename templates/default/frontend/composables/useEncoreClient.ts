import Client from "~/lib/encore-client.gen";

export function useEncoreClient() {
  const config = useRuntimeConfig();
  return new Client(config.public.apiBaseUrl);
}
