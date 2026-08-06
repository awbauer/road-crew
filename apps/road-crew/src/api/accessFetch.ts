import { getCloudflareAccessHeaders } from "@/auth/cloudflareAccess";
import { Platform } from "react-native";

function isWorkerApiRequest(input: RequestInfo | URL): boolean {
  if (Platform.OS !== "web") return false;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://road-crew.invalid";
    const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(value, base).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** Fetch wrapper that adds the locally stored Cloudflare Access headers. */
export async function accessFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (isWorkerApiRequest(input)) {
    throw new Error("Worker API calls are disabled in the web field guide.");
  }
  const headers = new Headers(init.headers);
  const accessHeaders = await getCloudflareAccessHeaders();
  for (const [name, value] of Object.entries(accessHeaders)) headers.set(name, value);
  return fetch(input, { ...init, headers });
}
