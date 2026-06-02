// Xtag content script. Adds one local-label badge beside X account names.

const LABELS_KEY = "tg_labels_v1";
const LANG_KEY = "tg_lang";
const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com"]);

const LABELS = {
  trust: { zh: "信任", en: "Trust", cls: "tg-trust" },
  scammer: { zh: "骗子", en: "Scammer", cls: "tg-scammer" },
  suspect: { zh: "怀疑", en: "Suspect", cls: "tg-suspect" },
  propaganda: { zh: "大外宣", en: "Propaganda", cls: "tg-propaganda" },
  idiot: { zh: "脑残", en: "Idiot", cls: "tg-idiot" },
  neutral: { zh: "中立", en: "Neutral", cls: "tg-unknown" },
};

const RESERVED = new Set([
  "home", "explore", "notifications", "messages", "i", "search", "compose",
  "settings", "tos", "privacy", "about", "login", "signup", "logout", "jobs",
  "premium", "lists", "bookmarks", "communities", "topics", "verified-choose",
  "intent", "share", "hashtag",
]);

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function cleanHandleValue(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function labelKey(handle) {
  return cleanHandleValue(handle).toLowerCase();
}

function detectLang() {
  const stored = (() => {
    try { return localStorage.getItem(LANG_KEY); } catch { return null; }
  })();
  if (stored === "zh" || stored === "en") return stored;
  return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

let currentLang = detectLang();

function labelText(label) {
  return LABELS[label]?.[currentLang] || "?";
}

function setLang(lang) {
  currentLang = lang === "zh" ? "zh" : "en";
  try { localStorage.setItem(LANG_KEY, currentLang); } catch {}
  refreshAllBadges();
}

async function getLocalLabels() {
  const data = await storageGet(LABELS_KEY);
  const rawLabels = data[LABELS_KEY] && typeof data[LABELS_KEY] === "object"
    ? data[LABELS_KEY]
    : {};
  const normalized = {};
  for (const [key, item] of Object.entries(rawLabels)) {
    const handle = cleanHandleValue(item?.handle || key);
    const label = String(item?.label || "").trim();
    if (!handle || !LABELS[label]) continue;
    normalized[labelKey(handle)] = { ...item, handle, label };
  }
  return normalized;
}

async function saveLocalLabel(handle, label) {
  const labels = await getLocalLabels();
  labels[labelKey(handle)] = {
    handle: cleanHandleValue(handle),
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
  await storageSet({ [LABELS_KEY]: labels });
}

async function deleteLocalLabel(handle) {
  const labels = await getLocalLabels();
  delete labels[labelKey(handle)];
  await storageSet({ [LABELS_KEY]: labels });
}

function handleFromAnchor(anchor) {
  if (!anchor || !anchor.href) return null;
  let url;
  try { url = new URL(anchor.href); } catch { return null; }
  if (!X_HOSTS.has(url.hostname)) return null;
  const handle = url.pathname.split("/").filter(Boolean)[0];
  if (!handle || RESERVED.has(handle.toLowerCase())) return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function findTweetNameRow(article) {
  const userNameBlock = article.querySelector('[data-testid="User-Name"]');
  if (!userNameBlock) return null;
  const link = userNameBlock.querySelector('a[role="link"][href^="/"]');
  const handle = handleFromAnchor(link);
  if (!handle) return null;

  let row = link;
  while (row && row.parentElement !== userNameBlock) row = row.parentElement;
  return { row: row || userNameBlock.firstElementChild || userNameBlock, handle };
}

function findProfileHandle() {
  const userName = document.querySelector('[data-testid="UserName"]');
  if (!userName) return null;
  const handleSpan = userName.querySelector('div[dir="ltr"] span');
  const match = handleSpan?.textContent?.match(/^@([A-Za-z0-9_]{1,15})$/);
  if (match) return { container: userName, handle: match[1] };

  const firstPath = location.pathname.split("/").filter(Boolean)[0];
  if (firstPath && !RESERVED.has(firstPath.toLowerCase())) {
    return { container: userName, handle: firstPath };
  }
  return null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function buildBadge(handle, label) {
  const badge = document.createElement("span");
  badge.className = `tg-badge ${LABELS[label]?.cls || "tg-unknown"}`;
  badge.dataset.tgHandle = handle;
  badge.title = label ? labelText(label) : "No local label";

  const inner = document.createElement("span");
  inner.textContent = label ? labelText(label) : "?";
  badge.appendChild(inner);

  badge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPopup(badge, handle, label);
  });
  return badge;
}

async function refreshBadgesForHandle(handle) {
  const labels = await getLocalLabels();
  const record = labels[labelKey(handle)];
  document.querySelectorAll(`.tg-badge[data-tg-handle="${CSS.escape(handle)}"]`).forEach((badge) => {
    badge.replaceWith(buildBadge(handle, record?.label || null));
  });
}

function refreshAllBadges() {
  const handles = new Set();
  document.querySelectorAll(".tg-badge[data-tg-handle]").forEach((badge) => {
    handles.add(badge.dataset.tgHandle);
  });
  handles.forEach(refreshBadgesForHandle);
}

async function ensureBadge(container, target, handle) {
  if (container.dataset.tgBadged === handle) return;
  container.querySelectorAll(".tg-badge").forEach((badge) => badge.remove());

  const labels = await getLocalLabels();
  const badge = buildBadge(handle, labels[labelKey(handle)]?.label || null);
  target.appendChild(badge);
  container.dataset.tgBadged = handle;
}

function ensureBadgeForTweet(article) {
  const found = findTweetNameRow(article);
  if (!found) return;
  ensureBadge(article, found.row, found.handle);
}

function ensureBadgeForProfileHeader() {
  const found = findProfileHandle();
  if (!found) return;
  const row = found.container.querySelector("div") || found.container;
  ensureBadge(found.container, row, found.handle);
}

let activePopup = null;

function closePopup() {
  if (!activePopup) return;
  activePopup.remove();
  activePopup = null;
  document.removeEventListener("click", onDocumentClick, true);
}

function onDocumentClick(event) {
  if (activePopup && !activePopup.contains(event.target) && !event.target.classList?.contains("tg-badge")) {
    closePopup();
  }
}

function openPopup(anchor, handle, currentLabel) {
  closePopup();

  const rect = anchor.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "tg-popup";
  popup.style.top = `${window.scrollY + rect.bottom + 6}px`;
  popup.style.left = `${window.scrollX + Math.min(Math.max(12, rect.left), window.innerWidth - 352)}px`;

  const currentTag = currentLabel ? `<span class="tg-own-tag">${escapeHtml(labelText(currentLabel))}</span>` : "";
  popup.innerHTML = `
    <div class="tg-head">
      <span class="tg-handle">@${escapeHtml(handle)}</span>
      ${currentTag}
      <span class="tg-lang-toggle" data-lang="${currentLang === "zh" ? "en" : "zh"}">${currentLang === "zh" ? "EN" : "中"}</span>
    </div>
    <div class="tg-actions">
      ${Object.keys(LABELS).map((label) => (
        `<button class="btn-${label}" data-act="${label}">${escapeHtml(labelText(label))}</button>`
      )).join("")}
      <button class="btn-clear" data-act="clear">删除</button>
    </div>
  `;

  popup.querySelector(".tg-lang-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    setLang(event.target.dataset.lang);
    closePopup();
    openPopup(anchor, handle, currentLabel);
  });

  popup.querySelectorAll("button[data-act]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try {
        if (button.dataset.act === "clear") {
          await deleteLocalLabel(handle);
        } else {
          await saveLocalLabel(handle, button.dataset.act);
        }
        await refreshBadgesForHandle(handle);
        closePopup();
      } catch (error) {
        console.error(error);
        button.textContent = "失败";
      }
    });
  });

  document.body.appendChild(popup);
  activePopup = popup;
  setTimeout(() => document.addEventListener("click", onDocumentClick, true), 0);
}

function scan(root = document) {
  const articles = root.querySelectorAll
    ? root.querySelectorAll('[data-testid="tweet"], article[role="article"]')
    : [];
  articles.forEach(ensureBadgeForTweet);
  ensureBadgeForProfileHeader();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[LABELS_KEY]) refreshAllBadges();
});

if (X_HOSTS.has(location.hostname)) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) scan(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => scan(), 400);
    }
  }).observe(document, { subtree: true, childList: true });

  scan();
  console.log("[xtag] content script loaded");
}
