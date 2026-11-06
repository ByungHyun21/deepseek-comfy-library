/**
 * deepseek-comfy-library — 화면 반쪽.
 *
 * 좌석 세 개:
 *  - `sidebar.panellist` : "생성 갤러리" 아이콘 (자동화 작업·작업 대상 다음, 더 보기 앞).
 *  - `main` (keyed)      : 아이콘을 누르면 열리는 갤러리·생성 화면.
 *  - `plugins.row.config`: 설정 → 플러그인의 주소·연결 테스트·기본값 화면.
 *
 * 데이터는 호스트의 `/comfy-library/api/*` 에서 온다. 결과 이미지는 로컬 라이브러리에
 * 남으므로 ComfyUI history 가 지워져도 갤러리는 그대로다.
 */

window.__ModuleLoader__.load({ id: "deepseek-comfy-library", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;

const React = require("react");
const h = React.createElement;
const { useState, useEffect, useMemo } = React;

const PLUGIN = "deepseek-comfy-library";
const ENTRY_ID = "deepseek-comfy-library";
const API = "/comfy-library/api";
const PANEL_ID = `${PLUGIN}.gallery`;
const STYLE_ID = "dscl-style";

// 셸의 문서 언어를 먼저 본다. navigator.language 는 헤드리스/영어 브라우저에서
// 셸 언어 설정과 어긋나므로 사이드바 라벨이 영어로 남는 원인이 된다.
function isKo() {
  try {
    const lang = String(document.documentElement?.lang || "").toLowerCase();
    if (lang) return lang.startsWith("ko");
    return String(navigator.language || "").toLowerCase().startsWith("ko");
  } catch {
    return true;
  }
}
const t = (ko, en) => (isKo() ? ko : en);

const CSS = [
  ".dscl-page{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}",
  ".dscl-scroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex:1;min-height:0;overflow:auto}",
  ".dscl-content{max-width:1180px;margin:0 auto;padding:0 clamp(20px,3vw,40px) 56px}",
  ".dscl-heading{flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:22px;padding-top:28px;display:flex}",
  "[data-platform=darwin] .dscl-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}",
  ".dscl-h1{margin:0;font-size:20px;font-weight:500;line-height:28px}",
  ".dscl-intro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}",
  ".dscl-headActions{display:flex;align-items:center;gap:8px;flex:none}",
  ".dscl-btn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 12px;border:none;border-radius:var(--dsw-radius-md,16px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s}",
  ".dscl-btn:disabled{cursor:not-allowed;opacity:.4}",
  ".dscl-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
  ".dscl-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
  ".dscl-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
  ".dscl-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}",
  ".dscl-chip .dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption);flex:none}",
  ".dscl-chip.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}",
  ".dscl-chip.ok .dot{background:var(--dsw-alias-state-success-primary)}",
  ".dscl-chip.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}",
  ".dscl-chip.bad .dot{background:var(--dsw-alias-state-error-primary)}",
  ".dscl-field{display:grid;gap:6px;margin-bottom:12px}",
  ".dscl-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex;justify-content:space-between;gap:8px}",
  ".dscl-input{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;outline:none;transition:background .15s,border-color .15s}",
  ".dscl-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}",
  ".dscl-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;margin:0}",
  ".dscl-notice{display:flex;align-items:flex-start;gap:8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0 0 16px;padding:10px 12px;font-size:12px;line-height:19px;overflow-wrap:anywhere}",
  ".dscl-notice.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-specific-sidebar-fill));color:var(--dsw-alias-state-error-primary)}",
  ".dscl-notice p{margin:0;flex:1;min-width:0}",
  ".dscl-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}",
  ".dscl-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);margin-bottom:16px}",
  ".dscl-tab{height:30px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}",
  ".dscl-tab:hover{color:var(--dsw-alias-label-primary)}",
  ".dscl-tab.active{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.28)}",
  ".dscl-tabCount{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.08));font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
  ".dscl-filters{display:flex;gap:6px;flex-wrap:wrap}",
  ".dscl-filter{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .15s,color .15s,border-color .15s;white-space:nowrap}",
  ".dscl-filter:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
  ".dscl-filter.active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 42%,transparent);color:var(--dsw-alias-state-business-primary)}",
  ".dscl-search{flex:1;min-width:150px;max-width:280px}",
  ".dscl-count{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-left:auto}",
  ".dscl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}",
  "@media (max-width:520px){.dscl-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}}",
  ".dscl-thumbButton{position:relative;display:block;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:zoom-in}",
  ".dscl-thumbButton:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
  ".dscl-thumbOverlay{position:absolute;inset:auto 0 0;padding:7px 9px;background:linear-gradient(transparent,rgba(0,0,0,.62));color:#fff;font-size:11px;line-height:16px;opacity:0;transition:opacity .2s;pointer-events:none}",
  ".dscl-item:hover .dscl-thumbOverlay{opacity:1}",
  ".dscl-empty span{display:block;max-width:560px;margin:0 auto;line-height:20px}",
  ".dscl-iconBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-caption);line-height:1;cursor:pointer}",
  ".dscl-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
  ".dscl-lightbox{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:24px}",
  ".dscl-lightboxBackdrop{position:absolute;inset:0;border:0;padding:0;background:linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)),linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)),linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1));cursor:zoom-out}",
  ".dscl-lightboxPanel{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;width:min(1080px,100%);max-height:calc(100vh - 48px);border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;padding:16px;overflow:auto;background:linear-gradient(var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-2)),linear-gradient(var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-2)),linear-gradient(var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-2));box-shadow:0 18px 60px rgba(0,0,0,.35)}",
  "@media (max-width:820px){.dscl-lightbox{padding:12px}.dscl-lightboxPanel{grid-template-columns:minmax(0,1fr);max-height:calc(100vh - 24px);padding:12px;gap:14px}}",
  ".dscl-lightboxImage{min-width:0;min-height:200px;max-height:calc(100vh - 80px);display:flex;align-items:center;justify-content:center;border-radius:12px;background:var(--dsw-alias-bg-base);overflow:hidden}",
  ".dscl-lightboxImage img{display:block;max-width:100%;max-height:calc(100vh - 80px);object-fit:contain}",
  ".dscl-lightboxImage video{display:block;max-width:100%;max-height:calc(100vh - 80px);border-radius:8px;background:#000}",
  ".dscl-lightboxAudio{display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 24px;width:100%;color:var(--dsw-alias-label-secondary);text-align:center}",
  ".dscl-lightboxAudio strong{font-weight:500;font-size:13px;overflow-wrap:anywhere}",
  ".dscl-lightboxAudio audio{width:min(420px,100%)}",
  ".dscl-lightboxInfo{min-width:0;display:flex;flex-direction:column;gap:14px}",
  ".dscl-lightboxTop{display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".dscl-lightboxTitle{margin:0;font-size:16px;font-weight:500;line-height:24px}",
  ".dscl-lightboxPrompt{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}",
  ".dscl-metaList{margin:0;border-top:.5px solid var(--dsw-alias-border-l3)}",
  ".dscl-metaRow{display:grid;grid-template-columns:92px minmax(0,1fr);gap:12px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l3);font-size:12px;line-height:19px}",
  ".dscl-metaRow dt{margin:0;color:var(--dsw-alias-label-tertiary)}",
  ".dscl-metaRow dd{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
  ".dscl-negative{padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:19px}",
  ".dscl-negative span{color:var(--dsw-alias-label-tertiary)}",
  ".dscl-negative p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
  ".dscl-lightboxActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:6px}",
  ".dscl-lightboxActions .dscl-btn{flex:1 1 auto;justify-content:center}",
  ".dscl-item{border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);min-width:0;display:flex;flex-direction:column}",
  ".dscl-thumb{position:relative;display:block;width:100%;aspect-ratio:1;background:var(--dsw-alias-bg-base);overflow:hidden}",
  ".dscl-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}",
  ".dscl-thumb video{width:100%;height:100%;object-fit:cover;display:block}",
  ".dscl-item:hover .dscl-thumb img{transform:scale(1.02)}",
  ".dscl-playBadge{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}",
  ".dscl-playBadge svg{box-sizing:content-box;width:18px;height:18px;padding:9px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff}",
  ".dscl-thumbAudio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--dsw-alias-label-tertiary);background:linear-gradient(150deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,var(--dsw-alias-bg-base)),var(--dsw-alias-bg-base))}",
  ".dscl-audioLabel{max-width:82%;font-size:10px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".dscl-itemBody{padding:9px 10px 10px;display:grid;gap:3px;min-width:0}",
  ".dscl-itemPrompt{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}",
  ".dscl-itemMeta{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".dscl-itemActions{display:flex;gap:2px;margin-top:4px;flex-wrap:wrap}",
  ".dscl-mini{height:24px;padding:0 7px;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}",
  ".dscl-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
  ".dscl-mini.danger:hover{color:var(--dsw-alias-state-error-primary)}",
  ".dscl-empty{grid-column:1/-1;text-align:center;color:var(--dsw-alias-label-tertiary);padding:44px 20px;font-size:13px}",
  ".dscl-empty strong{display:block;color:var(--dsw-alias-label-secondary);font-weight:500;margin-bottom:6px}",
  ".dscl-foot{color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;margin-top:16px}",
  ".dscl-models{display:grid;gap:12px}",
  ".dscl-modelGroup{border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}",
  ".dscl-modelHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:.5px solid var(--dsw-alias-border-l3)}",
  ".dscl-modelName{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-primary)}",
  ".dscl-modelCount{color:var(--dsw-alias-label-tertiary);font-size:11px}",
  ".dscl-modelList{display:grid}",
  ".dscl-modelRow{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l3);min-width:0}",
  ".dscl-modelRow:last-child{border-bottom:0}",
  ".dscl-modelFile{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
  ".dscl-settings{display:grid;gap:14px;max-width:560px}",
  ".dscl-settings .dscl-field{margin-bottom:0}",
  ".dscl-settingsRow{display:flex;align-items:center;justify-content:space-between;gap:20px}",
  ".dscl-test{display:grid;gap:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
  ".dscl-test.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-state-error-primary)}",
  ".dscl-settingsActions{display:flex;gap:8px;align-items:center}",
];

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      for (const fn of subs) fn();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    snapshot: () => state,
  };
}

function useStore(store) {
  const [, bump] = useState(0);
  useEffect(() => store.subscribe(() => bump((n) => n + 1)), [store]);
  return store.get();
}

async function call(path, body) {
  try {
    const response = await fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { error: data?.error || `요청 실패 (${response.status})` };
    return data ?? {};
  } catch (error) {
    return { error: error?.message || t("서버에 연결하지 못했습니다.", "Could not reach the server.") };
  }
}

const SVG = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function IconGallery({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("rect", { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
    h("circle", { cx: 8.5, cy: 9.5, r: 1.5 }),
    h("path", { d: "M4.5 17l5-5 4 4 2.5-2.5L20 17" }),
    h("path", { d: "M18.5 2.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z", fill: "currentColor", stroke: "none" }));
}

function IconRefresh({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M20 11a8 8 0 1 0-2.3 5.7" }), h("path", { d: "M20 4v7h-7" }));
}

function IconSpark({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" }),
    h("path", { d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" }));
}

function IconCopy({ size = 13 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }), h("path", { d: "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" }));
}

function IconTrash({ size = 13 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" }));
}

function IconClose({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M6 6l12 12M18 6L6 18" }));
}

function IconPlay({ size = 16 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M9 6.5l9 5.5-9 5.5z", fill: "currentColor", stroke: "none" }));
}

function IconMusic({ size = 18 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M9 18V5l11-2v13" }),
    h("circle", { cx: 6.5, cy: 18, r: 2.5 }),
    h("circle", { cx: 17.5, cy: 16, r: 2.5 }));
}

function IconBox({ size = 14 }) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", ...SVG },
    h("path", { d: "M12 3l8 4.5v9L12 21l-8-4.5v-9z" }),
    h("path", { d: "M4 7.5l8 4.5 8-4.5M12 12v9" }));
}

const KINDS = ["all", "image", "video", "audio"];

function kindLabel(kind) {
  if (kind === "video") return t("비디오", "Video");
  if (kind === "audio") return t("음악", "Music");
  if (kind === "image") return t("이미지", "Image");
  return t("전체", "All");
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(isKo() ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch { return ""; }
}

function GalleryPage({ store, actions }) {
  const s = useStore(store);
  useEffect(() => {
    if (!s.selected) return;
    const onKey = (event) => { if (event.key === "Escape") actions.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.selected]);
  const models = s.tab === "models";
  return h("div", { className: "dscl-page" },
    h("div", { className: "dscl-scroll" },
      h("div", { className: "dscl-content" },
        h("header", { className: "dscl-heading" },
          h("div", null,
            h("h1", { className: "dscl-h1" }, t("생성 갤러리", "Generation gallery")),
            h("p", { className: "dscl-intro" }, t(
              "에이전트가 ComfyUI로 만든 이미지·비디오·음악을 모아 보는 갤러리입니다. 새 결과는 대화에서 에이전트에게 요청하세요.",
              "A gallery of images, video, and music the agent made with ComfyUI. Ask the agent in chat to create more."))),
          h("div", { className: "dscl-headActions" },
            h("span", { className: `dscl-chip ${s.status?.ok ? "ok" : s.statusError ? "bad" : ""}`, title: s.status?.baseUrl || s.statusError || "" },
              h("span", { className: "dot" }),
              s.status?.ok ? t("연결됨", "Connected") : s.statusError ? t("연결 안 됨", "Offline") : t("확인 중", "Checking")),
            h("button", {
              className: "dscl-btn ghost", type: "button",
              onClick: models ? actions.refreshModels : actions.refresh,
              disabled: models ? s.modelsLoading : s.loading,
              title: t("새로 고침", "Refresh"),
            }, h(IconRefresh, null), t("새로 고침", "Refresh")))),
        s.statusError ? h("div", { className: "dscl-notice bad" },
          h("p", null, s.statusError),
          h("button", { className: "dscl-btn ghost", type: "button", onClick: actions.retryStatus }, t("다시 확인", "Retry"))) : null,
        h("div", { className: "dscl-tabs", role: "tablist", "aria-label": t("갤러리 보기 전환", "Gallery views") },
          h("button", {
            className: `dscl-tab${models ? "" : " active"}`, type: "button", role: "tab", "aria-selected": !models,
            onClick: () => actions.tab("gallery"),
          }, h(IconGallery, { size: 14 }), t("갤러리", "Gallery")),
          h("button", {
            className: `dscl-tab${models ? " active" : ""}`, type: "button", role: "tab", "aria-selected": models,
            onClick: () => actions.tab("models"),
          }, h(IconBox, { size: 14 }), t("설치된 모델", "Installed models"),
            s.models ? h("span", { className: "dscl-tabCount" }, String(s.models.total ?? 0)) : null)),
        models ? h(ModelsView, { state: s, actions }) : h(GalleryBody, { state: s, actions })),
    ),
    s.selected ? h(ItemDetail, { item: s.selected, onClose: actions.close, onCopy: actions.copyPrompt, onDelete: actions.remove }) : null);
}

function GalleryBody({ state: s, actions }) {
  const empty = s.items.length === 0;
  return h("div", null,
    h("div", { className: "dscl-toolbar" },
      h("div", { className: "dscl-filters", role: "group", "aria-label": t("미디어 종류 필터", "Media kind filter") },
        ...KINDS.map((kind) => h("button", {
          key: kind,
          className: `dscl-filter${s.kind === kind ? " active" : ""}`,
          type: "button",
          "aria-pressed": s.kind === kind,
          onClick: () => actions.kind(kind),
        }, kindLabel(kind)))),
      h("input", { className: "dscl-input dscl-search", type: "search", value: s.query, placeholder: t("프롬프트·모델 검색", "Search prompt or model"), onChange: (event) => actions.search(event.target.value) }),
      h("span", { className: "dscl-count" }, t(`${s.total}개`, `${s.total} items`))),
    s.itemsError ? h("div", { className: "dscl-notice bad" }, h("p", null, s.itemsError)) : null,
    s.loading && empty ? h("div", { className: "dscl-empty" }, t("갤러리를 불러오는 중입니다…", "Loading the gallery…")) : null,
    empty && !s.loading ? h("div", { className: "dscl-empty" },
      h("strong", null, s.kind === "all"
        ? t("아직 갤러리가 비어 있습니다", "The gallery is empty")
        : t(`${kindLabel(s.kind)} 결과가 없습니다`, `No ${kindLabel(s.kind).toLowerCase()} saved yet`)),
      h("span", null, s.kind === "all"
        ? t("대화에서 에이전트에게 이미지를 만들어 달라고 하세요. 예: “ComfyUI로 해질녘 등대 이미지를 만들어줘”. 완료되면 여기에 자동으로 쌓입니다.", "Ask the agent in chat to create an image, for example “Make a lighthouse at dusk with ComfyUI”. Finished files appear here automatically.")
        : t("다른 필터를 골라 보거나, 에이전트에게 이 형식으로 만들어 달라고 하세요. 완료된 파일은 자동으로 쌓입니다.", "Pick another filter, or ask the agent to produce this format. Finished files appear here automatically."))) : null,
    h("div", { className: "dscl-grid" }, ...s.items.map((item) =>
      h(GalleryItem, { key: item.id, item, onOpen: actions.open, onDelete: actions.remove, onCopy: actions.copyPrompt }))),
    h("p", { className: "dscl-foot" }, t(
      "생성은 에이전트 도구(comfy_generate → comfy_job_status)가 맡고, 이 화면은 결과를 모아 봅니다. 이미지·비디오·음악 파일을 모두 담습니다. 프로젝트에 쓰려면 에이전트에게 comfy_library_import를 요청하세요.",
      "Generation belongs to the agent tools (comfy_generate → comfy_job_status); this page collects the results, including video and audio files. Ask the agent to run comfy_library_import to use one in a project.")));
}

function mediaThumb(item) {
  if (item.kind === "video") {
    return h("span", { className: "dscl-thumb" },
      h("video", { src: `${item.mediaUrl}#t=0.5`, muted: true, playsInline: true, preload: "metadata", "aria-hidden": true, tabIndex: -1 }),
      h("span", { className: "dscl-playBadge", "aria-hidden": true }, h(IconPlay, { size: 18 })));
  }
  if (item.kind === "audio") {
    return h("span", { className: "dscl-thumb" },
      h("span", { className: "dscl-thumbAudio" },
        h(IconMusic, { size: 30 }),
        h("span", { className: "dscl-audioLabel" }, item.filename)));
  }
  return h("span", { className: "dscl-thumb" },
    h("img", { src: item.mediaUrl, alt: item.prompt || item.filename, loading: "lazy", decoding: "async" }));
}

function GalleryItem({ item, onOpen, onDelete, onCopy }) {
  const kind = item.kind ?? "image";
  const meta = [
    kindLabel(kind),
    item.width && item.height ? `${item.width}×${item.height}` : null,
    item.model,
    formatDate(item.createdAt),
  ].filter(Boolean);
  return h("article", { className: "dscl-item" },
    h("button", { className: "dscl-thumbButton", type: "button", onClick: () => onOpen(item), "aria-label": t("미디어 크게 보기", "View media") },
      mediaThumb(item),
      h("span", { className: "dscl-thumbOverlay" }, kind === "audio" ? t("재생", "Play") : t("크게 보기", "View"))),
    h("div", { className: "dscl-itemBody" },
      h("p", { className: "dscl-itemPrompt", title: item.prompt }, item.prompt || t("(프롬프트 없음)", "(no prompt)")),
      h("span", { className: "dscl-itemMeta", title: meta.join(" · ") }, meta.join(" · ")),
      h("div", { className: "dscl-itemActions" },
        h("button", { className: "dscl-mini", type: "button", onClick: () => onOpen(item) }, t("크게 보기", "View")),
        h("button", { className: "dscl-mini", type: "button", onClick: () => onCopy(item) }, h(IconCopy, null), t("복사", "Copy")),
        h("button", { className: "dscl-mini danger", type: "button", onClick: () => onDelete(item) }, h(IconTrash, null), t("삭제", "Delete")))));
}

function mediaDetail(item) {
  if (item.kind === "video") {
    return h("video", { src: item.mediaUrl, controls: true, playsInline: true, preload: "metadata" });
  }
  if (item.kind === "audio") {
    return h("div", { className: "dscl-lightboxAudio" },
      h(IconMusic, { size: 40 }),
      h("strong", null, item.filename),
      h("audio", { controls: true, src: item.mediaUrl, preload: "metadata" }));
  }
  return h("img", { src: item.mediaUrl, alt: item.prompt || item.filename });
}

function ItemDetail({ item, onClose, onCopy, onDelete }) {
  const kind = item.kind ?? "image";
  const title = kind === "video"
    ? t("비디오 정보", "Video details")
    : kind === "audio"
      ? t("음악 정보", "Music details")
      : t("이미지 정보", "Image details");
  const rows = [[t("종류", "Kind"), kindLabel(kind)]];
  if (item.width && item.height) rows.push([t("크기", "Size"), `${item.width}×${item.height}`]);
  rows.push(
    [t("모델", "Model"), item.model || "—"],
    [t("스텝", "Steps"), item.steps ?? "—"],
    [t("시드", "Seed"), item.seed ?? "—"],
    [t("만든 시각", "Created"), formatDate(item.createdAt) || "—"],
    [t("파일", "File"), item.filename || "—"]);
  return h("div", { className: "dscl-lightbox", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("button", { className: "dscl-lightboxBackdrop", type: "button", "aria-label": t("닫기", "Close"), onClick: onClose }),
    h("div", { className: "dscl-lightboxPanel" },
      h("div", { className: "dscl-lightboxImage" }, mediaDetail(item)),
      h("div", { className: "dscl-lightboxInfo" },
        h("div", { className: "dscl-lightboxTop" },
          h("h2", { className: "dscl-lightboxTitle" }, title),
          h("button", { className: "dscl-iconBtn", type: "button", "aria-label": t("닫기", "Close"), onClick: onClose }, h(IconClose, null))),
        h("p", { className: "dscl-lightboxPrompt" }, item.prompt || t("(프롬프트 없음)", "(no prompt)")),
        h("dl", { className: "dscl-metaList" }, ...rows.map(([label, value]) =>
          h("div", { className: "dscl-metaRow", key: label }, h("dt", null, label), h("dd", null, String(value))))),
        item.negative ? h("div", { className: "dscl-negative" },
          h("span", null, t("제외 프롬프트", "Negative prompt")),
          h("p", null, item.negative)) : null,
        h("div", { className: "dscl-lightboxActions" },
          h("button", { className: "dscl-btn primary", type: "button", onClick: () => onCopy(item) }, h(IconCopy, null), t("프롬프트 복사", "Copy prompt")),
          h("button", { className: "dscl-btn ghost", type: "button", onClick: () => onDelete(item) }, h(IconTrash, null), t("갤러리에서 삭제", "Remove from gallery"))))));
}

function ModelsView({ state: s, actions }) {
  const q = s.modelsQuery.trim().toLowerCase();
  const all = s.models?.folders ?? [];
  const folders = all
    .map((folder) => ({
      name: folder.name,
      files: q ? folder.files.filter((file) => file.toLowerCase().includes(q)) : folder.files,
    }))
    .filter((folder) => folder.files.length > 0);
  const shown = folders.reduce((sum, folder) => sum + folder.files.length, 0);
  const loading = s.modelsLoading && !s.models;
  return h("div", null,
    h("div", { className: "dscl-toolbar" },
      h("input", { className: "dscl-input dscl-search", type: "search", value: s.modelsQuery, placeholder: t("모델 이름 검색", "Search model names"), onChange: (event) => actions.searchModels(event.target.value) }),
      h("span", { className: "dscl-count" }, t(`${shown}개 · 폴더 ${folders.length}개`, `${shown} files · ${folders.length} folders`))),
    s.modelsError ? h("div", { className: "dscl-notice bad" }, h("p", null, s.modelsError)) : null,
    loading ? h("div", { className: "dscl-empty" }, t("모델 목록을 불러오는 중입니다…", "Loading installed models…")) : null,
    !loading && folders.length === 0 ? h("div", { className: "dscl-empty" },
      h("strong", null, t("설치된 모델이 없습니다", "No installed models")),
      h("span", null, t("ComfyUI의 models 폴더에 체크포인트나 LoRA를 넣으면 여기에 나타납니다.", "Add checkpoints or LoRAs to ComfyUI's models folder and they appear here."))) : null,
    h("div", { className: "dscl-models" }, ...folders.map((folder) =>
      h("section", { className: "dscl-modelGroup", key: folder.name },
        h("header", { className: "dscl-modelHead" },
          h("span", { className: "dscl-modelName" }, folder.name),
          h("span", { className: "dscl-modelCount" }, t(`${folder.files.length}개`, `${folder.files.length} files`))),
        h("div", { className: "dscl-modelList" }, ...folder.files.map((file) =>
          h("div", { className: "dscl-modelRow", key: file },
            h("span", { className: "dscl-modelFile", title: file }, file),
            h("button", { className: "dscl-mini", type: "button", onClick: () => actions.copyText(file) }, h(IconCopy, null), t("복사", "Copy")))))))),
    h("p", { className: "dscl-foot" }, t(
      "목록은 ComfyUI의 model 폴더를 그대로 읽습니다. 생성할 때는 에이전트에게 모델 이름을 알려 주세요(comfy_generate의 model 인자).",
      "The list mirrors ComfyUI's model folders. Tell the agent the model name when generating (comfy_generate's model argument).")));
}

/* ── 설정 페이지 ─────────────────────────────────────────────────────── */

function settingsPage(ctx, form) {
  return function ComfySettings({ view }) {
    const state = React.useSyncExternalStore((fn) => form.subscribe(fn), () => form.getSnapshot(), () => form.getSnapshot());
    const [draft, setDraft] = useState("");
    const [model, setModel] = useState("");
    const [test, setTest] = useState(null);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState("");
    useEffect(() => {
      if (state.status === "ready") {
        setDraft((current) => current === "" ? state.value?.baseUrl ?? "" : current);
        setModel((current) => current === "" ? state.value?.defaultModel ?? "" : current);
      }
    }, [state.status]);
    if (view === "summary") return h("span", null, t("갤러리 · ComfyUI 연결", "Gallery · ComfyUI connection"));
    if (state.status !== "ready") return h("p", { role: "status" }, t("설정을 불러오는 중입니다.", "Loading settings…"));
    const off = !state.writable || busy;
    const save = async (field, value) => {
      setSaved("");
      try {
        if (await form.set(field, value)) setSaved(t("저장했습니다.", "Saved."));
        else setSaved(t("저장하지 못했습니다.", "Could not save."));
      } catch { setSaved(t("저장하지 못했습니다.", "Could not save.")); }
    };
    const runTest = async () => {
      setBusy(true); setTest(null);
      const result = await call(`${API}/test`, { baseUrl: draft.trim() });
      setTest(result);
      setBusy(false);
    };
    const device = test?.devices?.[0];
    return h("div", { className: "dscl-settings" },
      h("label", { className: "dscl-field" },
        h("span", { className: "dscl-label" }, t("ComfyUI 주소", "ComfyUI address")),
        h("input", { className: "dscl-input", type: "url", value: draft, placeholder: "http://127.0.0.1:8188", disabled: off, onChange: (event) => setDraft(event.target.value), onBlur: () => save("baseUrl", draft.trim()), onKeyDown: (event) => { if (event.key === "Enter") save("baseUrl", draft.trim()); } }),
        h("p", { className: "dscl-hint" }, t("상시 SSH 터널이면 http://127.0.0.1:8188, 같은 LAN이면 http://192.168.0.36:8188 입니다.", "Use http://127.0.0.1:8188 for the persistent SSH tunnel, or http://192.168.0.36:8188 on the same LAN."))),
      h("div", { className: "dscl-settingsActions" },
        h("button", { className: "dscl-btn", type: "button", disabled: off || draft.trim() === "", onClick: runTest }, busy ? t("확인 중…", "Checking…") : t("연결 테스트", "Test connection")),
        saved ? h("span", { className: "dscl-hint", role: "status" }, saved) : null),
      test ? (test.error
        ? h("div", { className: "dscl-test bad" }, h("span", null, test.error))
        : h("div", { className: "dscl-test" },
          h("strong", null, t(`연결됨 · ComfyUI ${test.comfyuiVersion ?? "?"}`, `Connected · ComfyUI ${test.comfyuiVersion ?? "?"}`)),
          device ? h("span", null, `${device.name ?? "GPU"} · VRAM ${Math.round((device.vramTotalMb ?? 0) / 1024)}GB`) : null,
          h("span", null, t(`대기 ${test.running} · 대기열 ${test.pending} · 모델 ${test.checkpoints?.length ?? 0}개`, `Running ${test.running} · queued ${test.pending} · ${test.checkpoints?.length ?? 0} models`)))) : null,
      h("label", { className: "dscl-field" },
        h("span", { className: "dscl-label" }, t("기본 체크포인트 모델", "Default checkpoint")),
        h("input", { className: "dscl-input", type: "text", value: model, placeholder: t("비우면 서버의 첫 모델", "Empty uses the server's first model"), disabled: off, onChange: (event) => setModel(event.target.value), onBlur: () => save("defaultModel", model.trim()) }),
        test?.checkpoints?.length ? h("p", { className: "dscl-hint" }, test.checkpoints.join(" · ")) : null),
      h("label", { className: "dscl-settingsRow" },
        h("span", null, t("갤러리를 열 때 새 결과 자동 가져오기", "Sync new results when the gallery opens")),
        h("input", { type: "checkbox", role: "switch", checked: state.value?.autoSync !== false, disabled: !state.writable, onChange: (event) => save("autoSync", event.target.checked) })),
      h("p", { className: "dscl-hint" }, t("결과는 $DSH_HOME/comfy-library 에 저장되며, ComfyUI 기록이 지워져도 남습니다.", "Results are stored in $DSH_HOME/comfy-library and survive ComfyUI history cleanup.")));
  };
}

function apply(ctx) {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS.join("\n");
    document.head.append(style);
    ctx.effect(() => () => style.remove(), `${PLUGIN}: style`);
  }

  const store = createStore({
    tab: "gallery", kind: "all",
    items: [], total: 0, query: "", loading: false, itemsError: "",
    status: null, statusError: "", selected: null,
    models: null, modelsLoading: false, modelsError: "", modelsQuery: "",
  });

  let refreshTimer = null;

  const loadItems = async (query = store.get().query, kind = store.get().kind, { silent = false } = {}) => {
    if (!silent) store.set({ loading: true, itemsError: "" });
    const params = new URLSearchParams({ limit: "120", query });
    if (kind && kind !== "all") params.set("kind", kind);
    const result = await call(`${API}/items?${params.toString()}`);
    if (result.error) {
      store.set({ loading: false, itemsError: result.error });
      return;
    }
    const items = result.items ?? [];
    const selected = store.get().selected;
    store.set({
      loading: false,
      items,
      total: result.total ?? 0,
      selected: selected ? items.find((item) => item.id === selected.id) ?? null : null,
    });
  };

  const loadModels = async () => {
    store.set({ modelsLoading: true, modelsError: "" });
    const result = await call(`${API}/models`);
    if (result.error) {
      store.set({ modelsLoading: false, modelsError: result.error });
      return;
    }
    store.set({ modelsLoading: false, models: result, modelsError: "" });
  };

  const loadStatus = async () => {
    store.set({ statusError: "" });
    const result = await call(`${API}/status`);
    if (result.error) store.set({ status: null, statusError: result.error });
    else if (result.ok === false) store.set({ status: null, statusError: result.error || t("ComfyUI에 연결하지 못했습니다.", "Could not reach ComfyUI.") });
    else store.set({ status: result, statusError: "" });
  };

  const actions = {
    refresh: () => { void loadItems(); void loadStatus(); },
    refreshModels: () => void loadModels(),
    retryStatus: () => void loadStatus(),
    tab(name) {
      store.set({ tab: name });
      if (name === "models" && !store.get().models) void loadModels();
      void loadStatus();
    },
    kind(kind) {
      store.set({ kind });
      void loadItems(store.get().query, kind);
    },
    search(query) {
      store.set({ query });
      void loadItems(query, store.get().kind);
    },
    searchModels(query) { store.set({ modelsQuery: query }); },
    open(item) { store.set({ selected: item }); },
    close() { store.set({ selected: null }); },
    async copyPrompt(item) {
      try { await navigator.clipboard.writeText(item.prompt ?? ""); } catch { /* 클립보드가 없으면 조용히 */ }
    },
    async copyText(text) {
      try { await navigator.clipboard.writeText(text); } catch { /* 클립보드가 없으면 조용히 */ }
    },
    async remove(item) {
      const ok = window.confirm(t("이 항목을 갤러리에서 지울까요?", "Remove this item from the gallery?"));
      if (!ok) return;
      const result = await call(`${API}/delete`, { id: item.id });
      if (result.error) {
        store.set({ itemsError: result.error });
        return;
      }
      const selected = store.get().selected;
      store.set({ selected: selected && selected.id === item.id ? null : selected });
      await loadItems(store.get().query, store.get().kind);
    },
  };

  void loadItems();
  void loadStatus();

  // 에이전트가 새로 만든 결과를 화면에 바로 반영한다. 검색어와 필터는 유지한다.
  refreshTimer = setInterval(() => {
    try {
      if (document.visibilityState === "visible" && store.get().tab === "gallery") {
        void loadItems(store.get().query, store.get().kind, { silent: true });
      }
    } catch { /* 무시 */ }
  }, 15000);
  ctx.effect(() => () => { if (refreshTimer) clearInterval(refreshTimer); }, `${PLUGIN}: refresh timer`);

  // 자리: 사이드바 패널 행. 자동화 작업(10) · 작업 대상(20) 다음, 더 보기 앞(30).
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: PANEL_ID, inject: () => ({ store, actions }) }, GalleryPage));
  // 슬롯 라벨은 apply 시점에 한 번 정해진다. 이때 셸의 한국어 번역이 아직 문서 언어를
  // 세우기 전이라 영어로 굳는 일이 있어, 문서 언어·locale 이 바뀌면 라벨을 다시 등록한다.
  const locale = ctx.get("locale");
  const localeActive = () => {
    try { return String(locale?.getLocale?.()?.active ?? ""); } catch { return ""; }
  };
  const shellKorean = () => {
    const docLang = (() => { try { return String(document.documentElement?.lang ?? ""); } catch { return ""; } })();
    const active = docLang || localeActive();
    if (!active) return true;
    return active.toLowerCase().startsWith("ko");
  };
  ctx.slots.inject("sidebar.panellist", () => ctx.effect(() => {
    let dispose = null;
    let current = "";
    const mount = () => {
      const label = shellKorean() ? "생성 갤러리" : "Generation gallery";
      if (label === current) return;
      current = label;
      if (dispose) dispose();
      dispose = ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 30, label }, IconGallery);
    };
    mount();
    const observer = typeof MutationObserver === "function"
      ? new MutationObserver(() => mount())
      : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    const unsubscribe = typeof locale?.subscribe === "function" ? locale.subscribe(() => mount()) : null;
    return () => { observer?.disconnect(); if (typeof unsubscribe === "function") unsubscribe(); dispose?.(); };
  }, `${PLUGIN}: sidebar label`));

  const configForms = ctx.get("configForms");
  if (configForms) {
    ctx.slots.inject("plugins.row.config", () =>
      ctx.slots.register({ name: "plugins.row.config", key: `${PLUGIN}#${ENTRY_ID}` }, settingsPage(ctx, configForms.get(ENTRY_ID))));
  }
}

exports.inject = ["slots", "configForms"];
exports.apply = apply;

return module.exports;
} });
