const DEFAULT_SETTINGS = {
  provider: "deepseek",
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  textProvider: "deepseek",
  textApiBaseUrl: "https://api.deepseek.com",
  textApiKey: "",
  textModel: "deepseek-chat",
  imageProvider: "kimi",
  imageApiBaseUrl: "https://api.moonshot.ai/v1",
  imageApiKey: "",
  imageModel: "kimi-k2.6",
  sourceLanguage: "auto",
  targetLanguage: "Simplified Chinese",
  translationStyle: "natural",
  concurrency: 3,
  batchSize: 12,
  requestTimeoutMs: 45000,
  temperature: 0.1,
  toolbarPosition: null,
  imageTranslateEnabled: false,
  selectionTranslateEnabled: false,
  disabledSites: {},
  protectedTerms: "AAOI, LITE, AXTI, ASIC, TPU, GPU, NVIDIA, AMD, Microsoft, Google, Amazon"
};

const ALLOWED_PROVIDERS = {
  deepseek: {
    apiBaseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  kimi: {
    apiBaseUrl: "https://api.moonshot.ai/v1",
    models: ["kimi-k2.6", "kimi-k2-0711-preview"]
  },
  "kimi-cn": {
    apiBaseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2.6", "kimi-k2-0711-preview"]
  },
  openai: {
    apiBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4o-mini"]
  }
};

const memoryCache = new Map();
const MAX_CACHE_ENTRIES = 2000;
const TRANSLATION_ENGINE_VERSION = "2026-06-bilingual-pairs-v4";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const migrated = { ...DEFAULT_SETTINGS, ...compact(current) };
  if (!migrated.textApiKey && migrated.apiKey) migrated.textApiKey = migrated.apiKey;
  if (!migrated.textProvider && migrated.provider) migrated.textProvider = migrated.provider;
  if (!migrated.textApiBaseUrl && migrated.apiBaseUrl) migrated.textApiBaseUrl = migrated.apiBaseUrl;
  if (!migrated.textModel && migrated.model) migrated.textModel = migrated.model;
  await chrome.storage.local.set(migrated);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translateBatch") {
    translateBatch(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "translateImage") {
    translateImage(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "testChannel") {
    testChannel(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "getSettings") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, result: publicSettings(settings, sender) }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

async function translateBatch(payload = {}) {
  const settings = getChannelSettings(validateSettings({ ...(await getSettings()), ...(payload.settings || {}) }), "text");
  if (!settings.apiKey) {
    throw new Error("请先在插件面板填写文本翻译 API token。");
  }

  const texts = (payload.texts || [])
    .map((text) => String(text || "").trim())
    .filter(Boolean);

  const output = new Array(texts.length);
  const missing = [];

  texts.forEach((text, index) => {
    const key = cacheKey(settings, text);
    if (memoryCache.has(key)) {
      output[index] = memoryCache.get(key);
    } else {
      missing.push({ index, text, key });
    }
  });

  if (!missing.length) return output;

  const protectedTexts = missing.map((item) => protectText(item.text, settings));
  const translated = await requestProtectedTranslations(settings, protectedTexts);
  missing.forEach((item, index) => {
    const value = postProcessTranslation(
      item.text,
      restoreProtectedText(translated[index] || "", protectedTexts[index].tokens),
      settings
    );
    setMemoryCache(item.key, value);
    output[item.index] = value;
  });

  return output;
}

function setMemoryCache(key, value) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, value);
}

async function translateImage(payload = {}) {
  const settings = getChannelSettings(validateSettings(await getSettings()), "image");
  if (settings.provider === "deepseek") {
    throw new Error("图片翻译通道当前是 DeepSeek。请在插件面板为图片通道配置 Kimi 或 OpenAI 视觉模型。");
  }
  if (!settings.apiKey) {
    throw new Error("请先在插件面板填写图片翻译 API token。");
  }

  const imageUrl = String(payload.imageUrl || "");
  if (!/^(https?:|data:image\/)/i.test(imageUrl)) {
    throw new Error("这张图片地址不能直接发送给视觉模型。请打开原图后再试。");
  }

  const key = imageTranslationCacheKey(settings, imageUrl);
  if (memoryCache.has(key)) return memoryCache.get(key);

  const translated = await requestImageTranslation(settings, imageUrl);
  setMemoryCache(key, translated);
  return translated;
}

async function testChannel(payload = {}) {
  const channel = payload.channel === "image" ? "image" : "text";
  const settings = getChannelSettings(validateSettings(await getSettings()), channel);
  if (channel === "image" && settings.provider === "deepseek") {
    throw new Error("图片通道不能使用 DeepSeek。请切换到 Kimi 或 OpenAI。");
  }
  if (!settings.apiKey) {
    throw new Error(`请先保存${channel === "image" ? "图片" : "文本"} API key。`);
  }
  await requestChannelProbe(settings, channel === "image" ? "图片通道" : "文本通道");
  return `${providerLabel(settings.provider)} / ${settings.model} 认证通过`;
}

async function requestTranslations(settings, texts, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(settings.requestTimeoutMs) || 45000);

  try {
    let response = await sendChatRequest(settings, texts, true, controller.signal, options);
    let bodyText = await response.text();

    if (!response.ok && shouldRetryWithoutJsonMode(response.status, bodyText)) {
      response = await sendChatRequest(settings, texts, false, controller.signal, options);
      bodyText = await response.text();
    }

    if (!response.ok) {
      throw new Error(formatProviderError("文本翻译", response.status, bodyText, settings));
    }

    const body = JSON.parse(bodyText);
    const content = body.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
    return texts.map((_, index) => String(translations[index] || ""));
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`翻译请求超时：${providerLabel(settings.provider)} / ${settings.model} 在 ${Math.round((Number(settings.requestTimeoutMs) || 45000) / 1000)} 秒内没有返回。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestProtectedTranslations(settings, protectedTexts) {
  const texts = protectedTexts.map((item) => item.text);
  const firstPass = await requestTranslations(settings, texts);
  const retryItems = [];

  firstPass.forEach((translation, index) => {
    if (shouldRetryTranslation(protectedTexts[index], translation)) {
      retryItems.push(index);
    }
  });

  if (!retryItems.length) return firstPass;

  const retryTexts = retryItems.map((index) => protectedTexts[index].text);
  const retryTranslations = await requestTranslations(settings, retryTexts, {
    repair: true
  });

  retryItems.forEach((originalIndex, retryIndex) => {
    if (retryTranslations[retryIndex]) {
      firstPass[originalIndex] = retryTranslations[retryIndex];
    }
  });

  return firstPass;
}

function shouldRetryTranslation(protectedText, translation) {
  const output = String(translation || "");
  if (!output.trim()) return true;
  if (/[§]{1,2}\s*\d+\s*[§]{0,2}|\$+\s*\d+\s*\$+/g.test(output)) return true;
  return protectedText.tokens.some(({ token }) => !output.includes(token));
}

function sendChatRequest(settings, texts, useJsonMode, signal, options = {}) {
  const apiKey = normalizeApiKey(settings.apiKey);
  const payload = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: [
          "You are a fast, precise webpage translation engine.",
          `Translate from ${settings.sourceLanguage || "auto"} to ${settings.targetLanguage || "Simplified Chinese"}.`,
          translationStyleInstruction(settings.translationStyle),
          "Keep placeholder tokens like @@0@@ unchanged exactly.",
          "Keep numbers, tickers, URLs, usernames, code, emojis, and line breaks unchanged.",
          "If one input text contains multiple paragraphs separated by newlines, return the translation with the same paragraph count and newline boundaries.",
          "Before translating, infer the domain from the sentence: market commentary, technology, social media, news, code, or casual text. Choose terms by context, not by dictionary default.",
          "For finance and market text: ATM/ATMs usually means at-the-market offering/equity issuance, not an automatic teller machine; ARR means annual recurring revenue; MC means market cap; H1/H2 mean first/second half of the year; long/bear refer to bullish/bearish market views.",
          "For market idioms: backlog agreements means backlog/order-book related agreements, correct off the information means pull back or reprice after the information is known, the music will keep playing means the market cycle/rally can continue.",
          "Do not translate company names, ticker-like abbreviations, product codes, model names, usernames, URLs, or hashtags.",
          options.repair ? "This is a repair pass: every placeholder token from the input must appear exactly once in the matching output." : "",
          "Do not add explanations. Return strict JSON: {\"translations\":[\"...\"]}.",
          "The translations array must have exactly the same length and order as the input array."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({ texts })
      }
    ]
  };

  applySamplingOptions(payload, settings);

  if (useJsonMode) {
    payload.response_format = { type: "json_object" };
  }

  return fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }
  );
}

async function requestImageTranslation(settings, imageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(settings.requestTimeoutMs) || 45000);

  try {
    const preparedImageUrl = await prepareImageForVision(imageUrl, controller.signal);
    const apiKey = normalizeApiKey(settings.apiKey);
    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(withSamplingOptions({
        model: settings.model,
        messages: [
          {
            role: "system",
            content: [
              "You translate images for webpage reading.",
              `Translate visible text to ${settings.targetLanguage || "Simplified Chinese"}.`,
              translationStyleInstruction(settings.translationStyle),
              "Preserve tickers, company names, numbers, URLs, and codes.",
              "Do not print a separate OCR transcript unless the user needs exact source wording.",
              "Return the translated meaning directly, keeping useful line breaks or bullets.",
              "If the image has no meaningful text, briefly describe the image in Chinese.",
              "Keep the answer concise and readable."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请识别图片文字并翻译成目标语言。不要输出“原文识别/翻译”这种双标题，默认只输出译文；若是新闻截图、财报图、表格或推文截图，请保留结构、数字和关键信息。"
              },
              {
                type: "image_url",
                image_url: { url: preparedImageUrl }
              }
            ]
          }
        ]
      }, settings))
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(formatProviderError("图片翻译", response.status, bodyText, settings));
    }

    const body = JSON.parse(bodyText);
    return String(body.choices?.[0]?.message?.content || "").trim() || "没有识别到可翻译内容。";
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`图片翻译请求超时：${providerLabel(settings.provider)} / ${settings.model} 在 ${Math.round((Number(settings.requestTimeoutMs) || 45000) / 1000)} 秒内没有返回。请检查是否选对国内站/国际站，或稍后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function prepareImageForVision(imageUrl, signal) {
  const value = String(imageUrl || "").trim();
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)) {
    if (value.length > 5_000_000) {
      throw new Error("这张图片太大，已超过当前插件的图片翻译上限。请打开较小尺寸图片后再试。");
    }
    return value;
  }

  if (!/^https?:\/\//i.test(value)) {
    throw new Error("这张图片格式暂不支持。请使用网页中的普通图片。");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("这张图片地址无效。");
  }

  if (parsed.username || parsed.password) {
    throw new Error("出于安全考虑，不读取带账号密码的图片地址。");
  }

  const response = await fetch(parsed.href, {
    method: "GET",
    signal,
    credentials: "omit",
    cache: "force-cache",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`图片读取失败：${response.status}。请打开原图或稍后再试。`);
  }

  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  if (!contentType) {
    throw new Error("图片读取失败：这个地址返回的不是可识别图片。");
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 4_000_000) {
    throw new Error("这张图片太大，已超过当前插件的图片翻译上限。请打开较小尺寸图片后再试。");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 4_000_000) {
    throw new Error("这张图片太大，已超过当前插件的图片翻译上限。请打开较小尺寸图片后再试。");
  }

  return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
}

function normalizeImageContentType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "image/jpeg";
  if (type === "image/png") return "image/png";
  if (type === "image/webp") return "image/webp";
  return "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function requestChannelProbe(settings, scope) {
  const controller = new AbortController();
  const timeoutMs = 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const apiKey = normalizeApiKey(settings.apiKey);
    const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(withSamplingOptions({
        model: settings.model,
        messages: [
          {
            role: "user",
            content: "Reply with OK only."
          }
        ]
      }, settings))
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(formatProviderError(scope, response.status, bodyText, settings));
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${scope}测试超时：${providerLabel(settings.provider)} / ${settings.model} 在 ${Math.round(timeoutMs / 1000)} 秒内没有返回。请检查是否选对国内站/国际站，或稍后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function withSamplingOptions(payload, settings) {
  applySamplingOptions(payload, settings);
  return payload;
}

function applySamplingOptions(payload, settings) {
  if ((settings.provider === "kimi" || settings.provider === "kimi-cn") && /^kimi-k2\./i.test(settings.model)) {
    return;
  }
  payload.temperature = Number(settings.temperature) || 0;
}

function readProviderError(bodyText) {
  const text = String(bodyText || "");
  try {
    const body = JSON.parse(text);
    return String(body.error?.message || body.message || text).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

function isAbortError(error) {
  return error?.name === "AbortError" || /signal is aborted|aborted/i.test(String(error?.message || error));
}

function formatProviderError(scope, status, bodyText, settings) {
  const message = readProviderError(bodyText);
  if (status === 401 || /invalid[_\s-]?authentication|unauthorized|api key|token/i.test(message)) {
    return [
      `${scope}认证失败：当前通道是 ${providerLabel(settings.provider)} / ${settings.model}。`,
      "请确认这个通道填写的是对应服务商的 API key，并且切换服务商或模型后已经点过保存。",
      `服务商返回：${message}`
    ].join(" ");
  }
  if (status === 402 || status === 429 || /quota|balance|billing|insufficient|rate limit|余额|额度|限额/i.test(message)) {
    return [
      `${scope}额度或限流异常：当前通道是 ${providerLabel(settings.provider)} / ${settings.model}。`,
      "这更像是余额不足、额度用完或请求过快，不是 key 格式问题。",
      `服务商返回：${message}`
    ].join(" ");
  }
  return `${scope}接口返回 ${status}: ${message}`;
}

function providerLabel(provider) {
  if (provider === "kimi") return "Kimi / Moonshot";
  if (provider === "kimi-cn") return "Kimi / Moonshot 国内站";
  if (provider === "openai") return "OpenAI";
  if (provider === "deepseek") return "DeepSeek";
  return provider || "未知服务商";
}

function shouldRetryWithoutJsonMode(status, bodyText) {
  return status === 400 && /response_format|json_object|unsupported|not support/i.test(bodyText);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("翻译接口没有返回可解析的 JSON。");
    return JSON.parse(match[0]);
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return validateSettings({ ...DEFAULT_SETTINGS, ...compact(stored) }, { allowMissingKey: true });
}

function publicSettings(settings, sender) {
  const { apiKey, textApiKey, imageApiKey, ...rest } = settings;
  return {
    ...rest,
    siteEnabled: isSiteEnabled(settings, sender?.url),
    hasApiKey: Boolean(apiKey || textApiKey),
    hasTextApiKey: Boolean(textApiKey || apiKey),
    hasImageApiKey: Boolean(imageApiKey)
  };
}

function isSiteEnabled(settings, url) {
  const key = siteKeyFromUrl(url);
  return !key || !settings.disabledSites?.[key];
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function protectText(text, settings) {
  const tokens = [];
  let protectedText = String(text || "");
  const patterns = [
    /`[^`]+`/g,
    /https?:\/\/[^\s)]+/g,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    /@\w{1,30}/g,
    /#[A-Za-z][\w-]*/g,
    /\$[A-Z]{1,8}\b/g,
    /\b[A-Za-z_$][\w$]*\([^)]*\)/g
  ];

  const customTerms = parseProtectedTerms(settings.protectedTerms).filter((term) => shouldHardProtectTerm(term));
  for (const term of customTerms) {
    protectedText = replaceProtected(protectedText, exactTermRegExp(term), tokens);
  }

  for (const pattern of patterns) {
    protectedText = replaceProtected(protectedText, pattern, tokens);
  }

  return { text: protectedText, tokens };
}

function shouldHardProtectTerm(term) {
  const value = String(term || "").trim();
  if (!value) return false;
  if (/^\$?[A-Z]{1,8}$/.test(value)) return true;
  if (/^[A-Z0-9._-]{2,12}$/.test(value) && /\d/.test(value)) return true;
  return false;
}

function replaceProtected(text, pattern, tokens) {
  return text.replace(pattern, (match) => {
    if (!match || /^@@\d+@@$/.test(match)) return match;
    if (tokens.some(({ token, value }) => token === match || value === match)) return match;
    const token = `@@${tokens.length}@@`;
    tokens.push({ token, value: match });
    return token;
  });
}

function restoreProtectedText(text, tokens) {
  let restored = String(text || "");
  tokens.forEach(({ token, value }, index) => {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    restored = restored.replace(new RegExp(escapedToken, "g"), value);
    restored = restored.replace(new RegExp(`@+\\s*${index}\\s*@+`, "g"), value);
    restored = restored.replace(new RegExp(`\\$+\\s*${index}\\s*\\$+`, "g"), value);
    restored = restored.replace(new RegExp(`§\\s*${index}\\s*§`, "g"), value);
  });

  const leftovers = tokens.map((_, index) => index).join("|");
  if (leftovers) {
    restored = restored.replace(new RegExp(`@@\\s*(${leftovers})\\s*@@`, "g"), (_, tokenIndex) => {
      return tokens[Number(tokenIndex)]?.value || _;
    });
  }
  return restored;
}

function parseProtectedTerms(value) {
  return String(value || "")
    .split(/[\n,，]/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function exactTermRegExp(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^[A-Za-z0-9_]/.test(term) ? "\\b" : "";
  const suffix = /[A-Za-z0-9_]$/.test(term) ? "(?:['’]s)?\\b" : "";
  return new RegExp(`${left}${escaped}${suffix}`, "gi");
}

function postProcessTranslation(source, translation, settings) {
  let output = String(translation || "").trim();
  const original = String(source || "");
  if (!output) return output;

  if (isMarketContext(original)) {
    output = output
      .replace(/自动取款机|自动提款机|ATM机/g, "ATM增发")
      .replace(/\bATMs?\b/g, "ATM增发")
      .replace(/年化重复收入|年度经常性收入/g, "年化经常性收入")
      .replace(/市场资本化/g, "市值")
      .replace(/熊市帖子|熊帖/g, "看空帖子")
      .replace(/看跌于/g, "看空")
      .replace(/空头于/g, "看空");
  }

  if (settings.targetLanguage === "Simplified Chinese") {
    output = output
      .replace(/\s+([，。！？；：、）])/g, "$1")
      .replace(/([（])\s+/g, "$1")
      .replace(/\s{2,}/g, " ");
  }

  return output;
}

function isMarketContext(text) {
  return /\$[A-Z]{1,8}\b|\b(?:ARR|MC|capex|revenue|margin|analyst|bear|bull|long|short|ATM|ATMs|market cap|valuation|offering|equity|shares?|stock|sector|guidance|earnings|multiple|demand|supply)\b/i.test(String(text || ""));
}

function validateSettings(settings, options = {}) {
  const legacy = normalizeChannelSettings(
    {
      provider: settings.provider,
      apiBaseUrl: settings.apiBaseUrl,
      model: settings.model,
      apiKey: settings.apiKey
    },
    DEFAULT_SETTINGS.provider,
    options
  );
  const text = normalizeChannelSettings(
    {
      provider: settings.textProvider || settings.provider,
      apiBaseUrl: settings.textApiBaseUrl || settings.apiBaseUrl,
      model: settings.textModel || settings.model,
      apiKey: settings.textApiKey || settings.apiKey
    },
    DEFAULT_SETTINGS.textProvider,
    options
  );
  const image = normalizeChannelSettings(
    {
      provider: settings.imageProvider,
      apiBaseUrl: settings.imageApiBaseUrl,
      model: settings.imageModel,
      apiKey: settings.imageApiKey
    },
    DEFAULT_SETTINGS.imageProvider,
    options
  );
  return {
    ...settings,
    provider: legacy.provider,
    apiBaseUrl: legacy.apiBaseUrl,
    model: legacy.model,
    apiKey: legacy.apiKey,
    textProvider: text.provider,
    textApiBaseUrl: text.apiBaseUrl,
    textModel: text.model,
    textApiKey: text.apiKey,
    imageProvider: image.provider,
    imageApiBaseUrl: image.apiBaseUrl,
    imageModel: image.model,
    imageApiKey: image.apiKey,
    sourceLanguage: normalizeLanguage(settings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage),
    targetLanguage: normalizeLanguage(settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage),
    translationStyle: normalizeTranslationStyle(settings.translationStyle),
    toolbarPosition: normalizeToolbarPosition(settings.toolbarPosition),
    imageTranslateEnabled: Boolean(settings.imageTranslateEnabled),
    selectionTranslateEnabled: Boolean(settings.selectionTranslateEnabled),
    disabledSites: normalizeDisabledSites(settings.disabledSites),
    protectedTerms: String(settings.protectedTerms || DEFAULT_SETTINGS.protectedTerms)
  };
}

function normalizeDisabledSites(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, disabled]) => disabled === true && typeof key === "string" && /^https?:\/\//.test(key))
      .slice(0, 500)
  );
}

function normalizeToolbarPosition(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y))
  };
}

function normalizeChannelSettings(settings, defaultProviderKey, options = {}) {
  const inferredProvider = inferProvider(settings.apiBaseUrl);
  const providerKey = ALLOWED_PROVIDERS[settings.provider]
    ? settings.provider
    : inferredProvider || defaultProviderKey;
  const provider = ALLOWED_PROVIDERS[providerKey];
  const apiBaseUrl = normalizeUrl(settings.apiBaseUrl || provider.apiBaseUrl);
  const expectedBaseUrl = normalizeUrl(provider.apiBaseUrl);

  if (!options.allowMissingKey && apiBaseUrl !== expectedBaseUrl) {
    throw new Error("当前安全模式只允许使用预设的 DeepSeek、Kimi 或 OpenAI 官方接口地址。");
  }

  return {
    provider: providerKey,
    apiBaseUrl: provider.apiBaseUrl,
    model: provider.models.includes(settings.model) ? settings.model : provider.models[0],
    apiKey: normalizeApiKey(settings.apiKey || "", { allowEmpty: true })
  };
}

function getChannelSettings(settings, channel) {
  if (channel === "image") {
    return {
      ...settings,
      provider: settings.imageProvider,
      apiBaseUrl: settings.imageApiBaseUrl,
      model: settings.imageModel,
      apiKey: settings.imageApiKey
    };
  }

  return {
    ...settings,
    provider: settings.textProvider,
    apiBaseUrl: settings.textApiBaseUrl,
    model: settings.textModel,
    apiKey: settings.textApiKey
  };
}

function normalizeApiKey(value, options = {}) {
  const key = String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();

  if (!key && options.allowEmpty) return "";
  if (!key) throw new Error("请先在扩展设置里填写 API token。");
  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new Error("API token 含有中文、全角空格或不可见字符。请只粘贴控制台生成的 key 本体，不要包含说明文字。");
  }

  return key;
}

function inferProvider(apiBaseUrl) {
  const normalized = normalizeUrl(apiBaseUrl);
  return Object.entries(ALLOWED_PROVIDERS).find(([, provider]) => normalizeUrl(provider.apiBaseUrl) === normalized)?.[0];
}

function normalizeUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeLanguage(value) {
  const allowed = new Set([
    "auto",
    "English",
    "Simplified Chinese",
    "Traditional Chinese",
    "Japanese",
    "Korean"
  ]);
  return allowed.has(value) ? value : "auto";
}

function normalizeTranslationStyle(value) {
  return ["natural", "finance", "faithful"].includes(value) ? value : "natural";
}

function translationStyleInstruction(style) {
  if (style === "finance") {
    return [
      "Style: accurate financial and technology reading translation.",
      "Do not translate mechanically. Use fluent Chinese suitable for market commentary, tech news, earnings notes, and social posts.",
      "Use market-native terms: ATM = ATM增发/按市价发行, ARR = 年化经常性收入, MC = 市值, capex = 资本开支, hyperscaler = 超大规模云厂商, contagion = 连锁冲击/传染风险, long = 做多/看多, bear = 看空/空头.",
      "Keep tone concise, preserve uncertainty and nuance, and avoid over-explaining."
    ].join(" ");
  }

  if (style === "faithful") {
    return [
      "Style: faithful but natural.",
      "Preserve meaning, emphasis, and sentence structure where helpful, but avoid stiff literal translation.",
      "Do not omit important details."
    ].join(" ");
  }

  return [
    "Style: natural and accurate webpage reading translation.",
    "Reject stiff literal translation. Rewrite into fluent target-language phrasing while preserving meaning, tone, and details.",
    "For market and technology posts, use professional domain wording and avoid literal dictionary mistakes.",
    "Use terms that fit the context instead of word-for-word output."
  ].join(" ");
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function cacheKey(settings, text) {
  return [
    TRANSLATION_ENGINE_VERSION,
    settings.apiBaseUrl,
    settings.model,
    settings.sourceLanguage,
    settings.targetLanguage,
    settings.translationStyle,
    settings.protectedTerms,
    text
  ].join("\u0001");
}

function imageTranslationCacheKey(settings, imageUrl) {
  return [
    "image",
    settings.apiBaseUrl,
    settings.model,
    settings.targetLanguage,
    settings.translationStyle,
    hashString(imageUrl)
  ].join("\u0001");
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
