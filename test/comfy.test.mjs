import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTxt2Img,
  collectImages,
  collectOutputs,
  isModelFile,
  kindOf,
  mediaType,
  normalizeBase,
  safeFilename,
  summarizeGraph,
} from "../lib/comfy.js";

test("normalizeBase trims slashes and rejects unsafe forms", () => {
  assert.equal(normalizeBase("http://127.0.0.1:8188/"), "http://127.0.0.1:8188");
  assert.equal(normalizeBase("http://192.168.0.36:8188/comfy/"), "http://192.168.0.36:8188/comfy");
  assert.throws(() => normalizeBase("ftp://host:1"), /http/);
  assert.throws(() => normalizeBase("http://user:pass@host:8188"), /사용자/);
  assert.throws(() => normalizeBase(""), /비어/);
});

test("buildTxt2Img clamps parameters and fixes the graph links", () => {
  const { graph, meta } = buildTxt2Img({ prompt: "lighthouse", width: 99999, height: 10, steps: 0, count: 99, seed: 42 });
  assert.equal(meta.prompt, "lighthouse");
  assert.equal(meta.width, 4096);
  assert.equal(meta.height, 64);
  assert.equal(meta.steps, 1);
  assert.equal(meta.count, 8);
  assert.equal(meta.seed, 42);
  assert.equal(graph["5"].inputs.batch_size, 8);
  assert.deepEqual(graph["3"].inputs.positive, ["6", 0]);
  assert.deepEqual(graph["3"].inputs.negative, ["7", 0]);
  assert.deepEqual(graph["6"].inputs.clip, ["4", 1]);
  assert.equal(graph["9"].inputs.filename_prefix, "dsh_library");
});

test("summary round-trips a generated graph", () => {
  const { graph, meta } = buildTxt2Img({ prompt: "a fox", negative: "blur", model: "m.safetensors", seed: 7, width: 768, height: 512, steps: 12 });
  const summary = summarizeGraph(graph);
  assert.equal(summary.prompt, "a fox");
  assert.equal(summary.negative, "blur");
  assert.equal(summary.model, "m.safetensors");
  assert.equal(summary.seed, 7);
  assert.equal(summary.width, 768);
  assert.equal(summary.height, 512);
  assert.equal(summary.steps, 12);
  assert.equal(meta.width, 768);
});

test("collectImages finds every output image", () => {
  const entry = { outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] }, "10": { images: [{ filename: "b.png", subfolder: "x", type: "output" }, null] } } };
  assert.deepEqual(collectImages(entry), [
    { node: "9", filename: "a.png", subfolder: "", type: "output" },
    { node: "10", filename: "b.png", subfolder: "x", type: "output" },
  ]);
});

test("collectOutputs classifies image, video, and audio results", () => {
  const entry = { outputs: {
    "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
    "10": { gifs: [{ filename: "motion.mp4", subfolder: "v", type: "output", format: "mp4", frame_rate: 12 }] },
    "11": { audio: [{ filename: "track.flac", subfolder: "", type: "output" }] },
    "12": { images: [{ filename: "clip.webp", subfolder: "", type: "output" }], gifs: [{ filename: "clip.webp", subfolder: "", type: "output" }] },
  } };
  const rows = collectOutputs(entry);
  assert.deepEqual(rows.map((row) => [row.node, row.filename, row.kind]), [
    ["9", "a.png", "image"],
    ["10", "motion.mp4", "video"],
    ["11", "track.flac", "audio"],
    ["12", "clip.webp", "video"],
  ]);
  assert.equal(rows[1].frameRate, 12);
  assert.equal(rows[1].format, "mp4");
});

test("kindOf maps extensions to filter buckets", () => {
  assert.equal(kindOf("a.png"), "image");
  assert.equal(kindOf("a.webp"), "image");
  assert.equal(kindOf("a.gif"), "video");
  assert.equal(kindOf("a.mp4"), "video");
  assert.equal(kindOf("a.webm"), "video");
  assert.equal(kindOf("a.mp3"), "audio");
  assert.equal(kindOf("a.wav"), "audio");
  assert.equal(kindOf("a.flac"), "audio");
  assert.equal(kindOf("noext"), "image");
});

test("isModelFile keeps weights and drops configs and code", () => {
  assert.equal(isModelFile("v1-5-pruned.safetensors"), true);
  assert.equal(isModelFile("model.ckpt"), true);
  assert.equal(isModelFile("lora.pt"), true);
  assert.equal(isModelFile("v1-inference.yaml"), false);
  assert.equal(isModelFile("manager.py"), false);
  assert.equal(isModelFile("README.md"), false);
});

test("filenames stay portable", () => {
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("a:b?.png"), "a_b_.png");
  assert.equal(safeFilename(""), "image.png");
  assert.equal(mediaType("x.jpg"), "image/jpeg");
  assert.equal(mediaType("x.webp"), "image/webp");
  assert.equal(mediaType("x.png"), "image/png");
  assert.equal(mediaType("x.mp4"), "video/mp4");
  assert.equal(mediaType("x.webm"), "video/webm");
  assert.equal(mediaType("x.mp3"), "audio/mpeg");
  assert.equal(mediaType("x.wav"), "audio/wav");
});
