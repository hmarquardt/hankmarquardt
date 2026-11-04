import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const fixture = (name: string) => path.resolve("fixtures/generated", name);
async function ownerKey() {
  const content = await readFile(".dev.vars", "utf8");
  const key = /^OWNER_KEY=([a-f0-9]{64})$/m.exec(content)?.[1];
  if (!key)
    throw new Error("Run npm run setup to create the local-only owner key.");
  return key;
}
test("API and byte streams stay private; cross-origin mutations fail closed", async ({
  request,
}) => {
  for (const endpoint of [
    "/api/library",
    "/api/imports",
    "/api/playlists",
    "/api/playlists/example",
    "/api/state",
    "/api/tracks/example/audio",
    "/api/albums/example/artwork",
  ]) {
    const response = await request.get(endpoint);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  const response = await request.post("/api/login", {
    headers: { Origin: "https://untrusted.example" },
    data: { key: "wrong" },
  });
  expect(response.status()).toBe(403);
});

test("imports originals, streams every codec, manages queue, and launches and plays offline", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your music. A little closer." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("welcome.png"),
    fullPage: true,
  });
  await page.getByLabel("Your access key").fill(await ownerKey());
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(
    page.getByRole("heading", { name: "Your collection." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import album", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import album" });
  await expect(dialog.getByPlaceholder("Album title")).toBeFocused();
  const albumTitle =
    testInfo.project.name === "mobile-chromium"
      ? "The Quiet Hours"
      : "The Quiet Hours, Vol. II";
  if (testInfo.project.name !== "mobile-chromium") {
    await dialog.getByPlaceholder("Album title").fill(albumTitle);
  }
  await dialog
    .locator("input[name=files]")
    .setInputFiles([
      fixture("01-first-light.mp3"),
      fixture("02-slow-current.m4a"),
      fixture("03-last-train-home.flac"),
    ]);
  await dialog.getByRole("button", { name: "Add to my collection" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: `Open ${albumTitle}`, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: albumTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: `${albumTitle} cover` }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const albums = (await (await page.request.get("/api/library")).json()) as {
    albums: {
      id: string;
      title: string;
      tracks: { id: string; filename: string; bytes: number }[];
    }[];
  };
  const album = albums.albums.find((a) => a.title === albumTitle)!;
  expect(album.tracks.length).toBe(3);
  for (const track of album.tracks) {
    const original = await readFile(fixture(track.filename));
    const streamed = await page.request.get(`/api/tracks/${track.id}/audio`);
    expect(streamed.status()).toBe(200);
    expect(await streamed.body()).toEqual(original);
    const range = await page.request.get(`/api/tracks/${track.id}/audio`, {
      headers: { Range: "bytes=16-63" },
    });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(original.subarray(16, 64));
    expect(range.headers()["content-range"]).toBe(
      `bytes 16-63/${original.length}`,
    );
  }
  for (const title of ["First light", "Slow current", "Last train home"]) {
    await page
      .getByRole("button", { name: `Play ${title}`, exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(0.25);
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Play First light", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.25);
  await page
    .getByRole("button", { name: "Open now playing and queue" })
    .click();
  const nowPlaying = page.getByRole("dialog", {
    name: "Now playing and queue",
  });
  await nowPlaying.getByRole("slider", { name: "Seek in track" }).fill("3");
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(2.9);
  await nowPlaying
    .getByRole("button", { name: "Next queued track", exact: true })
    .click();
  await expect(
    nowPlaying.getByRole("heading", { name: "Slow current", exact: true }),
  ).toBeVisible();
  await nowPlaying
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  await nowPlaying.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add First light to queue" }).click();
  await page
    .getByRole("button", { name: "Open now playing and queue" })
    .click();
  await expect(page.getByText("4 tracks", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove queued track 4" }).click();
  await expect(page.getByText("3 tracks", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add Slow current to queue" }).click();
  await page
    .getByRole("button", { name: "Open now playing and queue" })
    .click();
  await nowPlaying
    .locator(".queue-list > li")
    .last()
    .getByRole("button", { name: "Slow current", exact: true })
    .click();
  await expect(
    nowPlaying.locator(".queue-list > li.current-track"),
  ).toHaveCount(1);
  await expect(nowPlaying.locator(".queue-list > li").last()).toHaveClass(
    "current-track",
  );
  await nowPlaying
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByText("On this device", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("album.png"),
    fullPage: true,
  });
  await page.goto("/#search");
  await page.getByRole("searchbox").fill("First light");
  await expect(
    page.getByRole("button", { name: `Open ${albumTitle}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("a song that does not exist");
  await expect(
    page.getByRole("heading", { name: "No records found." }),
  ).toBeVisible();
  await page.goto("/#downloads");
  await expect(
    page.getByRole("heading", { name: "Made for offline." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByText("Every track verified. Your originals are intact."),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("downloads.png"),
    fullPage: true,
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const cacheKeys = await page.evaluate(async () => {
    const result: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        result.push(new URL(request.url).pathname);
    return result;
  });
  expect(cacheKeys).toContain("/index.html");
  expect(cacheKeys.some((key) => key.startsWith("/api/"))).toBe(false);
  // Removing the session proves that offline listening has no server-auth dependency.
  await context.clearCookies();
  await context.setOffline(true);
  const offlineRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) offlineRequests.push(request.url());
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Made for offline." }),
  ).toBeVisible();
  await expect(
    page.getByText("You’re offline. Your downloaded records are right here."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Open ${albumTitle}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Play First light", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.4);
  expect(await page.locator("audio").getAttribute("src")).toMatch(/^blob:/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("offline-playback.png"),
    fullPage: true,
  });
  expect(offlineRequests).toEqual([]);
  // Simulate storage corruption and ensure verification detects it.
  await page.evaluate(async (trackId) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("deepcuts-device-v1");
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(
          { blob: new Blob(["corrupted"]), sha256: "wrong" },
          trackId,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, album.tracks[0].id);
  await page.goto("/#downloads");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByText(
      "This download failed its integrity check. Remove and download the album again.",
    ),
  ).toBeVisible();
  expect(offlineRequests).toEqual([]);
  await page
    .getByRole("button", { name: `Remove download of ${albumTitle}` })
    .click();
  await expect(
    page.getByRole("heading", { name: "No downloads on this device yet." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("offline sign-out removes device state and prevents silent session restoration", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("Your access key").fill(await ownerKey());
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(
    page.getByRole("heading", { name: "Your collection." }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  const logout = page
    .getByRole("button", { name: /Sign out/ })
    .filter({ visible: true });
  await logout.click();
  await expect(
    page.getByRole("heading", { name: "No downloads on this device yet." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("deepcuts-pending-logout")),
  ).toBe("1");
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open my library" }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  expect(
    await page.evaluate(() => localStorage.getItem("deepcuts-pending-logout")),
  ).toBeNull();
});
