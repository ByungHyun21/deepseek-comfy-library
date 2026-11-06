/**
 * ComfyUI HTTP surface and workflow helpers, shared by the host route and tools.
 * Pure enough to unit-test without a running server: no fs and no plugin state.
 */

export const DEFAULT_NEGATIVE = "low quality, blurry, watermark, text, deformed";
export const DEFAULT_POSITIVE = "a quiet lighthouse on a cliff at dusk, cinematic, detailed";
export const SAVE_PREFIX = "dsh_library";

const MAX_SEED = 2147483647;

/** Strip trailing slashes and reject non-HTTP or credential-bearing URLs. */
export function normalizeBase(raw) {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("ComfyUI 주소가 비어 있습니다.");
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("ComfyUI 주소 형식이 올바르지 않습니다. http://호스트:포트 형태로 넣어 주세요.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("ComfyUI 주소는 http 또는 https여야 합니다.");
  if (url.username || url.password) throw new Error("주소에 사용자 이름이나 비밀번호를 넣을 수 없습니다.");
  url.search = "";
  url.hash = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

/** Fetch one JSON endpoint with a hard timeout and readable failures. */
export async function fetchJson(base, route, { method = "GET", body, timeoutMs = 15000 } = {}) {
  const root = normalizeBase(base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = text === "" ? {} : JSON.parse(text);
    } catch {
      throw new Error(`ComfyUI가 JSON이 아닌 응답을 보냈습니다 (HTTP ${response.status}). 주소가 맞는지 확인해 주세요.`);
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.node_errors || text.slice(0, 300);
      throw new Error(`ComfyUI 오류 HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`ComfyUI 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다.`);
    if (error instanceof TypeError) throw new Error(`ComfyUI에 연결하지 못했습니다: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Connection probe: system stats, queue depth, and available checkpoints. */
export async function probe(base, timeoutMs = 15000) {
  const stats = await fetchJson(base, "/system_stats", { timeoutMs });
  const queue = await fetchJson(base, "/queue", { timeoutMs }).catch(() => null);
  const checkpoints = await listCheckpoints(base, timeoutMs).catch(() => []);
  const system = stats?.system ?? {};
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  return {
    ok: true,
    comfyuiVersion: system.comfyui_version ?? null,
    pythonVersion: system.python_version ?? null,
    os: system.os ?? null,
    devices: devices.map((device) => ({
      name: device.name ?? null,
      type: device.type ?? null,
      // system_stats reports VRAM in bytes, despite the historical field name.
      vramTotalMb: device.vram_total === undefined ? null : Math.round(device.vram_total / 1024 / 1024),
      vramFreeMb: device.vram_free === undefined ? null : Math.round(device.vram_free / 1024 / 1024),
    })),
    running: Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0,
    pending: Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0,
    checkpoints,
  };
}

/** Checkpoint names for CheckpointLoaderSimple, in ComfyUI's own order. */
export async function listCheckpoints(base, timeoutMs = 15000) {
  const info = await fetchJson(base, "/object_info/CheckpointLoaderSimple", { timeoutMs });
  const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(names) ? names.filter((name) => typeof name === "string") : [];
}

// ComfyUI's `/models` also lists non-model folders such as configs and custom_nodes.
const NON_MODEL_FOLDERS = new Set(["configs", "custom_nodes", "datasets", "input", "output", "temp", "user", "notebooks"]);
const MODEL_EXTENSIONS = new Set(["safetensors", "ckpt", "pt", "pth", "bin", "gguf", "onnx", "sft"]);

/** True when a listed file looks like a model weight, not a config or script. */
export function isModelFile(file) {
  const ext = String(file ?? "").toLowerCase().split(".").pop() ?? "";
  return MODEL_EXTENSIONS.has(ext);
}

/**
 * Installed model folders and weight files, from ComfyUI's `/models` API.
 * Folders that only hold configs or custom-node code are skipped, and a folder
 * that fails to list is reported empty instead of failing the whole tab.
 */
export async function listModels(base, timeoutMs = 15000) {
  const folders = await fetchJson(base, "/models", { timeoutMs });
  if (!Array.isArray(folders)) return [];
  const named = folders.filter((folder) =>
    typeof folder === "string" && folder !== "" && !NON_MODEL_FOLDERS.has(folder.toLowerCase()));
  const groups = await Promise.all(named.map(async (name) => {
    let files = [];
    let error = null;
    try {
      const listed = await fetchJson(base, `/models/${encodeURIComponent(name)}`, { timeoutMs });
      if (Array.isArray(listed)) files = listed.filter((file) => typeof file === "string" && isModelFile(file));
    } catch (cause) {
      error = cause?.message ?? String(cause);
    }
    return { name, files, error };
  }));
  return groups;
}

/** Pick a usable checkpoint when the user did not name one. */
export async function resolveCheckpoint(base, requested, timeoutMs = 15000) {
  if (typeof requested === "string" && requested.trim() !== "") return requested.trim();
  const names = await listCheckpoints(base, timeoutMs);
  if (names.length === 0) throw new Error("ComfyUI에 사용할 체크포인트 모델이 없습니다. models/checkpoints에 모델을 넣어 주세요.");
  return names[0];
}

/** Clamp model parameters to values ComfyUI can actually run. */
function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Build a standard txt2img graph in ComfyUI API format.
 * Node ids stay fixed so history summaries and reruns are stable.
 */
export function buildTxt2Img(options = {}) {
  const prompt = typeof options.prompt === "string" && options.prompt.trim() !== "" ? options.prompt.trim() : DEFAULT_POSITIVE;
  const negative = typeof options.negative === "string" ? options.negative.trim() : DEFAULT_NEGATIVE;
  const model = typeof options.model === "string" && options.model.trim() !== "" ? options.model.trim() : null;
  const seed = options.seed === undefined || options.seed === null || options.seed === ""
    ? Math.floor(Math.random() * MAX_SEED)
    : integer(options.seed, 0, 0, MAX_SEED);
  const width = integer(options.width, 512, 64, 4096);
  const height = integer(options.height, 512, 64, 4096);
  const steps = integer(options.steps, 20, 1, 150);
  const cfg = Number.isFinite(Number(options.cfg)) ? Math.min(30, Math.max(1, Number(options.cfg))) : 7;
  const count = integer(options.count, 1, 1, 8);
  const graph = {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: typeof options.sampler === "string" && options.sampler.trim() !== "" ? options.sampler.trim() : "euler",
        scheduler: typeof options.scheduler === "string" && options.scheduler.trim() !== "" ? options.scheduler.trim() : "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model ?? "__MODEL__" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: count } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: SAVE_PREFIX, images: ["8", 0] } },
  };
  return { graph, meta: { prompt, negative, width, height, steps, seed, count, cfg, model } };
}

/** Fill a deferred checkpoint placeholder after async discovery. */
export function withCheckpoint(graph, checkpoint) {
  const copy = JSON.parse(JSON.stringify(graph));
  copy["4"].inputs.ckpt_name = checkpoint;
  return copy;
}

/** POST a graph and return ComfyUI's prompt id. */
export async function submitPrompt(base, graph, timeoutMs = 15000) {
  const body = { prompt: graph, client_id: "dsh-comfy-library" };
  const result = await fetchJson(base, "/prompt", { method: "POST", body, timeoutMs });
  if (!result?.prompt_id) {
    const detail = result?.error?.message || result?.error || "prompt_id가 없습니다.";
    throw new Error(`ComfyUI가 작업을 받지 않았습니다: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return result.prompt_id;
}

/** Read one finished history entry, or null while it is still queued/running. */
export async function historyEntry(base, promptId, timeoutMs = 15000) {
  const data = await fetchJson(base, `/history/${encodeURIComponent(promptId)}`, { timeoutMs });
  return data?.[promptId] ?? null;
}

/** Where a prompt currently sits: running, queued, completed, or unknown. */
export async function jobState(base, promptId, timeoutMs = 15000) {
  const entry = await historyEntry(base, promptId, timeoutMs);
  if (entry) return { status: "completed", entry };
  const queue = await fetchJson(base, "/queue", { timeoutMs });
  const owner = (row) => Array.isArray(row) && row[1] === promptId;
  if (Array.isArray(queue?.queue_running) && queue.queue_running.some(owner)) return { status: "running", entry: null };
  if (Array.isArray(queue?.queue_pending) && queue.queue_pending.some(owner)) return { status: "queued", entry: null };
  return { status: "unknown", entry: null };
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "avif", "tif", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi", "gif", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "ogg", "m4a", "opus", "aac"]);

/** Which filter bucket a saved file belongs to: image, video, or audio. */
export function kindOf(filename) {
  const ext = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "image";
}

// SaveImage writes `images`; VideoHelperSuite writes `gifs`/`videos`; audio nodes write `audio`.
const OUTPUT_FIELDS = [["images", "image"], ["gifs", "video"], ["videos", "video"], ["audio", "audio"], ["sounds", "audio"]];

/** Every media file written by one history entry, with its producing node id and kind. */
export function collectOutputs(entry) {
  const rows = [];
  const index = new Map();
  const outputs = entry?.outputs;
  if (!outputs || typeof outputs !== "object") return rows;
  for (const [nodeId, output] of Object.entries(outputs)) {
    if (!output || typeof output !== "object") continue;
    for (const [field, hint] of OUTPUT_FIELDS) {
      if (!Array.isArray(output[field])) continue;
      for (const media of output[field]) {
        if (!media || typeof media.filename !== "string" || media.filename === "") continue;
        const subfolder = typeof media.subfolder === "string" ? media.subfolder : "";
        const key = `${media.filename}:${subfolder}`;
        const guessed = kindOf(media.filename);
        // A node that only ever writes video/audio wins over a misleading extension.
        const kind = hint !== "image" && guessed === "image" ? hint : guessed;
        const format = typeof media.format === "string" ? media.format : null;
        const frameRate = Number.isFinite(Number(media.frame_rate)) ? Number(media.frame_rate) : null;
        const prior = index.get(key);
        if (prior) {
          // The same animated file may show up in both `images` and `gifs`; the richer kind wins.
          if (prior.kind === "image" && kind !== "image") prior.kind = kind;
          if (prior.frameRate === null && frameRate !== null) prior.frameRate = frameRate;
          if (prior.format === null && format !== null) prior.format = format;
          continue;
        }
        const row = {
          node: nodeId,
          filename: media.filename,
          subfolder,
          type: typeof media.type === "string" ? media.type : "output",
          kind,
          format,
          frameRate,
        };
        index.set(key, row);
        rows.push(row);
      }
    }
  }
  return rows;
}

/** Images only, without the media-kind extras. */
export function collectImages(entry) {
  return collectOutputs(entry)
    .filter((row) => row.kind === "image")
    .map((row) => ({ node: row.node, filename: row.filename, subfolder: row.subfolder, type: row.type }));
}

/** Pull prompt, model, seed, size, and steps out of an API-format graph. */
export function summarizeGraph(graph) {
  const nodes = graph && typeof graph === "object" ? graph : {};
  const byClass = (klass) => Object.entries(nodes).find(([, node]) => node?.class_type === klass);
  const [, sampler] = byClass("KSampler") ?? byClass("KSamplerAdvanced") ?? [];
  const [, checkpoint] = byClass("CheckpointLoaderSimple") ?? [];
  const [, latent] = byClass("EmptyLatentImage") ?? [];
  const textOf = (ref) => {
    if (!Array.isArray(ref)) return "";
    const node = nodes[ref[0]];
    return node?.class_type === "CLIPTextEncode" && typeof node.inputs?.text === "string" ? node.inputs.text : "";
  };
  return {
    prompt: textOf(sampler?.inputs?.positive),
    negative: textOf(sampler?.inputs?.negative),
    model: checkpoint?.inputs?.ckpt_name ?? null,
    seed: Number.isFinite(Number(sampler?.inputs?.seed)) ? Number(sampler.inputs.seed) : null,
    steps: Number.isFinite(Number(sampler?.inputs?.steps)) ? Number(sampler.inputs.steps) : null,
    width: Number.isFinite(Number(latent?.inputs?.width)) ? Number(latent.inputs.width) : null,
    height: Number.isFinite(Number(latent?.inputs?.height)) ? Number(latent.inputs.height) : null,
  };
}

/** A filesystem-safe version of one output filename. */
export function safeFilename(name) {
  const leaf = String(name ?? "image.png").split(/[\\/]/).pop() ?? "";
  const base = leaf.replace(/[:*?"<>|]+/g, "_").replace(/^\.+/, "");
  return base === "" ? "image.png" : base.slice(0, 180);
}

export function mediaType(filename) {
  const lower = String(filename ?? "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
  return "image/png";
}
