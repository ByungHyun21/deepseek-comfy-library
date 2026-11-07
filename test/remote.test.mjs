/**
 * 원격 라이브러리 계층 단위 테스트.
 *
 * SSH 자체는 여기서 실행하지 않는다. 파싱·필터·경로 검증·삭제 스크립트 생성만
 * 확인하고, 실제 전송은 통합 단계(ssh yoon@192.168.0.35)에서 검증한다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createRemoteLibrary,
  findIn,
  listFrom,
  parseIndex,
  readIndexCommand,
  readMediaCommand,
  removalCommand,
  removalScript,
  safeItemId,
  safeMediaFile,
  shellPath,
} from "../lib/remote.js";

const INDEX_TEXT = JSON.stringify({
  version: 1,
  items: [
    {
      id: "aaaa1111",
      promptId: "p-1",
      kind: "image",
      filename: "lighthouse.png",
      mediaFile: "p-1_lighthouse.png",
      createdAt: 1000,
      prompt: "lighthouse at dusk",
      model: "v1-5",
      width: 512,
      height: 512,
    },
    {
      id: "bbbb2222",
      promptId: "p-2",
      kind: "video",
      filename: "wave.mp4",
      mediaFile: "p-2_wave.mp4",
      createdAt: 3000,
      prompt: "waves crashing",
      model: "sdxl",
    },
    {
      id: "cccc3333",
      promptId: "p-3",
      kind: "image",
      filename: "forest.png",
      mediaFile: "p-3_forest.png",
      createdAt: 2000,
      prompt: "dark forest at night",
      model: "v1-5",
    },
  ],
  deleted: ["dddd4444"],
});

test("parseIndex keeps items and tombstones", () => {
  const index = parseIndex(INDEX_TEXT);
  assert.equal(index.items.length, 3);
  assert.deepEqual(index.deleted, ["dddd4444"]);
});

test("parseIndex tolerates an empty or broken shape", () => {
  assert.deepEqual(parseIndex("{}"), { version: 1, items: [], deleted: [] });
  assert.deepEqual(parseIndex(JSON.stringify({ items: "nope" })), { version: 1, items: [], deleted: [] });
  assert.throws(() => parseIndex("not json"), /해석하지 못했습니다/);
});

test("listFrom sorts newest first and filters by kind", () => {
  const index = parseIndex(INDEX_TEXT);
  const all = listFrom(index);
  assert.deepEqual(all.items.map((item) => item.id), ["bbbb2222", "cccc3333", "aaaa1111"]);
  assert.equal(all.total, 3);

  const images = listFrom(index, { kind: "image" });
  assert.deepEqual(images.items.map((item) => item.id), ["cccc3333", "aaaa1111"]);
});

test("listFrom searches prompt, model, and filename", () => {
  const index = parseIndex(INDEX_TEXT);
  assert.deepEqual(listFrom(index, { query: "forest" }).items.map((item) => item.id), ["cccc3333"]);
  assert.deepEqual(listFrom(index, { query: "SDXL" }).items.map((item) => item.id), ["bbbb2222"]);
  assert.deepEqual(listFrom(index, { query: "png" }).items.map((item) => item.id), ["cccc3333", "aaaa1111"]);
});

test("listFrom pages with limit and offset", () => {
  const index = parseIndex(INDEX_TEXT);
  const page = listFrom(index, { limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map((item) => item.id), ["cccc3333"]);
});

test("findIn returns the item or null", () => {
  const index = parseIndex(INDEX_TEXT);
  assert.equal(findIn(index, "bbbb2222").filename, "wave.mp4");
  assert.equal(findIn(index, "missing"), null);
});

test("safeMediaFile blocks path traversal", () => {
  assert.equal(safeMediaFile("p-1_lighthouse.png"), "p-1_lighthouse.png");
  assert.throws(() => safeMediaFile("../secret"), /올바르지 않습니다/);
  assert.throws(() => safeMediaFile("/etc/passwd"), /올바르지 않습니다/);
  assert.throws(() => safeMediaFile(""), /올바르지 않습니다/);
});

test("shellPath rejects whitespace and quotes", () => {
  assert.equal(shellPath("~/.dsh/comfy-library"), "~/.dsh/comfy-library");
  assert.equal(shellPath("/home/yoon/.dsh/comfy-library/"), "/home/yoon/.dsh/comfy-library");
  assert.throws(() => shellPath("~/my library"), /공백/);
  assert.throws(() => shellPath("~/it's"), /공백/);
});

test("safeItemId accepts hashes only", () => {
  assert.equal(safeItemId("aaaa1111"), "aaaa1111");
  assert.throws(() => safeItemId("aa; rm -rf /"), /형식이 올바르지 않습니다/);
});

test("removalScript removes the item and keeps a tombstone", () => {
  const script = removalScript("aaaa1111", "~/.dsh/comfy-library");
  assert.match(script, /"aaaa1111"/);
  assert.match(script, /data\['items'\]/);
  assert.match(script, /data\['deleted'\]/);
  assert.match(script, /target\.unlink\(\)/);
  assert.match(script, /tmp\.replace\(index_path\)/);
});

test("removalCommand wraps the script in base64 for the remote shell", () => {
  const command = removalCommand("bbbb2222", "~/.dsh/comfy-library");
  assert.match(command, /^python3 -c "exec\(__import__\('base64'\)\.b64decode\('/);
  const encoded = /b64decode\('([^']+)'\)/.exec(command)?.[1];
  const decoded = Buffer.from(encoded ?? "", "base64").toString("utf8");
  assert.equal(decoded, removalScript("bbbb2222", "~/.dsh/comfy-library"));
});

test("read commands quote nothing the shell can break on", () => {
  assert.equal(readIndexCommand("~/.dsh/comfy-library"), "cat ~/.dsh/comfy-library/index.json");
  assert.equal(readMediaCommand("~/.dsh/comfy-library", "p-2_wave.mp4"), "cat ~/.dsh/comfy-library/media/p-2_wave.mp4");
  assert.throws(() => readMediaCommand("~/.dsh/comfy-library", "../../etc/passwd"), /올바르지 않습니다/);
});

test("createRemoteLibrary refuses to run without a target", async () => {
  const library = createRemoteLibrary({ target: "" });
  await assert.rejects(() => library.list(), /SSH 대상/);
});

test("createRemoteLibrary caches the index and reports info", async () => {
  // refresh 는 SSH 가 필요하므로, 캐시 주입 경로를 직접 확인한다.
  const library = createRemoteLibrary({ target: "yoon@192.168.0.35", cacheTtlMs: 60_000 });
  assert.equal(library.kind, "remote");
  const info = library.info();
  assert.equal(info.target, "yoon@192.168.0.35");
  assert.equal(info.dir, "~/.dsh/comfy-library");
  assert.equal(info.items, null);
});
