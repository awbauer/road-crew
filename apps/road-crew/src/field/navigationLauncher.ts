import {
  cumberlandFarmNavigationHref,
  cumberlandFarmNavigationScheme,
  navigationHref,
  navigationScheme,
} from "@road-crew/core";
import type { CumberlandFarm, Sequence } from "@road-crew/contracts";
import type { NavProvider } from "./Settings.tsx";

export type UrlOpener = (url: string) => Promise<unknown>;

function usableUrls(urls: readonly (string | null | undefined)[]): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url && url !== "#")))];
}

/** Tries app schemes first, then universal links, without leaking a rejected promise. */
export async function openFirstAvailableUrl(
  opener: UrlOpener,
  urls: readonly (string | null | undefined)[],
): Promise<boolean> {
  for (const url of usableUrls(urls)) {
    try {
      await opener(url);
      return true;
    } catch {
      // Continue to the next compatible URL.
    }
  }
  return false;
}

export function openSequenceNavigation(
  opener: UrlOpener,
  sequence: Sequence,
  provider: NavProvider,
): Promise<boolean> {
  return openFirstAvailableUrl(opener, [
    navigationScheme(sequence, provider),
    navigationHref(sequence, provider),
  ]);
}

export function openCumberlandFarmNavigation(
  opener: UrlOpener,
  farm: CumberlandFarm,
  provider: NavProvider,
): Promise<boolean> {
  return openFirstAvailableUrl(opener, [
    cumberlandFarmNavigationScheme(farm, provider),
    cumberlandFarmNavigationHref(farm, provider),
  ]);
}
