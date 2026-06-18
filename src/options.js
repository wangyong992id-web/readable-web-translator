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
  concurrency: 3,
  batchSize: 12,
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
  ["natural", "自然准确：准确但不生硬，拒绝直译"],
  ["finance", "金融科技：适合市场、科技、投资语境"],
  ["faithful", "忠实自然：尽量贴近原意和结构"]
];

const PROVIDERS = {
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

const form = document.querySelector("#settings-form");
const statusNode = document.querySelector("#status");

load();

form.elements.textProvider.addEventListener("change", () => {
  applyProvider("text", form.elements.textProvider.value);
});

form.elements.imageProvider.addEventListener("change", () => {
  applyProvider("image", form.elements.imageProvider.value);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  normalizeChannelData(data, "text");
  normalizeChannelData(data, "image");

  if (!isHeaderSafeToken(data.textApiKey) || (data.imageApiKey && !isHeaderSafeToken(data.imageApiKey))) {
    statusNode.dataset.tone = "error";
    statusNode.textContent = "API token 含有中文、换行、全角空格或不可见字符。请只粘贴 key 本体。";
    return;
  }

  data.concurrency = clamp(Number(data.concurrency) || DEFAULTS.concurrency, 1, 8);
  data.batchSize = clamp(Number(data.batchSize) || DEFAULTS.batchSize, 1, 30);
  data.imageTranslateEnabled = form.elements.imageTranslateEnabled.checked;
  data.selectionTranslateEnabled = form.elements.selectionTranslateEnabled.checked;

  await chrome.storage.local.set(data);
  statusNode.dataset.tone = "success";
  statusNode.textContent = "已保存。刷新网页后即可使用新的设置。";
});

async function load() {
  const stored = await chrome.storage.local.get(null);
  const settings = normalizeSettings({ ...DEFAULTS, ...stored });

  renderSelect(form.elements.sourceLanguage, LANGUAGES);
  renderSelect(form.elements.targetLanguage, LANGUAGES);
  renderSelect(form.elements.translationStyle, TRANSLATION_STYLES);
  applyProvider("text", settings.textProvider, settings.textModel);
  applyProvider("image", settings.imageProvider, settings.imageModel);

  Object.entries(settings).forEach(([key, value]) => {
    if (
      form.elements[key] &&
      ![
        "textModel",
        "textApiBaseUrl",
        "imageModel",
        "imageApiBaseUrl",
        "imageTranslateEnabled",
        "selectionTranslateEnabled"
      ].includes(key)
    ) {
      form.elements[key].value = value;
    }
  });
  form.elements.imageTranslateEnabled.checked = Boolean(settings.imageTranslateEnabled);
  form.elements.selectionTranslateEnabled.checked = Boolean(settings.selectionTranslateEnabled);
}

function applyProvider(channel, providerKey, preferredModel) {
  const provider = PROVIDERS[providerKey] || PROVIDERS[DEFAULTS[`${channel}Provider`]];
  form.elements[`${channel}Provider`].value = providerKey;
  form.elements[`${channel}ApiBaseUrl`].value = provider.apiBaseUrl;
  form.elements[`${channel}Model`].replaceChildren(
    ...provider.models.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      return option;
    })
  );
  form.elements[`${channel}Model`].value = provider.models.includes(preferredModel)
    ? preferredModel
    : provider.models[0];
}

function normalizeChannelData(data, channel) {
  const provider = PROVIDERS[data[`${channel}Provider`]] || PROVIDERS[DEFAULTS[`${channel}Provider`]];
  data[`${channel}ApiBaseUrl`] = provider.apiBaseUrl;
  data[`${channel}ApiKey`] = normalizeApiKeyForStorage(data[`${channel}ApiKey`]);
  if (!provider.models.includes(data[`${channel}Model`])) {
    data[`${channel}Model`] = provider.models[0];
  }
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
    selectionTranslateEnabled: Boolean(settings.selectionTranslateEnabled)
  };
}

function renderSelect(select, options) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
}

function normalizeLanguage(value, fallback) {
  return LANGUAGES.some(([language]) => language === value) ? value : fallback;
}

function normalizeStyle(value) {
  return TRANSLATION_STYLES.some(([style]) => style === value) ? value : DEFAULTS.translationStyle;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeApiKeyForStorage(value) {
  return String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function isHeaderSafeToken(value) {
  return !value || /^[\x21-\x7E]+$/.test(value);
}
