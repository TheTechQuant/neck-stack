export function useDashApi() {
  const config = useRuntimeConfig();
  const baseURL = import.meta.server
    ? config.neckdashApiInternalBaseUrl
    : config.public.neckdashApiBaseUrl;

  return <T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) => {
    return $fetch<T>(path, { baseURL, ...options });
  };
}
