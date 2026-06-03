const LABELS_KEY = "tg_labels_v1";
const AUTHOR_KEY = "tg_author";
const SHARE_BACKEND_KEY = "tg_share_backend";
const DEFAULT_SHARE_BACKEND = "https://xtag-share.andyguoau.workers.dev";

const LABEL_TEXT = {
  trust: "信任",
  scammer: "骗子",
  suspect: "怀疑",
  propaganda: "大外宣",
  idiot: "脑残",
  neutral: "中立",
};

const LABEL_WEIGHT = {
  trust: 1,
  scammer: 1,
  suspect: 1,
  propaganda: 1,
  idiot: 1,
  neutral: 0,
};

let pendingImportPayload = null;
let pendingImportUrl = "";

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function cleanHandleValue(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function cleanHandle() {
  return cleanHandleValue(document.getElementById("editHandle").value);
}

function labelKey(handle) {
  return cleanHandleValue(handle).toLowerCase();
}

function setHtml(id, html) {
  document.getElementById(id).innerHTML = html;
}

function setEditStatus(message, isError = false) {
  setHtml("editStatus", isError ? `<span class="err">${message}</span>` : message);
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

function normalizeBackendUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function labelsForShare(labels) {
  return Object.values(labels)
    .filter((item) => item && item.handle && LABEL_TEXT[item.label])
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .map((item) => ({
      twitter_id: null,
      handle: item.handle,
      label: item.label,
      weight: LABEL_WEIGHT[item.label] ?? 0,
      reason: null,
      source_name: sourceInfoForItem(item).name,
    }));
}

function countByLabel(labels) {
  const counts = Object.fromEntries(Object.keys(LABEL_TEXT).map((label) => [label, 0]));
  for (const item of Object.values(labels)) {
    if (item && counts[item.label] !== undefined) counts[item.label] += 1;
  }
  return counts;
}

function shareApiUrlFromInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("分享链接不是有效 URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("分享链接必须是 HTTPS");
  }
  if (url.pathname.startsWith("/api/shares/")) return url.toString();
  const match = url.pathname.match(/^\/s\/([^/]+)$/);
  if (match) {
    url.pathname = `/api/shares/${match[1]}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  throw new Error("请输入 /s/<id> 或 /api/shares/<id> 分享链接");
}

function validateSharePayload(payload) {
  if (!payload || payload.kind !== "trust_graph_labels" || payload.version !== 1) {
    throw new Error("不是 Xtag 标签分享");
  }
  if (!Array.isArray(payload.labels)) {
    throw new Error("分享内容没有标签列表");
  }
}

function normalizeLabelRecord(item, fallbackKey = "") {
  const handle = cleanHandleValue(item?.handle || fallbackKey);
  const label = String(item?.label || "").trim();
  if (!handle || !LABEL_TEXT[label]) return null;
  const now = new Date().toISOString();
  const sourceType = item.sourceType || (item.source === "shared_import" ? "import" : "manual");
  const legacySourceId = sourceType === "manual"
    ? "manual"
    : item.shareId
      ? `share:${item.shareId}`
      : item.shareUrl
        ? `share:${item.shareUrl}`
        : item.source || "import";
  const sourceId = item.sourceId || legacySourceId;
  return {
    handle,
    label,
    updatedAt: item.updatedAt || now,
    sourceType,
    sourceId,
    sourceName: item.sourceName || (sourceType === "manual" ? "手动添加" : sourceId),
    importedAt: item.importedAt || (sourceType === "manual" ? null : item.updatedAt || now),
    shareUrl: item.shareUrl || null,
    shareId: item.shareId || null,
    author: item.author || null,
  };
}

function normalizeLabels(rawLabels) {
  const normalized = {};
  let changed = false;
  for (const [key, item] of Object.entries(rawLabels || {})) {
    const record = normalizeLabelRecord(item, key);
    if (!record) {
      changed = true;
      continue;
    }
    normalized[labelKey(record.handle)] = record;
    if (JSON.stringify(record) !== JSON.stringify(item)) changed = true;
  }
  return { labels: normalized, changed };
}

function sourceInfoForItem(item) {
  const normalized = normalizeLabelRecord(item);
  if (!normalized || normalized.sourceType === "manual") {
    return {
      id: "manual",
      name: "手动添加",
      type: "manual",
      shareUrl: null,
    };
  }
  return {
    id: normalized.sourceId || "import",
    name: normalized.sourceName || normalized.author || normalized.shareId || "分享导入",
    type: normalized.sourceType || "import",
    shareUrl: normalized.shareUrl || null,
  };
}

function sourceGroups(labels) {
  const groups = new Map();
  for (const item of Object.values(labels)) {
    const info = sourceInfoForItem(item);
    if (!groups.has(info.id)) {
      groups.set(info.id, { ...info, count: 0 });
    }
    groups.get(info.id).count += 1;
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.id === "manual") return -1;
    if (b.id === "manual") return 1;
    return a.name.localeCompare(b.name);
  });
}

async function getLocalLabels() {
  const data = await storageGet(LABELS_KEY);
  const rawLabels = data[LABELS_KEY] && typeof data[LABELS_KEY] === "object"
    ? data[LABELS_KEY]
    : {};
  const normalized = normalizeLabels(rawLabels);
  if (normalized.changed) await setLocalLabels(normalized.labels);
  return normalized.labels;
}

async function setLocalLabels(labels) {
  await storageSet({ [LABELS_KEY]: labels });
}

async function load() {
  const labels = await getLocalLabels();
  const localCounts = countByLabel(labels);
  const total = Object.values(localCounts).reduce((sum, n) => sum + n, 0);

  setHtml("status", `<span class="ok">✓ 本地标签可用（Chrome storage）</span>`);
  setHtml("counts", `
    <div class="row"><span>插件本地标签</span><b>${total.toLocaleString()}</b></div>
    <div class="row"><span>信任</span><b>${localCounts.trust.toLocaleString()}</b></div>
    <div class="row"><span>骗子/怀疑</span><b>${(localCounts.scammer + localCounts.suspect).toLocaleString()}</b></div>
    <div class="row"><span>大外宣/脑残</span><b>${(localCounts.propaganda + localCounts.idiot).toLocaleString()}</b></div>
  `);
  renderSourceList(labels);
}

function renderSourceList(labels) {
  const groups = sourceGroups(labels);
  if (!groups.length) {
    setHtml("sourceList", `<div class="source-row"><div class="source-main"><div class="source-name">暂无标签来源</div></div></div>`);
    return;
  }
  setHtml("sourceList", groups.map((group) => `
    <div class="source-row">
      <div class="source-main">
        <div class="source-name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</div>
        <div class="source-meta">${group.count.toLocaleString()} 个标签${group.shareUrl ? " · 分享导入" : ""}</div>
      </div>
      <button class="danger" data-delete-source="${escapeHtml(group.id)}">删除</button>
    </div>
  `).join(""));
  document.querySelectorAll("[data-delete-source]").forEach((button) => {
    button.addEventListener("click", () => deleteSource(button.dataset.deleteSource));
  });
}

async function loadSettings() {
  const data = await storageGet([AUTHOR_KEY, SHARE_BACKEND_KEY]);
  if (data[AUTHOR_KEY]) document.getElementById("author").value = data[AUTHOR_KEY];
  document.getElementById("shareBackend").value = data[SHARE_BACKEND_KEY] || DEFAULT_SHARE_BACKEND;
}

async function saveSettings() {
  await storageSet({
    [AUTHOR_KEY]: document.getElementById("author").value.trim(),
    [SHARE_BACKEND_KEY]: normalizeBackendUrl(document.getElementById("shareBackend").value),
  });
}

async function publishShare() {
  const btn = document.getElementById("publish");
  const author = document.getElementById("author").value.trim();
  const shareStatus = document.getElementById("shareStatus");
  const shareLink = document.getElementById("shareLink");
  const backend = normalizeBackendUrl(document.getElementById("shareBackend").value);
  const labels = labelsForShare(await getLocalLabels());

  if (!backend) {
    shareStatus.innerHTML = `<span class="err">请先填写 HTTPS 分享后台地址。</span>`;
    return;
  }
  if (!labels.length) {
    shareStatus.innerHTML = `<span class="err">还没有插件本地标签可分享。</span>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = "发布中 …";
  shareStatus.textContent = "";
  await saveSettings();

  try {
    const r = await fetch(`${backend}/api/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author, labels }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    shareLink.value = data.share_url;
    shareStatus.innerHTML = `已发布 ${data.label_count.toLocaleString()} 个插件本地标签。`;
    try {
      await navigator.clipboard.writeText(data.share_url);
      shareStatus.innerHTML += " 已复制。";
    } catch {
      shareStatus.innerHTML += " 可手动复制。";
    }
  } catch (e) {
    shareStatus.innerHTML = `<span class="err">发布失败：${String(e.message || e)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "发布我的标签短链接";
  }
}

async function refreshCurrentLabel() {
  const handle = cleanHandle();
  if (!handle) {
    setEditStatus("");
    return;
  }
  const labels = await getLocalLabels();
  const item = labels[labelKey(handle)];
  if (item && LABEL_TEXT[item.label]) {
    document.getElementById("editLabel").value = item.label;
    const source = sourceInfoForItem(item);
    setEditStatus(
      `当前插件本地标签：${LABEL_TEXT[item.label]}。来源：${escapeHtml(source.name)}`
    );
  } else {
    setEditStatus("当前没有插件本地标签。");
  }
}

async function saveLabel() {
  const handle = cleanHandle();
  const label = document.getElementById("editLabel").value;
  const btn = document.getElementById("saveLabel");
  if (!handle) {
    setEditStatus("请输入 handle。", true);
    return;
  }
  btn.disabled = true;
  btn.textContent = "保存中 …";
  try {
    const labels = await getLocalLabels();
    labels[labelKey(handle)] = {
      handle,
      label,
      updatedAt: new Date().toISOString(),
      sourceType: "manual",
      sourceId: "manual",
      sourceName: "手动添加",
      importedAt: null,
      shareUrl: null,
      shareId: null,
      author: null,
    };
    await setLocalLabels(labels);
    setEditStatus(`已保存 @${handle} 为 ${LABEL_TEXT[label] || label}。`);
    await load();
  } catch (e) {
    setEditStatus(`保存失败：${String(e.message || e)}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "保存/更新";
  }
}

async function deleteLabel() {
  const handle = cleanHandle();
  const btn = document.getElementById("deleteLabel");
  if (!handle) {
    setEditStatus("请输入 handle。", true);
    return;
  }
  btn.disabled = true;
  btn.textContent = "删除中 …";
  try {
    const labels = await getLocalLabels();
    const existed = Boolean(labels[labelKey(handle)]);
    delete labels[labelKey(handle)];
    await setLocalLabels(labels);
    setEditStatus(
      existed
        ? `已删除 @${handle} 的插件本地标签。`
        : `@${handle} 没有可删除的插件本地标签。`
    );
    await load();
  } catch (e) {
    setEditStatus(`删除失败：${String(e.message || e)}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "删除标签";
  }
}

function summarizeImport(payload, localLabels) {
  let valid = 0;
  let fresh = 0;
  let same = 0;
  let conflicts = 0;
  for (const item of payload.labels) {
    const handle = cleanHandleValue(item?.handle);
    const label = String(item?.label || "").trim();
    if (!handle || !LABEL_TEXT[label]) continue;
    valid += 1;
    const existing = localLabels[labelKey(handle)];
    if (!existing) fresh += 1;
    else if (existing.label === label) same += 1;
    else conflicts += 1;
  }
  return { valid, fresh, same, conflicts };
}

async function previewImport() {
  const btn = document.getElementById("previewImport");
  const importStatus = document.getElementById("importStatus");
  btn.disabled = true;
  btn.textContent = "读取中 …";
  pendingImportPayload = null;
  try {
    const apiUrl = shareApiUrlFromInput(document.getElementById("importLink").value);
    const r = await fetch(apiUrl);
    const payload = await r.json();
    if (!r.ok) throw new Error(payload.detail || `HTTP ${r.status}`);
    validateSharePayload(payload);
    pendingImportPayload = payload;
    pendingImportUrl = apiUrl;
    const summary = summarizeImport(payload, await getLocalLabels());
    importStatus.innerHTML =
      `预览：${summary.valid.toLocaleString()} 个有效标签，` +
      `${summary.fresh.toLocaleString()} 个新增，` +
      `${summary.same.toLocaleString()} 个已相同，` +
      `${summary.conflicts.toLocaleString()} 个冲突。`;
  } catch (e) {
    importStatus.innerHTML = `<span class="err">读取失败：${String(e.message || e)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "预览分享";
  }
}

async function mergeImport() {
  const importStatus = document.getElementById("importStatus");
  if (!pendingImportPayload) {
    importStatus.innerHTML = `<span class="err">请先预览分享。</span>`;
    return;
  }
  const allowConflicts = document.getElementById("allowConflicts").checked;
  const labels = await getLocalLabels();
  const shareId = String(pendingImportPayload.share_id || "").trim();
  const author = String(pendingImportPayload.author || "").trim();
  const sourceId = shareId ? `share:${shareId}` : `share:${pendingImportUrl}`;
  const sourceName = author
    ? `分享：${author}`
    : shareId
      ? `分享：${shareId}`
      : "分享导入";
  let merged = 0;
  let skipped = 0;
  for (const item of pendingImportPayload.labels) {
    const handle = cleanHandleValue(item?.handle);
    const label = String(item?.label || "").trim();
    if (!handle || !LABEL_TEXT[label]) continue;
    const key = labelKey(handle);
    const existing = labels[key];
    if (existing && existing.label !== label && !allowConflicts) {
      skipped += 1;
      continue;
    }
    labels[key] = {
      handle,
      label,
      updatedAt: new Date().toISOString(),
      sourceType: "import",
      sourceId,
      sourceName,
      importedAt: new Date().toISOString(),
      shareUrl: pendingImportUrl,
      shareId: shareId || null,
      author: author || null,
    };
    merged += 1;
  }
  await setLocalLabels(labels);
  pendingImportPayload = null;
  pendingImportUrl = "";
  importStatus.innerHTML = `已合并 ${merged.toLocaleString()} 个标签，跳过 ${skipped.toLocaleString()} 个冲突。`;
  await load();
}

async function deleteSource(sourceId) {
  const sourceStatus = document.getElementById("sourceStatus");
  if (!sourceId) return;
  const labels = await getLocalLabels();
  const group = sourceGroups(labels).find((item) => item.id === sourceId);
  if (!group) {
    sourceStatus.innerHTML = `<span class="err">找不到这个来源。</span>`;
    return;
  }
  const ok = confirm(`删除来源「${group.name}」下的 ${group.count} 个标签？`);
  if (!ok) return;
  let deleted = 0;
  for (const [key, item] of Object.entries(labels)) {
    if (sourceInfoForItem(item).id === sourceId) {
      delete labels[key];
      deleted += 1;
    }
  }
  await setLocalLabels(labels);
  sourceStatus.innerHTML = `已删除来源「${escapeHtml(group.name)}」下的 ${deleted.toLocaleString()} 个标签。`;
  await load();
}

document.getElementById("publish").addEventListener("click", publishShare);
document.getElementById("saveLabel").addEventListener("click", saveLabel);
document.getElementById("deleteLabel").addEventListener("click", deleteLabel);
document.getElementById("previewImport").addEventListener("click", previewImport);
document.getElementById("mergeImport").addEventListener("click", mergeImport);
document.getElementById("editHandle").addEventListener("blur", refreshCurrentLabel);
document.getElementById("author").addEventListener("change", saveSettings);
document.getElementById("shareBackend").addEventListener("change", saveSettings);
document.getElementById("editHandle").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") refreshCurrentLabel();
});
loadSettings();
load();
