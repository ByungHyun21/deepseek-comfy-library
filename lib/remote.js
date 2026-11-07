/**
 * deepseek-comfy-library — 원격 라이브러리 전송 계층.
 *
 * `mode: remote` 일 때 이 호스트는 미디어를 보관하지 않는다. SSH 로 접속한
 * 다른 DSH 호스트의 `$DSH_HOME/comfy-library` 를 읽어서 목록·미리보기·삭제를
 * 중계하고, 파일이 필요할 때만 대상 경로로 내려받는다. 인덱스를 복제하지
 * 않으므로 로컬 사본이 쌓이지 않는다(원본은 원격 호스트 하나뿐).
 *
 * SSH 출력은 파이프가 아니라 임시 파일로 받는다. 파이프는 일부 실행 환경에서
 * 막히거나 큰 파일에서 메모리를 크게 쓰기 때문이다. 받은 파일은 호출자가
 * 스트리밍한 뒤 `cleanup()` 으로 지운다.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kindOf } from "./comfy.js";

const SSH_ARGS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=5",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
];

function checkTarget(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("원격 모드에는 SSH 대상(예: yoon@192.168.0.35)이 필요합니다.");
  }
  return target.trim();
}

/**
 * SSH 로 원격 명령을 실행하고 stdout/stderr 를 임시 파일에 받는다.
 * 반환값: { dir, stdoutPath, size, stderr, cleanup() }
 */
export function sshToFiles(target, command, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    let run;
    try {
      run = { target: checkTarget(target), command: String(command ?? "") };
      if (run.command.trim() === "") throw new Error("실행할 원격 명령이 비어 있습니다.");
    } catch (error) {
      reject(error);
      return;
    }
    const fence = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-comfy-remote-"));
    const stdoutPath = path.join(fence, "stdout.bin");
    const stderrPath = path.join(fence, "stderr.txt");
    const stdoutFd = fs.openSync(stdoutPath, "w");
    const stderrFd = fs.openSync(stderrPath, "w");
    const cleanup = () => {
      try { fs.rmSync(fence, { recursive: true, force: true }); } catch { /* 이미 지웠으면 그대로 */ }
    };
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const child = spawn("ssh", [...SSH_ARGS, run.target, run.command], {
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    const timer = setTimeout(() => {
      child.kill();
      cleanup();
      settle(reject, new Error(`SSH 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다.`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      cleanup();
      settle(reject, new Error(`SSH 를 실행하지 못했습니다: ${error?.message ?? error}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let stderr = "";
      try { stderr = fs.readFileSync(stderrPath, "utf8").slice(-4000); } catch { /* 없으면 빈 문자열 */ }
      if (code !== 0) {
        cleanup();
        settle(reject, new Error(`SSH 실패 (exit ${code}): ${stderr.trim() || "알 수 없는 오류"}`));
        return;
      }
      let size = 0;
      try { size = fs.statSync(stdoutPath).size; } catch { size = 0; }
      settle(resolve, { dir: fence, stdoutPath, size, stderr, cleanup });
    });
  });
}

/** 원격 index.json 텍스트를 라이브러리 인덱스 모양으로 만든다. */
export function parseIndex(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch {
    throw new Error("원격 라이브러리 index.json 을 해석하지 못했습니다.");
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    return { version: 1, items: [], deleted: [] };
  }
  return {
    version: 1,
    items: parsed.items,
    deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
  };
}

/** 로컬 라이브러리와 같은 규칙으로 정렬·필터·페이지 자르기를 한다. */
export function listFrom(index, { query = "", kind = "", limit = 60, offset = 0 } = {}) {
  const needle = String(query).trim().toLowerCase();
  const wanted = String(kind).trim().toLowerCase();
  const all = index.items.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const matching = wanted === "" || wanted === "all"
    ? all
    : all.filter((item) => (item.kind ?? kindOf(item.filename)) === wanted);
  const filtered = needle === "" ? matching : matching.filter((item) =>
    [item.prompt, item.negative, item.model, item.filename]
      .some((value) => String(value ?? "").toLowerCase().includes(needle)));
  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export function findIn(index, id) {
  return index.items.find((item) => item.id === id) ?? null;
}

/** 셸에 그대로 넣어도 되는 미디어 파일 이름인지 검사한다(경로 탈출 방지). */
export function safeMediaFile(name) {
  const raw = String(name ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw)) {
    throw new Error("원격 미디어 파일 이름이 올바르지 않습니다.");
  }
  return raw;
}

/** 셸에 넣을 원격 디렉터리 경로. 공백·따옴표는 거부한다. */
export function shellPath(dir) {
  const raw = String(dir ?? "").trim();
  if (raw === "" || /[\s'"]/.test(raw)) {
    throw new Error("원격 라이브러리 경로에 공백이나 따옴표가 있으면 안 됩니다.");
  }
  return raw.replace(/\/+$/, "");
}

/** 항목 id 형식 검사(해시 16자리 등). */
export function safeItemId(id) {
  const raw = String(id ?? "");
  if (!/^[A-Za-z0-9]{4,64}$/.test(raw)) {
    throw new Error("갤러리 항목 id 형식이 올바르지 않습니다.");
  }
  return raw;
}

/**
 * 원격에서 실행할 삭제 스크립트(python). 로컬 `library.remove()` 와 같은 의미다:
 * index 에서 항목을 빼고, 같은 id 를 `deleted` 장부에 남겨 동기화가 되살리지
 * 못하게 하고, 미디어 파일을 지운다.
 */
export function removalScript(id, dir) {
  const itemId = safeItemId(id);
  const base = shellPath(dir);
  return [
    "import json, os, pathlib",
    `base = pathlib.Path(os.path.expanduser(${JSON.stringify(base)}))`,
    "index_path = base / 'index.json'",
    "data = json.loads(index_path.read_text(encoding='utf-8'))",
    `mid = ${JSON.stringify(itemId)}`,
    "items = data.get('items') if isinstance(data.get('items'), list) else []",
    "hit = [row for row in items if isinstance(row, dict) and row.get('id') == mid]",
    "if not hit:",
    "    raise SystemExit('not-found')",
    "item = hit[0]",
    "data['items'] = [row for row in items if not (isinstance(row, dict) and row.get('id') == mid)]",
    "deleted = data.get('deleted') if isinstance(data.get('deleted'), list) else []",
    "if mid not in deleted:",
    "    deleted = (deleted + [mid])[-1000:]",
    "data['deleted'] = deleted",
    "tmp = index_path.with_name('index.json.tmp')",
    "tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')",
    "tmp.replace(index_path)",
    "media = item.get('mediaFile')",
    "if isinstance(media, str) and media:",
    "    target = base / 'media' / media",
    "    try:",
    "        target.unlink()",
    "    except FileNotFoundError:",
    "        pass",
    "print('removed')",
  ].join("\n");
}

/** 원격 삭제 명령. 스크립트는 base64 로 감싸 셸 따옴표 문제를 피한다. */
export function removalCommand(id, dir) {
  const source = removalScript(id, dir);
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return `python3 -c "exec(__import__('base64').b64decode('${encoded}').decode())"`;
}

/** index.json 을 읽는 명령. */
export function readIndexCommand(dir) {
  return `cat ${shellPath(dir)}/index.json`;
}

/** 미디어 한 파일을 읽는 명령. */
export function readMediaCommand(dir, mediaFile) {
  return `cat ${shellPath(dir)}/media/${safeMediaFile(mediaFile)}`;
}

/**
 * 원격 라이브러리 파사드. 로컬 `createLibrary()` 와 같은 표면(list/find/remove)을
 * 비동기로 제공한다. 인덱스는 TTL 동안 메모리에만 캐시한다(디스크에 복제하지 않음).
 */
export function createRemoteLibrary({ target = "", dir = "~/.dsh/comfy-library", cacheTtlMs = 15_000, timeoutMs = 20_000 } = {}) {
  let cache = { at: 0, index: null };

  const refresh = async (force = false) => {
    if (!force && cache.index && Date.now() - cache.at < cacheTtlMs) return cache.index;
    const run = await sshToFiles(target, readIndexCommand(dir), { timeoutMs });
    try {
      const text = fs.readFileSync(run.stdoutPath, "utf8");
      cache = { at: Date.now(), index: parseIndex(text) };
      return cache.index;
    } finally {
      run.cleanup();
    }
  };

  /** 원격 미디어를 임시 파일로 받는다. 반환값의 `cleanup()` 은 호출자가 부른다. */
  const fetchMedia = async (item) => {
    const run = await sshToFiles(target, readMediaCommand(dir, item?.mediaFile), {
      timeoutMs: Math.max(timeoutMs, 120_000),
    });
    return { path: run.stdoutPath, size: run.size, cleanup: run.cleanup };
  };

  return {
    kind: "remote",
    info: () => ({ target: String(target ?? ""), dir: String(dir ?? ""), cachedAt: cache.at, items: cache.index?.items.length ?? null }),
    refresh,
    async list(options) {
      return listFrom(await refresh(), options);
    },
    async find(id) {
      return findIn(await refresh(), String(id ?? ""));
    },
    async remove(id) {
      const run = await sshToFiles(target, removalCommand(id, dir), { timeoutMs });
      run.cleanup();
      cache = { at: 0, index: null };
      return true;
    },
    fetchMedia,
    /** 원격 미디어를 대상 경로로 내려받고 바이트 수를 돌려준다. */
    async copyMedia(item, targetPath) {
      const fetched = await fetchMedia(item);
      try {
        fs.copyFileSync(fetched.path, targetPath);
        return fetched.size;
      } finally {
        fetched.cleanup();
      }
    },
    isDeleted(id) {
      return Boolean(cache.index?.deleted?.includes(String(id ?? "")));
    },
  };
}
