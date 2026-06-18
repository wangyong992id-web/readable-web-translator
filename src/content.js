const STATE = {
  mode: "idle",
  running: false,
  abort: false,
  originals: new WeakMap(),
  inserted: new Set(),
  translatedElements: new WeakSet(),
  translatedSegments: new WeakMap(),
  translatedTextNodes: new WeakSet(),
  siteEnabled: true,
  imageTranslateEnabled: false,
  selectionTranslateEnabled: false,
  toolbarDrag: null,
  generation: 0,
  settings: null
};

let observer = null;
let observerTimer = null;
let imageObserver = null;
let pendingAutoSync = false;
let selectionTimer = null;
let selectionRequestId = 0;
const imageTranslationCache = new Map();

const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "textarea",
  "input",
  "select",
  "option",
  "code",
  "pre",
  "[contenteditable='true']",
  ".rwt-toolbar",
  ".rwt-selection-popover",
  ".rwt-image-result",
  ".rwt-anchor",
  ".rwt-translation",
  ".rwt-inline"
].join(",");

const TRANSLATABLE_TEXT_RE = /[A-Za-z\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

init().catch((error) => {
  if (isExtensionContextInvalidated(error)) {
    setStatus("需刷新");
    return;
  }
  console.error("[RWT]", error);
});

async function init() {
  STATE.settings = await getSettings();
  syncFeatureFlags();
  applyFeatureState();
  setupSelectionTranslate();
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    if (!hasFeatureStateChange(changes)) return;
    try {
      STATE.settings = await getSettings();
      syncFeatureFlags();
      applyFeatureState();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        setStatus("需刷新");
        return;
      }
      console.error("[RWT]", error);
    }
  });
}

function syncFeatureFlags() {
  STATE.siteEnabled = STATE.settings?.siteEnabled !== false;
  STATE.selectionTranslateEnabled = STATE.siteEnabled && Boolean(STATE.settings?.selectionTranslateEnabled);
  STATE.imageTranslateEnabled = STATE.siteEnabled && Boolean(STATE.settings?.imageTranslateEnabled);
}

function hasFeatureStateChange(changes) {
  return Boolean(
    changes.disabledSites ||
      changes.selectionTranslateEnabled ||
      changes.imageTranslateEnabled
  );
}

function applyFeatureState() {
  if (!STATE.siteEnabled) {
    restorePage();
    removeToolbar();
    teardownImageTranslate();
    hideSelectionPopover();
    return;
  }

  createToolbar();
  if (STATE.imageTranslateEnabled) {
    setupImageTranslate();
  } else {
    teardownImageTranslate();
  }

  if (!STATE.selectionTranslateEnabled) hideSelectionPopover();
}

function createToolbar() {
  if (document.querySelector(".rwt-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.className = "rwt-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="rwt-fab" data-action="toggle" title="翻译工具">
      <span class="rwt-fab-main">译</span>
      <span class="rwt-fab-status">就绪</span>
    </button>
    <div class="rwt-panel" aria-hidden="true">
      <button type="button" data-action="bilingual" title="双语对照">双</button>
      <button type="button" data-action="replace" title="全文翻译">全</button>
      <button type="button" data-action="restore" title="恢复原文">还</button>
    </div>
  `;
  applyToolbarPosition(toolbar, STATE.settings?.toolbarPosition);
  setupToolbarDrag(toolbar);

  toolbar.addEventListener("click", async (event) => {
    if (toolbar.dataset.suppressClick === "true") {
      delete toolbar.dataset.suppressClick;
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle") {
      toggleToolbar();
      return;
    }
    if (action === "restore") {
      restorePage();
      setActiveButton();
      collapseToolbar();
      return;
    }
    await translatePage(action);
    collapseToolbar();
  });

  document.documentElement.append(toolbar);
}

function setupToolbarDrag(toolbar) {
  const handle = toolbar.querySelector(".rwt-fab");
  if (!handle) return;
  handle.title = "翻译工具（按住拖动）";

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = toolbar.getBoundingClientRect();
    STATE.toolbarDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    handle.setPointerCapture?.(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    const drag = STATE.toolbarDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (dx + dy < 4 && !drag.moved) return;
    drag.moved = true;
    toolbar.dataset.dragging = "true";
    moveToolbarTo(toolbar, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  });

  handle.addEventListener("pointerup", async (event) => {
    const drag = STATE.toolbarDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    STATE.toolbarDrag = null;
    handle.releasePointerCapture?.(event.pointerId);
    delete toolbar.dataset.dragging;
    if (!drag.moved) return;
    toolbar.dataset.suppressClick = "true";
    const rect = toolbar.getBoundingClientRect();
    const position = clampToolbarPosition(rect.left, rect.top, rect.width, rect.height);
    await chrome.storage.local.set({ toolbarPosition: position });
  });

  handle.addEventListener("pointercancel", () => {
    STATE.toolbarDrag = null;
    delete toolbar.dataset.dragging;
  });
}

function applyToolbarPosition(toolbar, position) {
  const normalized = normalizeToolbarPosition(position);
  if (!normalized) return;
  moveToolbarTo(toolbar, normalized.x, normalized.y);
}

function moveToolbarTo(toolbar, x, y) {
  const rect = toolbar.getBoundingClientRect();
  const position = clampToolbarPosition(x, y, rect.width || 38, rect.height || 42);
  toolbar.style.left = `${position.x}px`;
  toolbar.style.top = `${position.y}px`;
  toolbar.style.right = "auto";
  toolbar.style.transform = "none";
}

function clampToolbarPosition(x, y, width, height) {
  const margin = 4;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.round(Math.min(maxX, Math.max(margin, x))),
    y: Math.round(Math.min(maxY, Math.max(margin, y)))
  };
}

function normalizeToolbarPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function removeToolbar() {
  document.querySelector(".rwt-toolbar")?.remove();
}

async function translatePage(mode, options = {}) {
  if (!STATE.siteEnabled) return;
  if (STATE.running) {
    STATE.abort = true;
    setStatus("停止中");
    return;
  }

  STATE.mode = mode;
  STATE.abort = false;
  STATE.running = true;
  const generation = options.incremental ? STATE.generation : ++STATE.generation;
  setActiveButton(mode);
  if (!options.incremental) clearInserted();

  try {
    STATE.settings = await getSettings();
    if (!STATE.settings.hasApiKey) {
      setStatus("需设置");
      chrome.runtime.openOptionsPage();
      return;
    }

    if (!options.incremental) startAutoTranslate();

    const candidates = mode === "bilingual" ? collectBlockItems() : collectTextNodes();
    if (!candidates.length) {
      setStatus(options.incremental ? "已同步" : "无新增");
      return;
    }
    const chunks = chunk(candidates, Number(STATE.settings.batchSize) || 12);
    let done = 0;
    setStatus(`0/${candidates.length}`);

    await runPool(chunks, Number(STATE.settings.concurrency) || 3, async (items) => {
      if (STATE.abort || generation !== STATE.generation || STATE.mode !== mode) return;
      const translations = await translateBatch(items.map((item) => item.text));
      items.forEach((item, index) => {
        if (!translations[index] || STATE.abort || generation !== STATE.generation || STATE.mode !== mode) return;
        applyTranslation(item, translations[index], mode);
      });
      done += items.length;
      if (generation === STATE.generation && STATE.mode === mode) {
        setStatus(`${Math.min(done, candidates.length)}/${candidates.length}`);
      }
    });

    if (generation === STATE.generation && STATE.mode === mode) {
      setStatus(STATE.abort ? "已停止" : "完成");
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setStatus("需刷新");
      return;
    }
    console.error("[RWT]", error);
    if (generation === STATE.generation && STATE.mode === mode) {
      setStatus("失败");
      alert(error.message || String(error));
    }
  } finally {
    STATE.running = false;
    if (generation === STATE.generation && STATE.mode === mode) {
      STATE.abort = false;
    }
    if (pendingAutoSync && STATE.mode !== "idle" && generation === STATE.generation) {
      pendingAutoSync = false;
      scheduleAutoTranslate(350);
    }
  }
}

function collectTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement || node.parentElement.closest(SKIP_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }

      const text = normalizeText(node.nodeValue);
      if (!shouldTranslate(text)) return NodeFilter.FILTER_REJECT;
      if (STATE.translatedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;

      const rect = node.parentElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, text: normalizeText(walker.currentNode.nodeValue) });
  }

  return nodes.slice(0, 500);
}

function collectBlockItems() {
  const selector = [
    "[data-testid='tweetText']",
    "[lang] p",
    "article p",
    "article li",
    "main p",
    "main li",
    "p",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6"
  ].join(",");
  const used = [];
  const items = [];

  document.querySelectorAll(selector).forEach((element) => {
    if (element.closest(SKIP_SELECTOR)) return;
    if (used.some((parent) => parent.contains(element) || element.contains(parent))) return;
    if (!isVisible(element)) return;

    if (element.matches("[data-testid='tweetText']")) {
      if (!STATE.translatedElements.has(element)) {
        const text = getTweetTranslationText(element);
        if (!shouldTranslate(text)) return;
        const segments = getTweetParagraphSegments(element, splitTranslationParagraphs(text));
        used.push(element);
        if (segments.length > 1) {
          const translatedKeys = getTranslatedSegmentKeys(element);
          segments.forEach((segment) => {
            if (!translatedKeys.has(segment.key)) {
              items.push({ kind: "tweetParagraph", element, ...segment });
            }
          });
        } else {
          items.push({ kind: "tweet", element, text, paragraphs: splitTranslationParagraphs(text) });
        }
      }
      return;
    }

    if (STATE.translatedElements.has(element)) return;

    const text = normalizeText(getOwnVisibleText(element));
    if (!shouldTranslate(text)) return;

    used.push(element);
    items.push({ element, text });
  });

  return items.slice(0, 260);
}

function shouldTranslate(text) {
  if (!text || text.length < 3) return false;
  if (/^[\d\s.,:$%#@/\\|+\-=()[\]{}]+$/.test(text)) return false;
  if (isMostlyProtectedMarketSyntax(text)) return false;
  if (!TRANSLATABLE_TEXT_RE.test(text)) return false;
  return true;
}

function isMostlyProtectedMarketSyntax(text) {
  const cleaned = String(text || "")
    .replace(/\$[A-Z]{1,8}\b/g, "")
    .replace(/\b[A-Z]{2,8}\b/g, "")
    .replace(/(?:\$|¥|￥)\s?\d+(?:\.\d+)?(?:[BMK])?/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s?(?:%|B|M|K|万|亿|美元|USD|RMB|CNY)\b/gi, "")
    .replace(/[\s.,;:!?()[\]{}'"“”‘’/\\|-]/g, "");
  return cleaned.length === 0;
}

function applyTranslation(item, translation, mode) {
  if (mode === "bilingual") {
    if (item.kind === "tweetParagraph") {
      applyTweetParagraphTranslation(item, translation);
      return;
    }
    if (item.kind === "tweet") {
      applyTweetTranslation(item, translation);
      return;
    }
    applyBilingualTranslation(item.element, translation);
    return;
  }

  applyReplacement(item.node, translation);
}

function applyReplacement(node, translation) {
  if (!STATE.originals.has(node)) {
    STATE.originals.set(node, node.nodeValue);
  }

  node.nodeValue = preserveEdges(node.nodeValue, translation);
  node.parentElement?.setAttribute("data-rwt-replaced", "true");
  STATE.translatedTextNodes.add(node);
}

function applyBilingualTranslation(element, translation) {
  if (!element || element.closest(SKIP_SELECTOR)) return;
  if (STATE.translatedElements.has(element)) return;

  const tag = document.createElement(isInline(element) ? "span" : "span");
  tag.className = isInline(element) ? "rwt-inline" : "rwt-translation";
  tag.textContent = translation;

  if (isInline(element)) {
    element.insertAdjacentElement("afterend", tag);
  } else {
    element.append(tag);
  }
  STATE.inserted.add(tag);
  STATE.translatedElements.add(element);
}

function applyTweetParagraphTranslation(item, translation) {
  const element = item.element;
  if (!element || element.closest(SKIP_SELECTOR) || !item.anchor) return;
  const translatedKeys = getTranslatedSegmentKeys(element);
  if (translatedKeys.has(item.key)) return;

  const tag = document.createElement("div");
  tag.className = "rwt-translation rwt-tweet-line";
  tag.textContent = translation;
  item.anchor.after(tag);
  STATE.inserted.add(tag);
  translatedKeys.add(item.key);
  STATE.translatedSegments.set(element, translatedKeys);
}

function applyTweetTranslation(item, translation) {
  const element = item.element;
  if (!element || element.closest(SKIP_SELECTOR)) return;
  if (STATE.translatedElements.has(element)) return;

  const sourceParagraphs = item.paragraphs?.length ? item.paragraphs : splitTranslationParagraphs(item.text);
  const translatedParagraphs = splitTranslationParagraphs(translation);
  if (sourceParagraphs.length === translatedParagraphs.length && insertTweetParagraphTranslations(element, translatedParagraphs)) {
    STATE.translatedElements.add(element);
    return;
  }
  if (sourceParagraphs.length > 1 && sourceParagraphs.length === translatedParagraphs.length && renderTweetBilingualFallback(element, sourceParagraphs, translatedParagraphs)) {
    STATE.translatedElements.add(element);
    return;
  }

  const tag = document.createElement("div");
  tag.className = "rwt-translation rwt-tweet-translation rwt-tweet-compact";
  const paragraphs = translatedParagraphs.length ? translatedParagraphs : [translation];

  paragraphs.forEach((paragraph) => {
    const target = document.createElement("div");
    target.className = "rwt-pair-target";
    target.textContent = paragraph;
    tag.append(target);
  });

  element.insertAdjacentElement("afterend", tag);
  STATE.inserted.add(tag);
  STATE.translatedElements.add(element);
}

function insertTweetParagraphTranslations(element, translatedParagraphs) {
  const insertionPoints = getTweetParagraphInsertionPoints(element);
  if (insertionPoints.length !== translatedParagraphs.length) return false;

  insertionPoints.forEach((anchor, index) => {
    const tag = document.createElement("div");
    tag.className = "rwt-translation rwt-tweet-line";
    tag.textContent = translatedParagraphs[index];
    anchor.after(tag);
    STATE.inserted.add(tag);
  });
  return true;
}

function renderTweetBilingualFallback(element, sourceParagraphs, translatedParagraphs) {
  if (element.querySelector(":scope > .rwt-tweet-bilingual-render")) return false;

  const holder = document.createElement("span");
  holder.className = "rwt-tweet-original-holder rwt-anchor";
  holder.hidden = true;
  while (element.firstChild) {
    holder.append(element.firstChild);
  }

  const render = document.createElement("div");
  render.className = "rwt-tweet-bilingual-render";
  sourceParagraphs.forEach((sourceText, index) => {
    const pair = document.createElement("div");
    pair.className = "rwt-tweet-render-pair";

    const source = document.createElement("div");
    source.className = "rwt-tweet-render-source";
    source.textContent = sourceText;
    pair.append(source);

    const target = document.createElement("div");
    target.className = "rwt-translation rwt-tweet-line";
    target.textContent = translatedParagraphs[index];
    pair.append(target);

    render.append(pair);
  });

  element.append(holder, render);
  STATE.inserted.add(holder);
  STATE.inserted.add(render);
  return true;
}

function getTweetParagraphSegments(element, paragraphs) {
  const normalizedParagraphs = paragraphs.map(normalizeText).filter(Boolean);
  if (!normalizedParagraphs.length) return [];

  const anchoredSegments = materializeTweetParagraphAnchors(element, normalizedParagraphs);
  if (anchoredSegments.length === normalizedParagraphs.length) return anchoredSegments;

  const directSegments = getDirectTweetSegments(element);
  if (directSegments.length === normalizedParagraphs.length) {
    return directSegments.map((segment, index) => ({
      key: `p:${index}`,
      text: normalizedParagraphs[index],
      anchor: segment.anchor
    }));
  }

  const leafSegments = getTweetLeafTextSegments(element);
  if (leafSegments.length === normalizedParagraphs.length) {
    return leafSegments.map((segment, index) => ({
      key: `p:${index}`,
      text: normalizedParagraphs[index],
      anchor: segment.anchor
    }));
  }

  const alignedSegments = alignLeafSegmentsToParagraphs(leafSegments, normalizedParagraphs);
  if (alignedSegments.length === normalizedParagraphs.length) return alignedSegments;

  return [];
}

function materializeTweetParagraphAnchors(element, paragraphs) {
  const existingAnchors = Array.from(element.querySelectorAll(":scope > .rwt-anchor"));
  if (existingAnchors.length === paragraphs.length) {
    return existingAnchors.map((anchor, index) => ({
      key: `p:${index}`,
      text: paragraphs[index],
      anchor
    }));
  }

  const textNodes = getTweetTextNodes(element);
  if (!textNodes.length) return [];

  const result = [];
  let paragraphIndex = 0;
  let collected = "";
  let targetKey = compactComparableText(paragraphs[paragraphIndex]);

  for (let nodeIndex = 0; nodeIndex < textNodes.length && paragraphIndex < paragraphs.length; nodeIndex += 1) {
    let node = textNodes[nodeIndex];
    let offset = 0;

    while (node && offset < node.nodeValue.length && paragraphIndex < paragraphs.length) {
      const char = node.nodeValue[offset];
      const comparableChar = compactComparableText(char);
      if (!comparableChar && !collected) {
        offset += 1;
        continue;
      }

      if (comparableChar) collected += comparableChar;
      if (!targetKey.startsWith(collected)) return [];

      if (collected === targetKey) {
        const remainder = offset + 1 < node.nodeValue.length ? node.splitText(offset + 1) : null;
        const anchor = document.createElement("span");
        anchor.className = "rwt-anchor";
        anchor.hidden = true;
        anchor.dataset.rwtParagraph = String(paragraphIndex);
        node.after(anchor);
        STATE.inserted.add(anchor);

        result.push({
          key: `p:${paragraphIndex}`,
          text: paragraphs[paragraphIndex],
          anchor
        });

        paragraphIndex += 1;
        collected = "";
        targetKey = compactComparableText(paragraphs[paragraphIndex]);
        node = remainder;
        offset = 0;
        continue;
      }

      offset += 1;
    }
  }

  return paragraphIndex === paragraphs.length ? result : [];
}

function getTweetTextNodes(element) {
  const nodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement || node.parentElement.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!normalizeText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  return nodes;
}

function getDirectTweetSegments(element) {
  const segments = [];
  let textParts = [];
  let anchor = null;

  const flush = () => {
    const text = normalizeText(textParts.join(" "));
    if (text && anchor) segments.push({ text, anchor });
    textParts = [];
    anchor = null;
  };

  Array.from(element.childNodes).forEach((node) => {
    if (isPluginNode(node)) return;
    if (node.nodeName === "BR") {
      flush();
      return;
    }

    const text = normalizeText(node.textContent || node.nodeValue || "");
    if (!text) return;

    if (node.nodeType === Node.ELEMENT_NODE && isBlockLikeElement(node)) {
      flush();
      segments.push({ text, anchor: node });
      return;
    }

    textParts.push(text);
    anchor = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  });

  flush();
  return segments;
}

function getTweetLeafTextSegments(element) {
  const leaves = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (isPluginNode(node)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
      const text = normalizeText(node.innerText || node.textContent || "");
      if (!text) return NodeFilter.FILTER_SKIP;
      const childText = Array.from(node.children).some((child) => normalizeText(child.innerText || child.textContent || ""));
      return childText ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const node = walker.currentNode;
    leaves.push({ text: normalizeText(node.innerText || node.textContent || ""), anchor: node });
  }

  return leaves;
}

function alignLeafSegmentsToParagraphs(leaves, paragraphs) {
  const result = [];
  let paragraphIndex = 0;
  let collected = "";
  let anchor = null;

  for (const leaf of leaves) {
    if (paragraphIndex >= paragraphs.length) break;
    collected += leaf.text;
    anchor = leaf.anchor;

    const targetKey = compactComparableText(paragraphs[paragraphIndex]);
    const collectedKey = compactComparableText(collected);
    if (!targetKey.startsWith(collectedKey)) return [];

    if (collectedKey === targetKey) {
      result.push({
        key: `p:${paragraphIndex}`,
        text: paragraphs[paragraphIndex],
        anchor
      });
      paragraphIndex += 1;
      collected = "";
      anchor = null;
    }
  }

  return paragraphIndex === paragraphs.length ? result : [];
}

function compactComparableText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function getTranslatedSegmentKeys(element) {
  let translatedKeys = STATE.translatedSegments.get(element);
  if (!translatedKeys) {
    translatedKeys = new Set();
    STATE.translatedSegments.set(element, translatedKeys);
  }
  return translatedKeys;
}

function isBlockLikeElement(element) {
  const display = getComputedStyle(element).display;
  return display.includes("block") || display.includes("list-item") || display.includes("table");
}

function getTweetParagraphInsertionPoints(element) {
  const points = [];
  let lastContentNode = null;
  let hasContent = false;

  Array.from(element.childNodes).forEach((node) => {
    if (isPluginNode(node)) return;
    if (node.nodeName === "BR") {
      if (hasContent && lastContentNode) {
        points.push(lastContentNode);
        hasContent = false;
        lastContentNode = null;
      }
      return;
    }

    const text = normalizeText(node.textContent || node.nodeValue || "");
    if (!text) return;
    hasContent = true;
    lastContentNode = node;
  });

  if (hasContent && lastContentNode) points.push(lastContentNode);
  return points;
}

function restorePage() {
  STATE.generation += 1;
  STATE.abort = true;
  STATE.running = false;
  STATE.mode = "idle";
  stopAutoTranslate();
  clearInserted();
  document.querySelectorAll(".rwt-translating").forEach((element) => element.classList.remove("rwt-translating"));
  setStatus("已还原");
}

function clearInserted() {
  restoreTweetRenderers();
  STATE.inserted.forEach((node) => node.remove());
  STATE.inserted.clear();
  document.querySelectorAll(".rwt-translation, .rwt-inline, .rwt-anchor").forEach((node) => node.remove());
  STATE.translatedElements = new WeakSet();
  STATE.translatedSegments = new WeakMap();
  STATE.translatedTextNodes = new WeakSet();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (STATE.originals.has(node)) {
      node.nodeValue = STATE.originals.get(node);
      node.parentElement?.removeAttribute("data-rwt-replaced");
    }
  }
  document.querySelectorAll("[data-rwt-replaced]").forEach((element) => element.removeAttribute("data-rwt-replaced"));
}

function restoreTweetRenderers() {
  document.querySelectorAll(".rwt-tweet-original-holder").forEach((holder) => {
    const render = holder.parentElement?.querySelector(":scope > .rwt-tweet-bilingual-render");
    while (holder.firstChild) {
      holder.parentElement?.insertBefore(holder.firstChild, holder);
    }
    render?.remove();
    holder.remove();
  });
}

function isInline(element) {
  const display = getComputedStyle(element).display;
  return display.startsWith("inline") || ["A", "SPAN", "STRONG", "EM", "B", "I"].includes(element.tagName);
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function preserveEdges(original, translated) {
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  return `${leading}${translated.trim()}${trailing}`;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getOwnVisibleText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll?.(".rwt-translation, .rwt-inline, .rwt-anchor, .rwt-toolbar, .rwt-selection-popover, .rwt-image-result").forEach((node) => {
    node.remove();
  });
  return clone.innerText || clone.textContent || "";
}

function getTweetTranslationText(container) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll?.(".rwt-translation, .rwt-inline, .rwt-anchor, .rwt-toolbar, .rwt-selection-popover, .rwt-image-result").forEach((node) => {
    node.remove();
  });
  return normalizeTweetText(clone.innerText || clone.textContent || "");
}

function isPluginNode(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.matches(".rwt-translation, .rwt-inline, .rwt-anchor, .rwt-toolbar, .rwt-selection-popover, .rwt-image-result");
}

function normalizeTweetText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function splitTranslationParagraphs(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function runPool(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length && !STATE.abort) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function translateBatch(texts) {
  return chrome.runtime
    .sendMessage({ type: "translateBatch", payload: { texts } })
    .then((response) => {
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      return response.result;
    });
}

function setupImageTranslate() {
  if (!STATE.imageTranslateEnabled || imageObserver) return;
  enhanceTranslatableImages(document);
  imageObserver = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.addedNodes.length > 0)) return;
    enhanceTranslatableImages(document);
  });
  imageObserver.observe(document.body, { childList: true, subtree: true });
}

function teardownImageTranslate() {
  if (imageObserver) imageObserver.disconnect();
  imageObserver = null;
  document.querySelectorAll(".rwt-image-button").forEach((button) => button.remove());
  document.querySelectorAll(".rwt-image-result").forEach((panel) => panel.remove());
  document.querySelectorAll("img[data-rwt-image-enhanced='true']").forEach((img) => {
    delete img.dataset.rwtImageEnhanced;
  });
  document.querySelectorAll(".rwt-image-host").forEach((host) => {
    host.classList.remove("rwt-image-host");
    if (host.dataset.rwtPositionPatched === "true") {
      host.style.position = "";
      delete host.dataset.rwtPositionPatched;
    }
  });
}

function enhanceTranslatableImages(root) {
  root.querySelectorAll?.("img").forEach((img) => {
    if (img.dataset.rwtImageEnhanced === "true") return;
    if (!isLikelyContentImage(img)) return;

    const host = img.parentElement;
    if (!host || host.closest(SKIP_SELECTOR)) return;

    img.dataset.rwtImageEnhanced = "true";
    host.classList.add("rwt-image-host");
    if (getComputedStyle(host).position === "static") {
      host.dataset.rwtPositionPatched = "true";
      host.style.position = "relative";
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rwt-image-button";
    button.textContent = "译图";
    button.title = "翻译图片文字";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await translateImageFromElement(img);
    });
    host.append(button);
  });
}

function isLikelyContentImage(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width < 160 || height < 90) return false;
  const src = img.currentSrc || img.src || "";
  if (/profile_images|emoji|avatar|abs-0.twimg.com\/emoji/i.test(src)) return false;
  return /^(https?:|data:image\/)/i.test(src);
}

async function translateImageFromElement(img) {
  const host = img.parentElement;
  const button = host?.querySelector?.(".rwt-image-button");
  const panel = ensureImageResultPanel(img);
  if (!panel) return;

  if (panel.dataset.visible === "true" && panel.dataset.loading !== "true") {
    panel.dataset.visible = "false";
    if (button) button.textContent = "译图";
    return;
  }

  const cacheKey = imageCacheKey(img);
  const cached = imageTranslationCache.get(cacheKey);
  if (cached) {
    setImagePanelText(panel, cached, "done");
    if (button) button.textContent = "收起";
    return;
  }

  setImagePanelText(panel, "正在识别图片...", "loading");
  if (button) button.textContent = "识别中";

  try {
    const imageUrl = await imageElementToDataUrl(img) || img.currentSrc || img.src;
    if (!imageUrl) {
      throw new Error("这张图片暂时无法读取。请等图片加载完成后再试。");
    }
    const result = await chrome.runtime.sendMessage({
      type: "translateImage",
      payload: { imageUrl }
    });
    if (!result?.ok) throw new Error(result?.error || "图片翻译失败");
    const text = result.result || "没有识别到可翻译内容。";
    imageTranslationCache.set(cacheKey, text);
    setImagePanelText(panel, text, "done");
    if (button) button.textContent = "收起";
  } catch (error) {
    setImagePanelText(panel, error.message || "图片翻译失败", "error");
    if (button) button.textContent = "重试";
  }
}

async function imageElementToDataUrl(img) {
  try {
    if (!img.complete || !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return "";
    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return dataUrl.length <= 5_000_000 ? dataUrl : "";
  } catch {
    // Cross-origin images often taint the page canvas. The background worker
    // will fetch and convert the original URL instead.
    return "";
  }
}

function ensureImageResultPanel(img) {
  const host = img.parentElement;
  if (!host) return null;
  const panelId = img.dataset.rwtImagePanelId || `rwt-image-result-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  img.dataset.rwtImagePanelId = panelId;

  let panel = document.getElementById(panelId);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = panelId;
  panel.className = "rwt-image-result";
  panel.dataset.visible = "false";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  host.insertAdjacentElement("afterend", panel);
  return panel;
}

function setImagePanelText(panel, text, state) {
  panel.textContent = text;
  panel.dataset.visible = "true";
  panel.dataset.loading = state === "loading" ? "true" : "false";
  panel.dataset.error = state === "error" ? "true" : "false";
}

function imageCacheKey(img) {
  return img.currentSrc || img.src || img.dataset.rwtImagePanelId || "";
}

function setupSelectionTranslate() {
  document.addEventListener("selectionchange", scheduleSelectionTranslate, true);
  document.addEventListener("mouseup", scheduleSelectionTranslate, true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift" || event.key.startsWith("Arrow")) scheduleSelectionTranslate();
  }, true);
  document.addEventListener("scroll", hideSelectionPopover, true);
  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest?.(".rwt-selection-popover")) hideSelectionPopover();
  }, true);
}

function scheduleSelectionTranslate() {
  if (!STATE.siteEnabled || !STATE.selectionTranslateEnabled) return;
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(handleSelectionTranslate, 260);
}

async function handleSelectionTranslate() {
  if (!STATE.siteEnabled || !STATE.selectionTranslateEnabled) return;

  const selection = window.getSelection();
  const text = normalizeSelectionText(selection?.toString() || "");
  if (!isValidSelectionText(text) || isSelectionInsideSkippedArea(selection)) {
    hideSelectionPopover();
    return;
  }

  const rect = getSelectionRect(selection);
  if (!rect) return;

  const requestId = ++selectionRequestId;
  showSelectionPopover(rect, "正在翻译...");

  try {
    const settings = await getSettings();
    if (!settings.hasApiKey) {
      showSelectionPopover(rect, "请先在插件面板保存 API key");
      return;
    }

    const [translation] = await translateBatch([text]);
    if (requestId !== selectionRequestId || !STATE.selectionTranslateEnabled) return;
    showSelectionPopover(rect, translation || "没有返回译文");
  } catch (error) {
    if (requestId !== selectionRequestId) return;
    showSelectionPopover(rect, error.message || "翻译失败");
  }
}

function showSelectionPopover(rect, text) {
  let popover = document.querySelector(".rwt-selection-popover");
  if (!popover) {
    popover = document.createElement("div");
    popover.className = "rwt-selection-popover";
    document.documentElement.append(popover);
  }

  popover.textContent = text;
  const placeAbove = window.innerHeight - rect.bottom < 150 && rect.top > 150;
  popover.style.left = `${Math.min(window.innerWidth - 28, Math.max(12, rect.left + rect.width / 2))}px`;
  popover.style.top = `${Math.max(12, placeAbove ? rect.top - 10 : rect.bottom + 10)}px`;
  popover.dataset.placement = placeAbove ? "above" : "below";
  popover.dataset.visible = "true";
}

function hideSelectionPopover() {
  selectionRequestId += 1;
  const popover = document.querySelector(".rwt-selection-popover");
  if (popover) popover.dataset.visible = "false";
}

function getSelectionRect(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  return rects[rects.length - 1] || range.getBoundingClientRect();
}

function isSelectionInsideSkippedArea(selection) {
  if (!selection || selection.rangeCount === 0) return true;
  const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  return !node || Boolean(node.closest?.(SKIP_SELECTOR));
}

function isValidSelectionText(text) {
  return text.length >= 2 && text.length <= 800 && TRANSLATABLE_TEXT_RE.test(text);
}

function normalizeSelectionText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getSettings() {
  return chrome.runtime
    .sendMessage({ type: "getSettings" })
    .then((response) => {
      if (!response?.ok) throw new Error(response?.error || "读取设置失败");
      return response.result;
    });
}

function isExtensionContextInvalidated(error) {
  const message = error?.message || String(error || "");
  return /Extension context invalidated|context invalidated/i.test(message);
}

function setStatus(text) {
  const status = document.querySelector(".rwt-fab-status");
  if (status) status.textContent = text;
}

function setActiveButton(mode = "idle") {
  document.querySelectorAll(".rwt-toolbar button[data-action]").forEach((button) => {
    button.dataset.active = button.dataset.action === mode ? "true" : "false";
  });
}

function startAutoTranslate() {
  stopAutoTranslate();
  observer = new MutationObserver((mutations) => {
    if (STATE.mode === "idle" || STATE.abort) return;
    if (!mutations.some((mutation) => hasTranslatableAddedNode(mutation))) return;
    scheduleAutoTranslate(700);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopAutoTranslate() {
  if (observer) observer.disconnect();
  observer = null;
  window.clearTimeout(observerTimer);
  observerTimer = null;
  pendingAutoSync = false;
}

function scheduleAutoTranslate(delay) {
  window.clearTimeout(observerTimer);
  observerTimer = window.setTimeout(() => {
    if (STATE.mode === "idle") return;
    if (STATE.running) {
      pendingAutoSync = true;
      return;
    }
    translatePage(STATE.mode, { incremental: true });
  }, delay);
}

function hasTranslatableAddedNode(mutation) {
  return Array.from(mutation.addedNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return shouldTranslate(normalizeText(node.nodeValue || ""));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.closest?.(SKIP_SELECTOR)) return false;
    return TRANSLATABLE_TEXT_RE.test(node.innerText || node.textContent || "");
  });
}

function toggleToolbar() {
  const toolbar = document.querySelector(".rwt-toolbar");
  if (!toolbar) return;
  const expanded = toolbar.dataset.expanded === "true";
  toolbar.dataset.expanded = expanded ? "false" : "true";
  toolbar.querySelector(".rwt-panel")?.setAttribute("aria-hidden", expanded ? "true" : "false");
}

function collapseToolbar() {
  const toolbar = document.querySelector(".rwt-toolbar");
  if (!toolbar) return;
  toolbar.dataset.expanded = "false";
  toolbar.querySelector(".rwt-panel")?.setAttribute("aria-hidden", "true");
}
