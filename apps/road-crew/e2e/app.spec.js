import { expect, test } from "@playwright/test";

test("web field guide skips van install without calling Worker APIs", async ({ page }) => {
  const workerApiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) workerApiRequests.push(request.url());
  });

  await page.goto("/van-install");

  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByText("Road Crew", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(workerApiRequests).toEqual([]);
});

test("deep links load the universal field app and route selection works", async ({ page }) => {
  await page.goto("/home");

  await expect(page.getByText("Road Crew", { exact: true })).toBeVisible();
  const sequencesTile = page.getByRole("button", { name: /Sequences/ }).first();
  await expect(sequencesTile).toBeVisible();

  await sequencesTile.click();
  await expect(page.getByText("Choose a route", { exact: true }).last()).toBeVisible();

  const firstRoute = page.getByText("WOR-MMA", { exact: true });
  await expect(firstRoute).toBeVisible();
  await firstRoute.click();
  await expect(page.getByRole("button", { name: "Change route" })).toBeVisible();
  await expect(page.getByText(/seqs/).first()).toBeVisible();
});

test("sequence list details use the shared centered modal", async ({ page }) => {
  await page.goto("/sequences");
  await page.getByText("WOR-MMA", { exact: true }).click();

  await page.getByRole("button", { name: /Open sequence \d+ details/ }).first().click();
  await expect(page.getByText(/^SEQUENCE \d+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Navigate with Apple Maps" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Navigate with Google Maps" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Navigate with Waze" })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByText(/^SEQUENCE \d+$/)).not.toBeVisible();
});

test("sequence jumps are consumed once and the Cumbys preference persists", async ({ page }) => {
  await page.goto("/home");
  await page.getByLabel("Sequence number").fill("20");
  await page.getByRole("button", { name: "Open sequence on map" }).click();

  await expect(page).toHaveURL(/\/map/);
  const sequencePopup = page.locator(".mb-popup");
  await expect(sequencePopup).toBeVisible();
  await expect(sequencePopup.getByText("Dist next", { exact: true })).toBeVisible();
  await expect(sequencePopup.getByText("0.30 mi", { exact: true })).toBeVisible();
  await expect(sequencePopup.getByText("Riders", { exact: true })).toBeVisible();
  await expect(sequencePopup.getByText("6:58 AM – 8:30 AM", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("sequence")).toBeNull();

  await page.getByRole("button", { name: "Map layers" }).click();
  const cumbys = page.getByRole("button", { name: "Cumbys w/gas" });
  await expect(cumbys).toHaveAttribute("aria-pressed", "false");
  await cumbys.click();
  await expect(cumbys).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("tab", { name: "Home" }).click();
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.locator(".mb-popup")).toHaveCount(0);

  await page.getByRole("button", { name: "Map layers" }).click();
  await expect(page.getByRole("button", { name: "Cumbys w/gas" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Change route" }).click();
  await page.getByText("WEL-DIG", { exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Cumbys w/gas" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mb-popup")).toHaveCount(0);
});

test("tablet sequence jumps open the dedicated combined Route workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/home");
  await page.getByLabel("Sequence number").fill("20");
  await page.getByRole("button", { name: "Open sequence on map" }).click();

  await expect(page).toHaveURL(/\/route/);
  await expect(page.getByRole("button", { name: "Open sequence 20 details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Map" })).toBeVisible();
  await expect(page.locator(".mb-popup")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("sequence")).toBeNull();
});

test("tablet Route sequence cards center the map and open their popup", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/route");
  await page.getByText("WOR-MMA", { exact: true }).click();

  const sequenceCard = page.getByRole("button", { name: /Open sequence \d+ details/ }).first();
  const label = await sequenceCard.getAttribute("aria-label");
  const sequenceNumber = label?.match(/Open sequence (\d+) details/)?.[1];
  expect(sequenceNumber).toBeTruthy();

  await sequenceCard.click();
  await expect(page.locator(".mb-popup").getByText(`SEQ #${sequenceNumber}`, { exact: false })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("sequence")).toBeNull();
});

test("the combined Route workspace redirects phones to Sequences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/route");

  await expect(page).toHaveURL(/\/sequences/);
  await expect(page.getByRole("tab", { name: "Sequences" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Map" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Route" })).toHaveCount(0);
});

test("tablet landscape orders GPS values, Previous, street sign, and Next", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        clearWatch() {},
        watchPosition(onSuccess) {
          setTimeout(() => onSuccess({
            coords: {
              accuracy: 5,
              altitude: null,
              altitudeAccuracy: null,
              heading: 90,
              latitude: 42.23865,
              longitude: -71.80454,
              speed: 2,
            },
            timestamp: Date.now(),
          }), 0);
          return 1;
        },
      },
    });
  });

  await page.goto("/route");
  await page.getByText("WOR-MMA", { exact: true }).click();

  const gpsValues = page.getByTestId("gps-values");
  const previous = page.getByTestId("gps-sequence-previous");
  const sign = page.getByTestId("gps-street-sign");
  const next = page.getByTestId("gps-sequence-next");
  await expect(page.getByTestId("gps-heading")).toHaveText("E");
  await expect(page.getByTestId("gps-speed")).toHaveText("4 mph");
  await expect(previous).toContainText("Prev");
  await expect(sign).toContainText("McCarthy Lane");
  await expect(next).toContainText("Next");

  const [gpsValuesBox, previousBox, signBox, nextBox] = await Promise.all([
    gpsValues.boundingBox(),
    previous.boundingBox(),
    sign.boundingBox(),
    next.boundingBox(),
  ]);
  expect(gpsValuesBox.x + gpsValuesBox.width).toBeLessThanOrEqual(previousBox.x);
  expect(previousBox.x + previousBox.width).toBeLessThanOrEqual(signBox.x);
  expect(signBox.x + signBox.width).toBeLessThanOrEqual(nextBox.x);
});

test("Follow off stays put while Follow on refreshes GPS and overrides scroll holds", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.addInitScript(() => {
    const position = () => ({
      coords: {
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: 90,
        latitude: 42.23865,
        longitude: -71.80454,
        speed: 2,
      },
      timestamp: Date.now(),
    });
    globalThis.__gpsRequestCount = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        clearWatch() {},
        getCurrentPosition(onSuccess) {
          globalThis.__gpsRequestCount += 1;
          setTimeout(() => onSuccess(position()), 0);
        },
        watchPosition(onSuccess) {
          setTimeout(() => onSuccess(position()), 0);
          return 1;
        },
      },
    });
  });

  await page.goto("/route");
  await page.getByText("WOR-MMA", { exact: true }).click();
  await expect(page.getByTestId("gps-sequence-next")).toContainText("Next");

  const highlighted = page.getByRole("button", { name: "Open sequence 2 details" });
  const followToggle = page.getByRole("button", { name: "Toggle follow" });

  const holdFollowAwayFromTarget = async () => {
    await highlighted.evaluate(async (element) => {
      let scroller = element.parentElement;
      while (
        scroller
        && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)
      ) {
        scroller = scroller.parentElement;
      }
      if (!scroller) throw new Error("Sequence list scroller not found");
      scroller.dispatchEvent(new Event("touchstart", { bubbles: true }));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise(requestAnimationFrame);
      }
      scroller.dispatchEvent(new Event("touchend", { bubbles: true }));
    });
    await expect(highlighted).not.toBeInViewport();
  };

  await holdFollowAwayFromTarget();
  await followToggle.click();
  await expect.poll(() => page.evaluate(() => globalThis.__gpsRequestCount)).toBe(1);
  await expect(highlighted).not.toBeInViewport();

  await followToggle.click();
  await expect.poll(() => page.evaluate(() => globalThis.__gpsRequestCount)).toBe(2);
  await expect(highlighted).toBeInViewport();
});

test("the export contains versioned offline route data", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const [routes, version] = await Promise.all([
      fetch("/data/sequences.json"),
      fetch("/js/version.js"),
    ]);
    const payload = await routes.json();
    return {
      routeCount: payload.routes?.length ?? 0,
      versionSource: await version.text(),
    };
  });

  expect(result.routeCount).toBeGreaterThan(0);
  expect(result.versionSource).toContain("globalThis.APP_VERSION");
  expect(result.versionSource).not.toMatch(/\bapp\s*:/);
});

test("the installed field app cold-reloads on a deep link while fully offline", async ({ page, context }) => {
  await page.goto("/home");
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);

  const cached = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
    const keys = await caches.keys();
    const appCache = keys.find((key) => key.startsWith("rc-universal-"));
    const cache = appCache ? await caches.open(appCache) : null;
    const bundlePath = [...document.scripts]
      .map((script) => new URL(script.src).pathname)
      .find((pathname) => pathname.includes("/_expo/static/js/web/"));
    return {
      appCache,
      hasShell: Boolean(await cache?.match("/index.html")),
      hasRoutes: Boolean(await cache?.match("/data/sequences.json")),
      hasPath: Boolean(await cache?.match("/data/paths/day1_route1.json")),
      hasBundle: Boolean(bundlePath && await cache?.match(bundlePath)),
    };
  });
  expect(cached.appCache).toBeTruthy();
  expect(cached.hasShell).toBe(true);
  expect(cached.hasRoutes).toBe(true);
  expect(cached.hasPath).toBe(true);
  expect(cached.hasBundle).toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/sequences");
    await expect(page.getByText("Choose a route", { exact: true }).last()).toBeVisible();
    const routeCount = await page.evaluate(async () => {
      const response = await fetch("/data/sequences.json");
      return (await response.json()).routes?.length ?? 0;
    });
    expect(routeCount).toBeGreaterThan(0);
  } finally {
    await context.setOffline(false);
  }
});

test("the default web launch avoids ArcGIS and stays inside the field performance budget", async ({ page }) => {
  await page.addInitScript(() => {
    window.__rcPerf = { cls: 0, lcp: 0 };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries[entries.length - 1];
      if (latest) window.__rcPerf.lcp = latest.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__rcPerf.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto("/home");
  await expect(page.getByText("Road Crew", { exact: true })).toBeVisible();
  await page.waitForFunction(() => window.__rcPerf.lcp > 0);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    return {
      cls: window.__rcPerf.cls,
      lcp: window.__rcPerf.lcp,
      domContentLoaded: navigation.domContentLoadedEventEnd,
      totalTransferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
      arcGisRequests: resources.filter((entry) => entry.name.includes("js.arcgis.com")).length,
    };
  });

  expect(metrics.arcGisRequests).toBe(0);
  expect(metrics.domContentLoaded).toBeLessThan(5_000);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThan(5_000);
  expect(metrics.cls).toBeLessThan(0.1);
  expect(metrics.totalTransferBytes).toBeLessThan(6_000_000);
});
