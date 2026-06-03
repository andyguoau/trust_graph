const SHARE_KIND = "trust_graph_labels";
const SHARE_VERSION = 1;
const MAX_BODY_BYTES = 900_000;
const MAX_LABELS = 20_000;
const MAX_PUBLIC_WRITES_PER_HOUR = 30;
const LABEL_KEYS = new Set(["trust", "scammer", "suspect", "propaganda", "idiot", "neutral"]);

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Xtag-Token,X-Trust-Graph-Token",
      ...extraHeaders,
    },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function baseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function makeShareId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validatePublishToken(request, env) {
  if (!env.PUBLISH_TOKEN) return true;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const explicit = request.headers.get("X-Xtag-Token") || request.headers.get("X-Trust-Graph-Token") || "";
  return bearer === env.PUBLISH_TOKEN || explicit === env.PUBLISH_TOKEN;
}

async function rateLimitPublicPublish(request, env) {
  if (env.PUBLISH_TOKEN) return null;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `rate:publish:${ip}:${hour}`;
  const current = Number(await env.SHARES.get(key)) || 0;
  if (current >= MAX_PUBLIC_WRITES_PER_HOUR) {
    return jsonResponse({ detail: "publish rate limit exceeded" }, 429, {
      "Retry-After": "3600",
    });
  }
  await env.SHARES.put(key, String(current + 1), { expirationTtl: 7200 });
  return null;
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) {
    throw new Error("request body too large");
  }
  return request.json();
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) {
    throw new Error("labels must be a list");
  }
  if (labels.length > MAX_LABELS) {
    throw new Error(`too many labels; max ${MAX_LABELS}`);
  }
  const normalized = [];
  for (const item of labels) {
    const label = String(item?.label || "").trim();
    const handle = String(item?.handle || "").trim().replace(/^@+/, "");
    const twitterId = String(item?.twitter_id || "").trim();
    if (!LABEL_KEYS.has(label)) continue;
    if (!handle && !twitterId) continue;
    normalized.push({
      twitter_id: twitterId || null,
      handle: handle || null,
      label,
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 1,
      reason: item.reason ? String(item.reason).slice(0, 500) : null,
      source_name: item.source_name ? String(item.source_name).slice(0, 200) : null,
    });
  }
  return normalized;
}

async function createShare(request, env) {
  if (!validatePublishToken(request, env)) {
    return jsonResponse({ detail: "missing or invalid publish token" }, 401);
  }
  const rateLimited = await rateLimitPublicPublish(request, env);
  if (rateLimited) return rateLimited;

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return jsonResponse({ detail: String(error.message || error) }, 400);
  }

  let labels;
  try {
    labels = normalizeLabels(body.labels);
  } catch (error) {
    return jsonResponse({ detail: String(error.message || error) }, 400);
  }
  if (!labels.length) {
    return jsonResponse({ detail: "no valid labels to share" }, 400);
  }

  const shareId = makeShareId();
  const generatedAt = new Date().toISOString();
  const payload = {
    version: SHARE_VERSION,
    kind: SHARE_KIND,
    share_id: shareId,
    author: String(body.author || "").trim() || null,
    title: String(body.title || "").trim() || null,
    generated_at: generatedAt,
    labels,
  };

  await env.SHARES.put(`share:${shareId}`, JSON.stringify(payload), {
    metadata: {
      author: payload.author || "",
      label_count: labels.length,
      generated_at: generatedAt,
    },
  });

  const base = baseUrl(request);
  return jsonResponse({
    ok: true,
    share_id: shareId,
    share_url: `${base}/s/${shareId}`,
    api_url: `${base}/api/shares/${shareId}`,
    label_count: labels.length,
  });
}

async function getShare(shareId, env) {
  const payload = await env.SHARES.get(`share:${shareId}`);
  if (!payload) {
    return jsonResponse({ detail: "share not found" }, 404);
  }
  return new Response(payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}

async function sharePage(shareId, request, env) {
  const raw = await env.SHARES.get(`share:${shareId}`);
  if (!raw) {
    return htmlResponse("<!doctype html><title>Not found</title><h1>Share not found</h1>", 404);
  }
  const payload = JSON.parse(raw);
  const apiUrl = `${baseUrl(request)}/api/shares/${shareId}`;
  const title = escapeHtml(payload.title || "Xtag label share");
  const author = escapeHtml(payload.author || "anonymous");
  const generatedAt = escapeHtml(payload.generated_at || "");
  const count = Array.isArray(payload.labels) ? payload.labels.length : 0;

  return htmlResponse(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #111827; }
    main { max-width: 720px; margin: 8vh auto; padding: 0 20px; }
    section { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 8px 24px rgba(15,23,42,0.06); }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #4b5563; line-height: 1.5; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .metric { background: #f3f4f6; border-radius: 6px; padding: 12px; }
    .metric b { display: block; font-size: 18px; color: #111827; }
    a.button { display: inline-block; background: #111827; color: white; padding: 10px 14px; border-radius: 6px; text-decoration: none; font-weight: 700; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <section data-xtag-share-id="${escapeHtml(shareId)}" data-xtag-api-url="${escapeHtml(apiUrl)}">
      <h1>${title}</h1>
      <p>This is a shared Xtag label snapshot. Open the Xtag extension, paste this link into Import, preview it, then manually merge the labels you want.</p>
      <div class="meta">
        <div class="metric"><span>Author</span><b>${author}</b></div>
        <div class="metric"><span>Labels</span><b>${count}</b></div>
        <div class="metric"><span>Generated</span><b>${generatedAt}</b></div>
      </div>
      <p><a class="button" href="${escapeHtml(apiUrl)}">View raw snapshot</a></p>
      <p>Share link: <code>${escapeHtml(`${baseUrl(request)}/s/${shareId}`)}</code></p>
    </section>
  </main>
</body>
</html>`);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return jsonResponse({});
    }

    const url = new URL(request.url);
    const apiShareMatch = url.pathname.match(/^\/api\/shares\/([^/]+)$/);
    const pageShareMatch = url.pathname.match(/^\/s\/([^/]+)$/);

    try {
      if (request.method === "POST" && url.pathname === "/api/shares") {
        return createShare(request, env);
      }
      if (request.method === "GET" && apiShareMatch) {
        return getShare(apiShareMatch[1], env);
      }
      if (request.method === "GET" && pageShareMatch) {
        return sharePage(pageShareMatch[1], request, env);
      }
      if (request.method === "GET" && url.pathname === "/") {
        return jsonResponse({ service: "xtag-share", endpoints: ["/api/shares", "/api/shares/{id}", "/s/{id}"] });
      }
      return jsonResponse({ detail: "not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ error: String(error?.stack || error) }));
      return jsonResponse({ detail: "internal error" }, 500);
    }
  },
};
