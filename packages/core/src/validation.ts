// Runtime validation for baked route data. It keeps the app from silently
// accepting malformed sequence bundles after a data refresh.
// Ported verbatim from app/js/validation.js; behavior is intentionally unchanged.

export function validateRouteData(data: unknown): string[] {
  const issues: string[] = [];
  if (!data || typeof data !== "object") {
    return ["Route data payload is missing or invalid."];
  }
  const routes = (data as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    return ["Route data contains no routes."];
  }

  const routeIds = new Set<string>();
  routes.forEach((route: any, routeIndex: number) => {
    const routeLabel = route?.id || `route ${routeIndex + 1}`;
    if (!route?.id) issues.push(`${routeLabel}: missing route id.`);
    if (route?.id && routeIds.has(route.id)) issues.push(`${routeLabel}: duplicate route id.`);
    if (route?.id) routeIds.add(route.id);
    if (!Array.isArray(route?.sequences)) {
      issues.push(`${routeLabel}: missing sequences array.`);
      return;
    }

    const seqs = new Set<number>();
    route.sequences.forEach((seq: any, seqIndex: number) => {
      const seqLabel = `${routeLabel} seq ${seq?.seq ?? seqIndex + 1}`;
      if (seq?.seq == null) issues.push(`${seqLabel}: missing sequence number.`);
      if (seq?.seq != null && seqs.has(seq.seq)) issues.push(`${seqLabel}: duplicate sequence number.`);
      if (seq?.seq != null) seqs.add(seq.seq);
      if ((seq?.lat == null) !== (seq?.lng == null)) issues.push(`${seqLabel}: incomplete coordinates.`);
      if (seq?.lat != null && (!Number.isFinite(seq.lat) || seq.lat < -90 || seq.lat > 90)) {
        issues.push(`${seqLabel}: invalid latitude.`);
      }
      if (seq?.lng != null && (!Number.isFinite(seq.lng) || seq.lng < -180 || seq.lng > 180)) {
        issues.push(`${seqLabel}: invalid longitude.`);
      }
      // Distance-to-next mileage must be numeric when present; gap rows format
      // this with .toFixed(), so a string would blank route intervals.
      if (seq?.miles != null && !Number.isFinite(seq.miles)) {
        issues.push(`${seqLabel}: non-numeric distance-to-next miles.`);
      }
      if (seq?.cum_miles != null && !Number.isFinite(seq.cum_miles)) {
        issues.push(`${seqLabel}: non-numeric cum_miles.`);
      }
    });
  });

  return issues;
}
