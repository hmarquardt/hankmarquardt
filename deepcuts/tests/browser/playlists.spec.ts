import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const fixture = (name: string) => `fixtures/generated/${name}`;

async function ownerKey() {
  const content = await readFile(".dev.vars", "utf8");
  const key = /^OWNER_KEY=([a-f0-9]{64})$/m.exec(content)?.[1];
  if (!key)
    throw new Error("Run npm run setup to create the local-only owner key.");
  return key;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Your access key").fill(await ownerKey());
  await page.getByRole("button", { name: "Open my library" }).click();
  await expect(
    page.getByRole("heading", { name: "Your collection." }),
  ).toBeVisible();
}

async function importAlbum(page: Page, title: string) {
  await page.getByRole("button", { name: "Import album", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import album" });
  await dialog.getByPlaceholder("Album title").fill(title);
  await dialog
    .locator("input[name=files]")
    .setInputFiles([
      fixture("01-first-light.mp3"),
      fixture("02-slow-current.m4a"),
      fixture("03-last-train-home.flac"),
    ]);
  await dialog.getByRole("button", { name: "Add to my collection" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
}

async function openAlbum(page: Page, title: string) {
  await page
    .getByRole("button", { name: `Open ${title}`, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

async function openPlaylists(page: Page) {
  await page
    .getByRole("link", { name: /^Playlists/ })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Playlists.", exact: true }),
  ).toBeVisible();
}

async function openPlaylist(page: Page, title: string) {
  await page
    .getByRole("button", { name: `Open ${title}`, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

async function playlistTrackTitles(page: Page) {
  return page
    .locator(".playlist-track-list .track-meta strong")
    .allTextContents();
}

async function audioTime(page: Page) {
  return page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
}
test("creates, edits, reorders, queues and plays a playlist", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tag = testInfo.project.name === "mobile-chromium" ? "M" : "D";
  const albumTitle = `Playlist source ${tag}`;
  const playlistName = `Night drive ${tag}`;
  const renamed = `Night drive ${tag} edited`;
  await signIn(page);
  await importAlbum(page, albumTitle);
  await openAlbum(page, albumTitle);

  await page
    .getByRole("button", {
      name: "Add First light to a playlist",
      exact: true,
    })
    .click();
  const addDialog = page.getByRole("dialog", {
    name: "Add First light to a playlist",
  });
  await addDialog.getByPlaceholder("Sunday morning").fill(playlistName);
  await addDialog.getByRole("button", { name: "Create and add" }).click();
  await expect(
    page.getByText(`Added “First light” to “${playlistName}”.`),
  ).toBeVisible();
  // The album stays in place; the playlist is a reference, not a copy.
  await expect(
    page.getByRole("heading", { name: albumTitle, exact: true }),
  ).toBeVisible();

  await openPlaylists(page);
  await expect(
    page.getByRole("button", { name: `Open ${playlistName}`, exact: true }),
  ).toBeVisible();
  await openPlaylist(page, playlistName);
  expect(await playlistTrackTitles(page)).toEqual(["First light"]);

  await page.getByRole("button", { name: "Add tracks", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "Add tracks to this playlist",
  });
  // Narrow to this project's album: fixtures share track titles across albums.
  await picker.getByPlaceholder("Songs, artists, albums").fill(albumTitle);
  await picker
    .getByRole("button", { name: "Add Slow current to this playlist" })
    .first()
    .click();
  await picker.getByRole("button", { name: "Done" }).click();
  expect(await playlistTrackTitles(page)).toEqual([
    "First light",
    "Slow current",
  ]);

  await page
    .getByRole("button", { name: "Move Slow current up", exact: true })
    .click();
  await expect
    .poll(() => playlistTrackTitles(page))
    .toEqual(["Slow current", "First light"]);
  // Order survives a reload, so it was persisted rather than local UI state.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: playlistName, exact: true }),
  ).toBeVisible();
  expect(await playlistTrackTitles(page)).toEqual([
    "Slow current",
    "First light",
  ]);

  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename playlist" });
  await rename.getByLabel("Playlist name").fill(renamed);
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Play playlist" }).click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(0.4);
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    /\/api\/tracks\/.+\/audio$/,
  );
  await page.getByRole("button", { name: "Shuffle", exact: true }).click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "Add to queue", exact: true }).click();
  await expect(page.getByText("Added 2 tracks to your queue.")).toBeVisible();
  await page
    .getByRole("button", { name: "Open now playing and queue" })
    .click();
  const player = page.getByRole("dialog", { name: "Now playing and queue" });
  await expect(player.getByText("Your queue")).toContainText("4 tracks");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await page
    .getByRole("button", { name: "Remove Slow current from playlist" })
    .click();
  await expect.poll(() => playlistTrackTitles(page)).toEqual(["First light"]);
  // The original track is untouched and still streamable from its album.
  const library = (await (await page.request.get("/api/library")).json()) as {
    albums: { title: string; tracks: { id: string; title: string }[] }[];
  };
  const album = library.albums.find((item) => item.title === albumTitle);
  const removed = album?.tracks.find((track) => track.title === "Slow current");
  expect(removed).toBeTruthy();
  const media = await page.request.get(`/api/tracks/${removed!.id}/audio`);
  expect(media.status()).toBe(200);
  expect((await media.body()).byteLength).toBeGreaterThan(1000);
  await page
    .getByRole("link", { name: "Library", exact: true })
    .filter({ visible: true })
    .click();
  await openAlbum(page, albumTitle);
  await expect(
    page.locator(".track-list").getByText("Slow current", { exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("playlist-detail.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

async function localFileKeys(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("deepcuts-device-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const request = db.transaction("files").objectStore("files").getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys.map(String);
  });
}

test("downloads a playlist without duplicate audio and plays it offline", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tag = testInfo.project.name === "mobile-chromium" ? "M" : "D";
  const albumTitle = `Offline source ${tag}`;
  const playlistName = `Offline mix ${tag}`;
  await signIn(page);
  await importAlbum(page, albumTitle);
  await openAlbum(page, albumTitle);
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect(page.getByText("On this device")).toBeVisible({
    timeout: 30000,
  });
  expect((await localFileKeys(page)).sort()).toHaveLength(3);

  await page
    .getByRole("button", { name: "Add First light to a playlist", exact: true })
    .click();
  const createDialog = page.getByRole("dialog", {
    name: "Add First light to a playlist",
  });
  await createDialog.getByPlaceholder("Sunday morning").fill(playlistName);
  await createDialog.getByRole("button", { name: "Create and add" }).click();
  await expect(
    page.getByText(`Added “First light” to “${playlistName}”.`),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Add Slow current to a playlist",
      exact: true,
    })
    .click();
  const addDialog = page.getByRole("dialog", {
    name: "Add Slow current to a playlist",
  });
  await addDialog
    .locator(".playlist-picker-row", { hasText: playlistName })
    .click();
  await expect(page.getByText("Added “Slow current”.")).toBeVisible();

  await openPlaylists(page);
  await openPlaylist(page, playlistName);
  expect(await playlistTrackTitles(page)).toEqual([
    "First light",
    "Slow current",
  ]);
  await page.getByRole("button", { name: "Download playlist" }).click();
  await expect(page.getByText("On this device").first()).toBeVisible({
    timeout: 30000,
  });
  // The album already stored these two originals, so nothing was written twice.
  expect((await localFileKeys(page)).sort()).toHaveLength(3);

  await page
    .getByRole("link", { name: /^Downloads/ })
    .filter({ visible: true })
    .click();
  const storage = page.locator(".storage-card");
  await expect(storage).toContainText("1 album");
  await expect(storage).toContainText("1 playlist");
  await expect(
    page.getByRole("heading", { name: "Playlists on this device" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Remove download of ${albumTitle}` })
    .click();
  await expect.poll(() => localFileKeys(page)).toHaveLength(2);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const offlineRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      offlineRequests.push(request.url());
  });
  await context.setOffline(true);
  await context.clearCookies();
  await page.goto("/#playlists");
  await expect(
    page.getByRole("heading", { name: "Playlists.", exact: true }),
  ).toBeVisible();
  await openPlaylist(page, playlistName);
  await page.getByRole("button", { name: "Play First light" }).click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(0.4);
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // A cold reload keeps the same playlist URL and reopens it from IndexedDB.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: playlistName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play Slow current" }).click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(0.4);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(offlineRequests).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("offline-playlist.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("deleting a playlist keeps every original track and album", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tag = testInfo.project.name === "mobile-chromium" ? "M" : "D";
  const albumTitle = `Delete source ${tag}`;
  const playlistName = `Throwaway ${tag}`;
  await signIn(page);
  await importAlbum(page, albumTitle);
  await openAlbum(page, albumTitle);
  await page
    .getByRole("button", {
      name: "Add Last train home to a playlist",
      exact: true,
    })
    .click();
  const addDialog = page.getByRole("dialog", {
    name: "Add Last train home to a playlist",
  });
  await addDialog.getByPlaceholder("Sunday morning").fill(playlistName);
  await addDialog.getByRole("button", { name: "Create and add" }).click();
  await expect(
    page.getByText(`Added “Last train home” to “${playlistName}”.`),
  ).toBeVisible();

  await openPlaylists(page);
  await openPlaylist(page, playlistName);
  await page
    .getByRole("button", { name: "Delete playlist", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: `Delete “${playlistName}”?`,
  });
  await confirm.getByRole("button", { name: "Delete playlist" }).click();
  await expect(
    page.getByRole("heading", { name: "Playlists.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Open ${playlistName}`, exact: true }),
  ).toHaveCount(0);

  const playlists = (await (
    await page.request.get("/api/playlists")
  ).json()) as { playlists: { title: string }[] };
  expect(playlists.playlists.map((playlist) => playlist.title)).not.toContain(
    playlistName,
  );
  const library = (await (await page.request.get("/api/library")).json()) as {
    albums: { title: string; tracks: { id: string; title: string }[] }[];
  };
  const album = library.albums.find((item) => item.title === albumTitle);
  expect(album?.tracks).toHaveLength(3);
  const media = await page.request.get(
    `/api/tracks/${album!.tracks[2].id}/audio`,
  );
  expect(media.status()).toBe(200);
  expect(errors).toEqual([]);
});
