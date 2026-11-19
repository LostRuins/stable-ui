import { useOptionsStore } from "@/stores/options";

export function buildApiUrl(baseURL: string, endpoint: string): string {
    const trimmedBaseURL = baseURL.trim().replace(/\/+$/, "");
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return trimmedBaseURL.length === 0 ? normalizedEndpoint : `${trimmedBaseURL}${normalizedEndpoint}`;
}

export function fetchApi(endpoint: string, init?: RequestInit): Promise<Response> {
    const { baseURL, apiKey } = useOptionsStore();
    const headers = new Headers(init?.headers);
    if (apiKey.trim()) {
        headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }
    return fetch(buildApiUrl(baseURL, endpoint), { ...init, headers });
}
