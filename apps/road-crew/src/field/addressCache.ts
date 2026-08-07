import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ADDRESS_CACHE_LIMIT,
  addressCacheKey,
  shouldReuseCachedAddress,
  type CachedAddress,
  type ResolvedAddress,
} from "@road-crew/core";

// Every modal open reverse-geocodes, so the cache is what keeps that from
// meaning a Mapbox request per open: a resolved address is reused anywhere
// within 100 yards of where it was looked up, and persists across launches so a
// van that reopens the modal at the same water stop pays nothing. Entries are
// keyed by a rounded coordinate (never the raw float) and re-checked against
// the reuse radius before being handed back.
const KEY = "rc.addressCache";

let memory: Map<string, CachedAddress> | null = null;
let loading: Promise<Map<string, CachedAddress>> | null = null;

async function load(): Promise<Map<string, CachedAddress>> {
  if (memory) return memory;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as [string, CachedAddress][]) : [];
        memory = new Map(Array.isArray(parsed) ? parsed : []);
      } catch {
        memory = new Map();
      }
      return memory;
    })();
  }
  return loading;
}

async function persist(entries: Map<string, CachedAddress>): Promise<void> {
  try {
    // Oldest entries fall off first once the cache is full.
    const sorted = [...entries.entries()].sort((a, b) => b[1].timestampMs - a[1].timestampMs);
    const trimmed = sorted.slice(0, ADDRESS_CACHE_LIMIT);
    if (trimmed.length !== entries.size) memory = new Map(trimmed);
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* best effort — the in-memory copy still serves this session */
  }
}

/** Returns a cached address still valid for this coordinate, else null. */
export async function readCachedAddress(lat: number, lng: number): Promise<ResolvedAddress | null> {
  const entries = await load();
  const exact = entries.get(addressCacheKey(lat, lng));
  if (shouldReuseCachedAddress(exact, lat, lng)) return exact ?? null;
  // A van that crept over a key boundary is still within the reuse radius of
  // the neighbouring entry, so fall back to a scan before spending a request.
  for (const entry of entries.values()) {
    if (shouldReuseCachedAddress(entry, lat, lng)) return entry;
  }
  return null;
}

export async function writeCachedAddress(lat: number, lng: number, address: ResolvedAddress): Promise<void> {
  const entries = await load();
  entries.set(addressCacheKey(lat, lng), { ...address, lat, lng, timestampMs: Date.now() });
  await persist(entries);
}

/** Test/reset seam — drops the in-memory copy so the next read re-loads. */
export function resetAddressCacheMemory(): void {
  memory = null;
  loading = null;
}
