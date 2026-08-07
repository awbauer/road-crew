export function isRemoteBuildNewer(currentBuild, remoteBuild) {
  const current = String(currentBuild || "").trim();
  const remote = String(remoteBuild || "").trim();
  if (!current || !remote) return false;
  if (/^\d+$/.test(current) && /^\d+$/.test(remote)) {
    return BigInt(remote) > BigInt(current);
  }
  return remote.localeCompare(current, undefined, { numeric: true, sensitivity: "base" }) > 0;
}
