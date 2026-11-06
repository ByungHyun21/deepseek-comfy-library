/**
 * deepseek-comfy-library — 호스트 반쪽.
 *
 *  1. ComfyUI(기본은 상시 SSH 터널 127.0.0.1:8188)에 그래프를 제출하고 결과를 거둔다.
 *  2. 결과 이미지를 `$DSH_HOME/comfy-library/media` 에 내려 받고 `index.json` 에 남긴다.
 *  3. `/comfy-library/api/*` 로 갤러리 화면과 도구에 목록·생성·상태·가져오기를 내어준다.
 *
 * 화면은 lib/client.js 가 슬롯에 붙이고, 이 파일은 브라우저를 모른다.
 * ComfyUI /history 는 휘발성이므로 라이브러리 인덱스가 원본이다.
 */

import z from "@deepseek-ai/schemastery";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import {
  buildTxt2Img,
  collectOutputs,
  DEFAULT_NEGATIVE,
  fetchJson,
  jobState,
  kindOf,
  listModels,
  mediaType,
  normalizeBase,
  probe,
  resolveCheckpoint,
  safeFilename,
  submitPrompt,
  summarizeGraph,
  withCheckpoint,
} from "../lib/comfy.js";

export const name = "deepseek-comfy-library";
export const inject = ["webServer"];

export const Config = z.object({
  /** 평소 ComfyUI 주소. 상시 터널이면 127.0.0.1:8188, 같은 LAN이면 192.168.0.36:8188. */
  baseUrl: z.string().default("http://127.0.0.1:8188").volatile(),
  /** ComfyUI 왕복 전체 상한 (ms). */
  timeoutMs: z.natural().min(1000).max(120000).default(20000).volatile(),
  /** 갤러리를 열 때 새 결과를 조용히 가져올지. */
  autoSync: z.boolean().default(true).volatile(),
  /** 매번 고르지 않을 기본 체크포인트. 비우면 서버의 첫 모델을 쓴다. */
  defaultModel: z.string().default("").volatile(),
});

const ROUTE = "/comfy-library";
const MAX_BODY = 1024 * 1024;
const SYNC_COOLDOWN_MS = 45_000;
const SYNC_LIMIT = 100;

class ValidationError extends Error {}

function readField(field, fallback) {
  const raw = field && typeof field.get === "function" ? field.get() : field;
  return raw === undefined || raw === null || raw === "" ? fallback : raw;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

function readJson(req, limitBytes = MAX_BODY) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

/** 라이브러리 인덱스와 미디어 파일을 소유하는 작은 저장소. */
function createLibrary(root) {
  const mediaDir = path.join(root, "media");
  const indexPath = path.join(root, "index.json");

  const ensure = () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    if (!fs.existsSync(indexPath)) writeJson(indexPath, { version: 1, items: [], deleted: [] });
  };

  const read = () => {
    ensure();
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (!parsed || !Array.isArray(parsed.items)) return { version: 1, items: [], deleted: [] };
      return {
        version: 1,
        items: parsed.items,
        // 지운 항목은 자리표시자로 남겨, ComfyUI history 동기화가 되살리지 못하게 한다.
        deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
      };
    } catch {
      return { version: 1, items: [], deleted: [] };
    }
  };

  const write = (index) => writeJson(indexPath, { version: 1, items: index.items, deleted: index.deleted ?? [] });

  const list = ({ query = "", kind = "", limit = 60, offset = 0 } = {}) => {
    const needle = String(query).trim().toLowerCase();
    const wanted = String(kind).trim().toLowerCase();
    const all = read().items.slice().sort((a, b) => b.createdAt - a.createdAt);
    const matching = wanted === "" || wanted === "all"
      ? all
      : all.filter((item) => (item.kind ?? kindOf(item.filename)) === wanted);
    const filtered = needle === "" ? matching : matching.filter((item) =>
      [item.prompt, item.negative, item.model, item.filename].some((value) => String(value ?? "").toLowerCase().includes(needle)));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  };

  const find = (id) => read().items.find((item) => item.id === id) ?? null;

  const isDeleted = (id) => read().deleted.includes(id);

  const remove = (id) => {
    const index = read();
    const item = index.items.find((entry) => entry.id === id);
    if (!item) return false;
    index.items = index.items.filter((entry) => entry.id !== id);
    if (!index.deleted.includes(id)) index.deleted = [...index.deleted, id].slice(-1000);
    write(index);
    const file = path.join(mediaDir, item.mediaFile);
    try { fs.unlinkSync(file); } catch { /* 이미 지워졌으면 그대로 둔다 */ }
    return true;
  };

  const add = (item) => {
    const index = read();
    if (index.deleted.includes(item.id)) return null;
    if (!index.items.some((entry) => entry.id === item.id)) index.items.push(item);
    write(index);
    return item;
  };

  const saveMedia = (promptId, filename, bytes) => {
    ensure();
    const mediaFile = `${promptId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 16)}_${safeFilename(filename)}`;
    fs.writeFileSync(path.join(mediaDir, mediaFile), bytes);
    return mediaFile;
  };

  const mediaPath = (item) => path.join(mediaDir, item.mediaFile);

  return { root, mediaDir, indexPath, list, find, remove, add, saveMedia, mediaPath, isDeleted };
}

/** One output row shaped for the browser and tools. */
function publicItem(item) {
  const kind = item.kind ?? kindOf(item.filename);
  return {
    id: item.id,
    promptId: item.promptId,
    kind,
    mime: mediaType(item.filename),
    prompt: item.prompt,
    negative: item.negative,
    model: item.model,
    width: item.width,
    height: item.height,
    steps: item.steps,
    seed: item.seed,
    frameRate: item.frameRate ?? null,
    createdAt: item.createdAt,
    filename: item.filename,
    mediaUrl: `/comfy-library/api/items/${item.id}/media`,
  };
}

export function apply(ctx, config) {
  const library = createLibrary(dshHomePath("comfy-library"));
  const timeout = () => Number(readField(config.timeoutMs, 20000));
  const baseUrl = () => normalizeBase(readField(config.baseUrl, "http://127.0.0.1:8188"));

  let sync = { at: 0, error: null, syncing: false };
  let modelCache = { at: 0, base: "", folders: null };

  /** Download every output file (image, video, audio) from ComfyUI if it is not in the library yet. */
  const ingestEntry = async (base, promptId, entry, override = null) => {
    const outputs = collectOutputs(entry);
    if (outputs.length === 0) return [];
    const graph = Array.isArray(entry?.prompt) ? entry.prompt[2] : null;
    const summary = summarizeGraph(graph);
    const meta = { ...summary, ...(override ?? {}) };
    const createdAt = Date.now();
    const items = [];
    for (const [index, output] of outputs.entries()) {
      const id = crypto.createHash("sha1").update(`${promptId}:${output.filename}:${output.subfolder}`).digest("hex").slice(0, 16);
      if (library.isDeleted(id)) continue;
      const existing = library.find(id);
      if (existing) {
        items.push(existing);
        continue;
      }
      const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
      const response = await fetch(`${base}/view?${query.toString()}`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`ComfyUI 결과 파일을 받지 못했습니다 (HTTP ${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const mediaFile = library.saveMedia(promptId, `${index}_${output.filename}`, bytes);
      const item = {
        id,
        promptId,
        kind: output.kind,
        filename: output.filename,
        subfolder: output.subfolder,
        mediaFile,
        frameRate: output.frameRate,
        createdAt,
        prompt: meta.prompt ?? "",
        negative: meta.negative ?? "",
        model: meta.model ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        steps: meta.steps ?? null,
        seed: meta.seed ?? null,
      };
      library.add(item);
      items.push(item);
    }
    return items;
  };

  /** Copy new ComfyUI history output into the local library. */
  const syncLibrary = async (base) => {
    const history = await fetchJson(base, `/history?max_items=${SYNC_LIMIT}`, { timeoutMs: timeout() });
    let scanned = 0;
    let added = 0;
    for (const [promptId, entry] of Object.entries(history ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      scanned += 1;
      const items = await ingestEntry(base, promptId, entry);
      added += items.length;
    }
    sync = { at: Date.now(), error: null, syncing: false };
    return { scanned, added };
  };

  const maybeSync = (base, force = false) => {
    if (!force && readField(config.autoSync, true) === false) return;
    if (sync.syncing || (!force && Date.now() - sync.at < SYNC_COOLDOWN_MS)) return;
    sync.syncing = true;
    void syncLibrary(base)
      .catch((error) => { sync = { at: Date.now(), error: error?.message ?? String(error), syncing: false }; })
      .finally(() => { sync.syncing = false; });
  };

  const statusBody = async (base) => {
    const status = await probe(base, timeout());
    return { ...status, baseUrl: base, library: path.resolve(library.root), lastSyncAt: sync.at, lastSyncError: sync.error };
  };

  /** Installed model folders, cached briefly so tab switching does not hammer ComfyUI. */
  const modelsBody = async (base) => {
    if (modelCache.base === base && Array.isArray(modelCache.folders) && Date.now() - modelCache.at < 30_000) {
      return { baseUrl: base, folders: modelCache.folders, total: modelCache.total, cached: true };
    }
    const folders = await listModels(base, timeout());
    const total = folders.reduce((sum, folder) => sum + folder.files.length, 0);
    modelCache = { at: Date.now(), base, folders, total };
    return { baseUrl: base, folders, total, cached: false };
  };

  const generate = async (body) => {
    const base = normalizeBase(body.baseUrl ?? baseUrl());
    const selected = await resolveCheckpoint(base, body.model ?? readField(config.defaultModel, null), timeout());
    const built = buildTxt2Img({ ...body, model: selected });
    const graph = withCheckpoint(built.graph, selected);
    const promptId = await submitPrompt(base, graph, timeout());
    return {
      promptId,
      status: "queued",
      seed: built.meta.seed,
      model: selected,
      width: built.meta.width,
      height: built.meta.height,
      count: built.meta.count,
      prompt: built.meta.prompt,
      negative: built.meta.negative,
    };
  };

  const readJob = async (promptId, baseOverride) => {
    if (typeof promptId !== "string" || promptId.trim() === "") throw new ValidationError("작업 id가 필요합니다.");
    const base = normalizeBase(baseOverride ?? baseUrl());
    const state = await jobState(base, promptId.trim(), timeout());
    if (state.status !== "completed") return { status: state.status, promptId };
    const items = await ingestEntry(base, promptId, state.entry);
    return { status: "completed", promptId, items: items.map(publicItem) };
  };

  const importItem = async (body) => {
    const item = library.find(String(body.id ?? ""));
    if (!item) throw new ValidationError("그 갤러리 항목을 찾지 못했습니다.");
    if (typeof body.target !== "string" || body.target.trim() === "") throw new ValidationError("복사할 경로(target)가 필요합니다.");
    let target = body.target.trim();
    if (target.endsWith("/") || target.endsWith(path.sep) || fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, item.filename);
    } else {
      target = path.resolve(target);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(library.mediaPath(item), target);
    return { id: item.id, path: target, bytes: fs.statSync(target).size, mediaUrl: `/comfy-library/api/items/${item.id}/media` };
  };

  const handler = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const suffix = url.pathname.slice(ROUTE.length) || "/";
    if (req.method === "GET" && suffix === "/api/items") {
      const base = baseUrl();
      const query = url.searchParams.get("query") ?? "";
      const kind = url.searchParams.get("kind") ?? "";
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const listed = library.list({ query, kind, limit, offset });
      maybeSync(base);
      return sendJson(res, 200, { ...listed, items: listed.items.map(publicItem), baseUrl: base, sync: { at: sync.at, error: sync.error } });
    }
    const mediaMatch = /^\/api\/items\/([a-zA-Z0-9]+)\/media$/.exec(suffix);
    if (req.method === "GET" && mediaMatch) {
      const item = library.find(mediaMatch[1]);
      if (!item) return sendJson(res, 404, { error: "not-found" });
      const file = library.mediaPath(item);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: "missing-file" });
      const size = fs.statSync(file).size;
      const type = mediaType(item.filename);
      const headers = {
        "content-type": type,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=31536000, immutable",
      };
      // Video and audio players ask for byte ranges; serving them avoids loading whole files.
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers?.range ?? "").trim());
      if (range && (range[1] !== "" || range[2] !== "")) {
        let start = range[1] === "" ? null : Number(range[1]);
        let end = range[2] === "" ? null : Number(range[2]);
        if (start === null) {
          start = Math.max(0, size - end);
          end = size - 1;
        } else if (end === null || end >= size) {
          end = size - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
          res.writeHead(416, { "content-range": `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}` });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, "content-length": size });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === "GET" && suffix === "/api/models") {
      return sendJson(res, 200, await modelsBody(normalizeBase(url.searchParams.get("baseUrl") ?? baseUrl())));
    }
    if (req.method === "GET" && suffix === "/api/status") {
      return sendJson(res, 200, await statusBody(normalizeBase(url.searchParams.get("baseUrl") ?? baseUrl())));
    }
    if (req.method === "POST" && suffix === "/api/test") {
      const body = await readJson(req);
      if (!body) throw new ValidationError("요청 본문을 읽지 못했습니다.");
      return sendJson(res, 200, await statusBody(normalizeBase(body.baseUrl ?? baseUrl())));
    }
    if (req.method === "POST" && suffix === "/api/sync") {
      const body = await readJson(req);
      const base = normalizeBase(body?.baseUrl ?? baseUrl());
      return sendJson(res, 200, { ...(await syncLibrary(base)), items: library.list({ limit: 200 }).items.map(publicItem) });
    }
    if (req.method === "POST" && suffix === "/api/delete") {
      const body = await readJson(req);
      if (!body) throw new ValidationError("요청 본문을 읽지 못했습니다.");
      const removed = library.remove(String(body.id ?? ""));
      if (!removed) throw new ValidationError("그 갤러리 항목을 찾지 못했습니다.");
      return sendJson(res, 200, { removed: true, items: library.list({ limit: 200 }).items.map(publicItem) });
    }
    if (req.method === "POST" && suffix === "/api/import") {
      const body = await readJson(req);
      if (!body) throw new ValidationError("요청 본문을 읽지 못했습니다.");
      return sendJson(res, 200, await importItem(body));
    }
    return sendJson(res, 404, { error: "not-found" });
  };

  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: ROUTE, handler: async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error instanceof ValidationError ? 400 : 502;
      sendJson(res, status, { error: error?.message ?? String(error) });
    }
  } }), "deepseek-comfy-library: api");

  /** Agent tools share the same functions as the page, not the HTTP route. */
  const tools = ctx.get("tools");
  if (tools) {
    const renderText = (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }];
    const register = (definition) => ctx.effect(() => tools.register(definition), `deepseek-comfy-library: tool ${definition.name}`);

    register({
      name: "comfy_generate",
      description: "Generate images on the configured ComfyUI server. Submits a txt2img job and returns a promptId immediately; call comfy_job_status until it reports completed, which also saves results into the generation gallery. Check comfy_status first when unsure the server is reachable.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string", description: "Positive prompt describing the image." },
          negative: { type: "string", description: `Things to avoid. Default: ${DEFAULT_NEGATIVE}` },
          model: { type: "string", description: "Checkpoint filename; omit to use the plugin default or the server's first checkpoint." },
          width: { type: "integer", minimum: 64, maximum: 4096, description: "Image width in pixels. Default 512; use 1024 for SDXL-style models." },
          height: { type: "integer", minimum: 64, maximum: 4096, description: "Image height in pixels. Default 512." },
          steps: { type: "integer", minimum: 1, maximum: 150, description: "Sampling steps. Default 20." },
          seed: { type: "integer", minimum: 0, maximum: 2147483647, description: "Fixed seed for a reproducible image; omit for random." },
          count: { type: "integer", minimum: 1, maximum: 8, description: "Number of images in one batch. Default 1." },
        },
        required: ["prompt"],
      },
      output: { schema: { type: "object" }, render: renderText },
      async execute(args) {
        return generate(args);
      },
    });

    register({
      name: "comfy_job_status",
      description: "Read one ComfyUI job's progress. Returns queued, running, completed, or unknown; completed saves every output file (image, video, or audio) into the generation gallery and lists the saved items.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          promptId: { type: "string", description: "The promptId returned by comfy_generate." },
        },
        required: ["promptId"],
      },
      output: { schema: { type: "object" }, render: renderText },
      async execute(args) {
        return readJob(args.promptId);
      },
    });

    register({
      name: "comfy_library_search",
      description: "Search the local generation gallery by prompt, model, or filename, optionally filtered by media kind (image, video, audio). Returns saved items with metadata and a media URL. Use comfy_library_import to copy one into a project workspace.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Case-insensitive text matched against prompt, negative, model, and filename." },
          kind: { type: "string", enum: ["all", "image", "video", "audio"], description: "Only return this media kind. Default: all." },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum items to return. Default 20." },
        },
      },
      output: { schema: { type: "object" }, render: renderText },
      async execute(args) {
        const listed = library.list({
          query: args.query ?? "",
          kind: args.kind ?? "all",
          limit: Math.min(200, Number(args.limit) || 20),
        });
        return { total: listed.total, items: listed.items.map(publicItem) };
      },
    });

    register({
      name: "comfy_library_import",
      description: "Copy one saved gallery item (image, video, or audio) to a file path so a project can use it. Use an absolute path inside the current workspace, or a path ending in / to keep the original filename.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Gallery item id from comfy_library_search or comfy_job_status." },
          target: { type: "string", description: "Destination file or directory path." },
        },
        required: ["id", "target"],
      },
      output: { schema: { type: "object" }, render: renderText },
      async execute(args) {
        return importItem(args);
      },
    });

    register({
      name: "comfy_status",
      description: "Check whether the configured ComfyUI server is reachable, and report its version, GPU, queue depth, and available checkpoint models. Use before generating when connection is uncertain.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      output: { schema: { type: "object" }, render: renderText },
      async execute() {
        return statusBody(baseUrl());
      },
    });
  }
}
