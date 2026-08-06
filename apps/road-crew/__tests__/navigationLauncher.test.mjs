import { test } from "node:test";
import assert from "node:assert/strict";

import {
  openFirstAvailableUrl,
  openSequenceNavigation,
} from "../src/field/navigationLauncher.ts";

test("URL launcher skips unusable values and stops after the first success", async () => {
  const attempted = [];
  const opened = await openFirstAvailableUrl(async (url) => {
    attempted.push(url);
    if (url === "app://first") throw new Error("App not installed");
  }, ["#", "app://first", "https://fallback.example", "https://fallback.example"]);

  assert.equal(opened, true);
  assert.deepEqual(attempted, ["app://first", "https://fallback.example"]);
});

test("URL launcher resolves false when no candidate can open", async () => {
  assert.equal(await openFirstAvailableUrl(async () => {
    throw new Error("No handler");
  }, ["#", null, ""]), false);
});

test("sequence navigation falls back from the native scheme to a universal link", async () => {
  const attempted = [];
  // Navigation targets the GPS point, so the coordinate is the part that
  // matters here — the street/town are only along for display.
  const sequence = { seq: 5, num_first: 12, street: "Main St", town: "Boston", lat: 42.36, lng: -71.06 };
  const opened = await openSequenceNavigation(async (url) => {
    attempted.push(url);
    if (url.startsWith("comgooglemaps://")) throw new Error("Google Maps is not installed");
  }, sequence, "google");

  assert.equal(opened, true);
  assert.match(attempted[0], /^comgooglemaps:\/\//);
  assert.match(attempted[1], /^https:\/\/www\.google\.com\/maps\/dir\//);
});
