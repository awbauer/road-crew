export const DEFAULT_VAN_IDS = Array.from({ length: 30 }, (_, index) => `VAN-${index + 1}`);

export function defaultVanRoster() {
  return DEFAULT_VAN_IDS.map((vanId) => ({ number: vanId, label: vanId }));
}

function normalizeVans(payload) {
  if (!payload || !Array.isArray(payload.vans)) return [];
  return payload.vans
    .map((item) => {
      const number = typeof item?.number === "string" ? item.number.trim() : String(item?.number ?? "").trim();
      const label = typeof item?.label === "string" ? item.label.trim() : number;
      return number ? { number, label: label || number } : null;
    })
    .filter(Boolean);
}

export async function fetchVanRoster(fetchImpl, paths = []) {
  for (const path of paths) {
    try {
      const response = await fetchImpl(path, {
        cache: "no-cache",
        headers: { accept: "application/json" },
      });
      if (!response?.ok) continue;
      const payload = await response.json().catch(() => null);
      if (payload?.hidden === true) return [];
      const vans = normalizeVans(payload);
      if (vans.length) return vans;
    } catch {
      // Try the next source.
    }
  }
  return defaultVanRoster();
}
