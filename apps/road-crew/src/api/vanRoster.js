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

/** The roster could not be read; the picker shows this rather than guessing. */
export class VanRosterError extends Error {
  constructor(message, { status = null, cause = undefined } = {}) {
    super(message);
    this.name = "VanRosterError";
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Reads the active van roster from the first source that answers with one.
 *
 * Never invents a roster: a van picked from a made-up list (`VAN-1`…`VAN-30`)
 * reports as a van Command may not have, and a refusal (401/403) is a reason
 * to show an error, not to offer every number. Throws `VanRosterError` when no
 * source returned a usable roster; returns `[]` only when the Worker says the
 * roster is deliberately hidden.
 */
export async function fetchVanRoster(fetchImpl, paths = []) {
  let lastError = null;
  for (const path of paths) {
    try {
      const response = await fetchImpl(path, {
        cache: "no-cache",
        redirect: "manual",
        headers: { accept: "application/json" },
      });
      if (!response?.ok) {
        const status = Number(response?.status) || null;
        lastError = new VanRosterError(
          status === 401 || status === 403
            ? "This device is not authorized to read the van list."
            : `The van list request failed (${status ?? "no response"}).`,
          { status },
        );
        // A refusal will not be different from the static copy's host.
        if (status === 401 || status === 403) break;
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (payload?.hidden === true) return [];
      const vans = normalizeVans(payload);
      if (vans.length) return vans;
      lastError = new VanRosterError("The van list came back empty.");
    } catch (error) {
      lastError = new VanRosterError("Couldn't reach the server for the van list.", { cause: error });
    }
  }
  throw lastError ?? new VanRosterError("No van list source is configured.");
}
