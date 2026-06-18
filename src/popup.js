const DEFAULTS = {
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
  imageTranslateEnabled: false,
  selectionTranslateEnabled: false,
  disabledSites: {},
  protectedTerms: "AAOI, LITE, AXTI, ASIC, TPU, GPU, NVIDIA, AMD, Microsoft, Google, Amazon"
};

const LANGUAGES = [
  ["auto", "自动识别"],
  ["English", "English"],
  ["Simplified Chinese", "简体中文"],
  ["Traditional Chinese", "繁體中文"],
  ["Japanese", "日本語"],
  ["Korean", "한국어"]
];

const TRANSLATION_STYLES = [
  ["natural", "自然准确"],
  ["finance", "金融科技"],
  ["faithful", "忠实自然"]
];

const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    apiBaseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  kimi: {
    label: "Kimi / Moonshot 国际站",
    apiBaseUrl: "https://api.moonshot.ai/v1",
    models: ["kimi-k2.6", "kimi-k2-0711-preview"]
  },
  "kimi-cn": {
    label: "Kimi / Moonshot 国内站",
    apiBaseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2.6", "kimi-k2-0711-preview"]
  },
  openai: {
    label: "OpenAI",
    apiBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4o-mini"]
  }
};

const controls = {
  text: {
    provider: document.querySelector("#text-provider"),
    model: document.querySelector("#text-model"),
    apiKey: document.querySelector("#text-api-key"),
    save: document.querySelector("#save-text-key"),
    test: document.querySelector("#test-text-key")
  },
  image: {
    provider: document.querySelector("#image-provider"),
    model: document.querySelector("#image-model"),
    apiKey: document.querySelector("#image-api-key"),
    save: document.querySelector("#save-image-key"),
    test: document.querySelector("#test-image-key")
  }
};
const siteToggle = document.querySelector("#site-toggle");
const siteLabel = document.querySelector("#site-label");
const imageToggle = document.querySelector("#image-toggle");
const selectionToggle = document.querySelector("#selection-toggle");
const protectedTermsInput = document.querySelector("#protected-terms");
const sourceLanguageSelect = document.querySelector("#source-language");
const targetLanguageSelect = document.querySelector("#target-language");
const translationStyleSelect = document.querySelector("#translation-style");
const statusNode = document.querySelector("#status");

init();

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

for (const channel of ["text", "image"]) {
  controls[channel].provider.addEventListener("change", async () => saveChannelProvider(channel));
  controls[channel].model.addEventListener("change", async () => saveChannelModel(channel));
  controls[channel].save.addEventListener("click", async () => saveChannelKey(channel));
  controls[channel].test.addEventListener("click", async () => testChannel(channel));
  controls[channel].apiKey.addEventListener("input", () => {
    setStatus(`${channelLabel(channel)} API key 已修改，点保存后才生效`, "warning");
  });
}

siteToggle.addEventListener("change", async () => {
  const siteKey = siteToggle.dataset.siteKey || "";
  if (!siteKey) return;
  const { disabledSites = {} } = await chrome.storage.local.get("disabledSites");
  const next = { ...disabledSites };
  if (siteToggle.checked) {
    delete next[siteKey];
  } else {
    next[siteKey] = true;
  }
  await chrome.storage.local.set({ disabledSites: next });
  setSiteLabel(siteKey, siteToggle.checked);
  setStatus(siteToggle.checked ? "当前站点已启用" : "当前站点已关闭", "success");
});

imageToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ imageTranslateEnabled: imageToggle.checked });
  setStatus(imageToggle.checked ? "图片翻译按钮已开启" : "图片翻译按钮已关闭", "success");
});

selectionToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ selectionTranslateEnabled: selectionToggle.checked });
  setStatus(selectionToggle.checked ? "划词翻译已开启" : "划词翻译已关闭", "success");
});

protectedTermsInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ protectedTerms: protectedTermsInput.value.trim() });
  setStatus("保护词已保存", "success");
});

sourceLanguageSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ sourceLanguage: sourceLanguageSelect.value });
  setStatus("源语言已更新", "success");
});

targetLanguageSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ targetLanguage: targetLanguageSelect.value });
  setStatus("目标语言已更新", "success");
});

translationStyleSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ translationStyle: translationStyleSelect.value });
  setStatus("翻译风格已更新", "success");
});

async function init() {
  renderProviders();
  renderLanguageControls();
  renderStyleControls();
  const siteKey = await getCurrentSiteKey();
  const stored = await chrome.storage.local.get(null);
  const settings = normalizeSettings({ ...DEFAULTS, ...stored });

  hydrateSiteToggle(siteKey, settings);
  hydrateChannel("text", settings);
  hydrateChannel("image", settings);
  sourceLanguageSelect.value = normalizeLanguage(settings.sourceLanguage, "auto");
  targetLanguageSelect.value = normalizeLanguage(settings.targetLanguage, "Simplified Chinese");
  translationStyleSelect.value = normalizeStyle(settings.translationStyle);
  imageToggle.checked = Boolean(settings.imageTranslateEnabled);
  selectionToggle.checked = Boolean(settings.selectionTranslateEnabled);
  protectedTermsInput.value = settings.protectedTerms || "";
  setStatus(settings.textApiKey ? "文本通道已配置" : "请先保存文本 API key");
}

function hydrateSiteToggle(siteKey, settings) {
  siteToggle.dataset.siteKey = siteKey;
  siteToggle.disabled = !siteKey;
  siteToggle.checked = siteKey ? !settings.disabledSites?.[siteKey] : false;
  setSiteLabel(siteKey, siteToggle.checked);
}

function setSiteLabel(siteKey, enabled) {
  if (!siteKey) {
    siteLabel.textContent = "当前页面不支持站点开关";
    return;
  }
  siteLabel.textContent = `${new URL(siteKey).host} · ${enabled ? "已启用" : "已关闭"}`;
}

async function getCurrentSiteKey() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = new URL(tab?.url || "");
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function renderLanguageControls() {
  for (const select of [sourceLanguageSelect, targetLanguageSelect]) {
    select.replaceChildren(
      ...LANGUAGES.map(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      })
    );
  }
}

function renderStyleControls() {
  translationStyleSelect.replaceChildren(
    ...TRANSLATION_STYLES.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
}

function renderProviders() {
  for (const channel of ["text", "image"]) {
    controls[channel].provider.replaceChildren(
      ...Object.entries(PROVIDERS).map(([value, provider]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = provider.label;
        return option;
      })
    );
  }
}

function hydrateChannel(channel, settings) {
  const prefix = channel;
  const providerKey = PROVIDERS[settings[`${prefix}Provider`]]
    ? settings[`${prefix}Provider`]
    : DEFAULTS[`${prefix}Provider`];
  controls[channel].provider.value = providerKey;
  renderModels(channel, providerKey, settings[`${prefix}Model`]);
  controls[channel].apiKey.value = settings[`${prefix}ApiKey`] || "";
}

async function saveChannelProvider(channel) {
  const providerKey = controls[channel].provider.value;
  const provider = PROVIDERS[providerKey] || PROVIDERS[DEFAULTS[`${channel}Provider`]];
  renderModels(channel, providerKey, provider.models[0]);
  await chrome.storage.local.set({
    [`${channel}Provider`]: providerKey,
    [`${channel}ApiBaseUrl`]: provider.apiBaseUrl,
    [`${channel}Model`]: controls[channel].model.value
  });
  setStatus(`${channelLabel(channel)}服务商已切换`, "success");
}

async function saveChannelModel(channel) {
  await chrome.storage.local.set({ [`${channel}Model`]: controls[channel].model.value });
  setStatus(`${channelLabel(channel)}模型已切换`, "success");
}

async function saveChannelKey(channel) {
  const apiKey = normalizeApiKey(controls[channel].apiKey.value);
  if (!isHeaderSafeToken(apiKey)) {
    setStatus("key 含有中文、换行或不可见字符", "error");
    return false;
  }
  await chrome.storage.local.set({ [`${channel}ApiKey`]: apiKey });
  controls[channel].apiKey.value = apiKey;
  setStatus(`${channelLabel(channel)} API key 已保存`, "success");
  return true;
}

async function testChannel(channel) {
  try {
    const saved = await saveChannelKey(channel);
    if (!saved) return;
    controls[channel].test.disabled = true;
    setStatus(`正在测试${channelLabel(channel)}通道...`);
    const response = await chrome.runtime.sendMessage({
      type: "testChannel",
      payload: { channel }
    });
    if (!response?.ok) throw new Error(response?.error || "测试失败");
    setStatus(`${channelLabel(channel)}通道测试通过：${response.result}`, "success");
  } catch (error) {
    setStatus(error.message || "测试失败", "error");
  } finally {
    controls[channel].test.disabled = false;
  }
}

function renderModels(channel, providerKey, preferredModel) {
  const provider = PROVIDERS[providerKey] || PROVIDERS[DEFAULTS[`${channel}Provider`]];
  controls[channel].model.replaceChildren(
    ...provider.models.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      return option;
    })
  );
  controls[channel].model.value = provider.models.includes(preferredModel) ? preferredModel : provider.models[0];
}

function normalizeSettings(settings) {
  return {
    ...settings,
    textProvider: settings.textProvider || settings.provider || DEFAULTS.textProvider,
    textApiBaseUrl: settings.textApiBaseUrl || settings.apiBaseUrl || DEFAULTS.textApiBaseUrl,
    textApiKey: settings.textApiKey || settings.apiKey || "",
    textModel: settings.textModel || settings.model || DEFAULTS.textModel,
    imageProvider: settings.imageProvider || DEFAULTS.imageProvider,
    imageApiBaseUrl: settings.imageApiBaseUrl || DEFAULTS.imageApiBaseUrl,
    imageApiKey: settings.imageApiKey || "",
    imageModel: settings.imageModel || DEFAULTS.imageModel,
    sourceLanguage: normalizeLanguage(settings.sourceLanguage, DEFAULTS.sourceLanguage),
    targetLanguage: normalizeLanguage(settings.targetLanguage, DEFAULTS.targetLanguage),
    translationStyle: normalizeStyle(settings.translationStyle),
    imageTranslateEnabled: Boolean(settings.imageTranslateEnabled),
    selectionTranslateEnabled: Boolean(settings.selectionTranslateEnabled),
    disabledSites: normalizeDisabledSites(settings.disabledSites)
  };
}

function normalizeDisabledSites(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeLanguage(value, fallback) {
  return LANGUAGES.some(([language]) => language === value) ? value : fallback;
}

function normalizeStyle(value) {
  return TRANSLATION_STYLES.some(([style]) => style === value) ? value : DEFAULTS.translationStyle;
}

function channelLabel(channel) {
  return channel === "image" ? "图片" : "文本";
}

function setStatus(text, tone = "") {
  statusNode.textContent = text;
  statusNode.dataset.tone = tone;
}

function normalizeApiKey(value) {
  return String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function isHeaderSafeToken(value) {
  return /^[\x21-\x7E]+$/.test(value);
}
