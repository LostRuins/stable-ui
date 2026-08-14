export function buildApiUrl(baseURL: string, endpoint: string): string {
    const trimmedBaseURL = baseURL.trim().replace(/\/+$/, "");
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return trimmedBaseURL.length === 0 ? normalizedEndpoint : `${trimmedBaseURL}${normalizedEndpoint}`;
}
