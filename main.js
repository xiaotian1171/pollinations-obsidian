"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PollinationsPlugin,
  defaults: () => defaults
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/api.ts
var GEN_BASE = "https://gen.pollinations.ai";
var ENTER_BASE = "https://enter.pollinations.ai";
var DEFAULT_TEXT_MODEL = "nova-fast";
var DEFAULT_IMAGE_MODEL = "tongyi-mai/z-image-turbo";
function authHeaders(apiKey) {
  return apiKey ? { Authorization: "Bearer " + apiKey } : {};
}
function jsonHeaders(apiKey) {
  return Object.assign({ "Content-Type": "application/json" }, authHeaders(apiKey));
}
function query(pairs) {
  const parts = [];
  for (const [key, value] of pairs) {
    if (value === void 0 || value === null || value === "") continue;
    if (typeof value === "number" && !isFinite(value)) continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  return parts.length ? "?" + parts.join("&") : "";
}
function buildChatRequest(prompt, options = {}, apiKey = "") {
  const messages = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });
  const payload = { messages };
  if (options.model) payload.model = options.model;
  if (options.temperature !== void 0) payload.temperature = options.temperature;
  if (options.maxTokens !== void 0 && options.maxTokens > 0) payload.max_tokens = options.maxTokens;
  if (options.seed !== void 0 && options.seed >= 0) payload.seed = options.seed;
  if (options.json) payload.response_format = { type: "json_object" };
  return {
    url: GEN_BASE + "/v1/chat/completions",
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify(payload)
  };
}
function buildTextRequest(prompt, options = {}, apiKey = "") {
  return {
    url: GEN_BASE + "/text/" + encodeURIComponent(prompt) + query([
      ["model", options.model],
      ["seed", options.seed],
      ["system", options.system],
      ["json", options.json ? "true" : void 0]
    ]),
    method: "GET",
    headers: authHeaders(apiKey)
  };
}
function buildImageRequest(prompt, options = {}, apiKey = "") {
  return {
    url: GEN_BASE + "/image/" + encodeURIComponent(prompt) + query([
      ["model", options.model],
      ["width", options.width],
      ["height", options.height],
      ["seed", options.seed],
      ["safe", options.safe],
      ["enhance", options.enhance],
      ["nologo", options.nologo]
    ]),
    method: "GET",
    headers: authHeaders(apiKey)
  };
}
function buildModelsRequest(modality) {
  const path = modality === "embeddings" ? "/embeddings/models" : "/" + modality + "/models";
  return { url: GEN_BASE + path, method: "GET", headers: {} };
}
function buildDeviceCodeRequest(appKey) {
  const body = appKey ? { client_id: appKey } : {};
  return {
    url: ENTER_BASE + "/api/device/code",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
function buildDeviceTokenRequest(deviceCode) {
  return {
    url: ENTER_BASE + "/api/device/token",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode })
  };
}
function buildUserInfoRequest(apiKey) {
  return { url: ENTER_BASE + "/api/device/userinfo", method: "GET", headers: authHeaders(apiKey) };
}
function verificationUrl(uri, userCode, withCode) {
  const target = uri && uri.startsWith("http") ? uri : ENTER_BASE + (uri || "/device");
  return withCode ? target + "?user_code=" + encodeURIComponent(userCode) : target;
}
var BALANCE_PATTERNS = [
  /[iI]nsufficient balance/,
  /insufficient_balance/,
  /[oO]ut of pollen/,
  /[nN]o pollen/,
  /balance is too low/
];
function mentionsBalance(body) {
  if (!body) return false;
  return BALANCE_PATTERNS.some((pattern) => pattern.test(body));
}
function classify(status, body, transportFailed = false, parseFailed = false) {
  if (transportFailed) return "network";
  if (status === 0) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "balance";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status >= 500) return "server";
  if (status >= 200 && status < 300) {
    if (parseFailed) return "parse";
    if (mentionsBalance(body)) return "balance";
    return "none";
  }
  return "unknown";
}
function retryable(kind) {
  return kind === "rate_limit" || kind === "server" || kind === "network";
}
function backoffSeconds(attempt, base = 0.75, cap = 8) {
  if (attempt <= 1) return base;
  return Math.min(cap, base * Math.pow(2, attempt - 1));
}
function kindName(kind) {
  return kind === "none" ? "success" : kind.replace("_", " ");
}
function messageFor(kind, status = 0, detail = "") {
  switch (kind) {
    case "none":
      return "Done.";
    case "auth":
      return "Pollinations rejected the API key. Check the key in the plugin settings, or sign in again.";
    case "balance":
      return "This key is out of Pollen. Top up at enter.pollinations.ai, or sign in with an account that has some.";
    case "rate_limit":
      return "Pollinations is rate limiting this key. Wait a moment and try again.";
    case "bad_request":
      return "Pollinations rejected the request: " + (detail || "HTTP " + status) + ".";
    case "server":
      return "Pollinations had a server error (HTTP " + status + "). Tried a few times; try again later.";
    case "network":
      return "Could not reach Pollinations. Check the network connection and try again.";
    case "parse":
      return "Pollinations answered with something the plugin could not read.";
    default:
      return "Unexpected answer from Pollinations (HTTP " + status + ").";
  }
}
function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}
function extractText(body) {
  const parsed = parseJson(body);
  if (typeof parsed === "string") return parsed;
  const root = asObject(parsed);
  if (!root) return "";
  const choices = asArray(root.choices);
  for (const choice of choices) {
    const choiceObject = asObject(choice);
    if (!choiceObject) continue;
    const message = asObject(choiceObject.message);
    if (message) {
      const content = contentToText(message.content);
      if (content) return content;
    }
    if (typeof choiceObject.text === "string" && choiceObject.text) return choiceObject.text;
  }
  for (const key of ["text", "content", "response", "output_text"]) {
    if (typeof root[key] === "string" && root[key].trim() !== "") {
      return root[key];
    }
  }
  if (root.output_text) {
    const nested = contentToText(root.output_text);
    if (nested) return nested;
  }
  return "";
}
function contentToText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      const nested = contentToText(item);
      if (nested) parts.push(nested);
    }
    return parts.join("");
  }
  const object = asObject(value);
  if (!object) return "";
  if (typeof object.text === "string") return object.text;
  if (object.content !== void 0) return contentToText(object.content);
  if (object.message !== void 0) return contentToText(object.message);
  return "";
}
function extractUsage(body) {
  var _a, _b, _c, _d;
  const root = asObject(parseJson(body));
  if (!root) return null;
  const usage = asObject(root.usage);
  if (!usage) return null;
  const details = asObject(usage.prompt_tokens_details);
  return {
    promptTokens: Number((_a = usage.prompt_tokens) != null ? _a : 0),
    completionTokens: Number((_b = usage.completion_tokens) != null ? _b : 0),
    totalTokens: Number((_c = usage.total_tokens) != null ? _c : 0),
    cachedTokens: Number((_d = details && details.cached_tokens) != null ? _d : 0)
  };
}
function extractModel(body) {
  const root = asObject(parseJson(body));
  if (!root) return "";
  if (typeof root.model === "string") return root.model;
  const choices = asArray(root.choices);
  const first = asObject(choices[0]);
  return first && typeof first.model === "string" ? first.model : "";
}
function modelFromEntry(entry, fallbackCategory) {
  const object = asObject(entry);
  if (!object) return null;
  const id = typeof object.name === "string" && object.name || typeof object.id === "string" && object.id || "";
  if (!id) return null;
  const aliases = asArray(object.aliases).filter((alias) => typeof alias === "string");
  const endpoints = asArray(object.supported_endpoints).filter(
    (endpoint) => typeof endpoint === "string"
  );
  return {
    id,
    title: typeof object.title === "string" && object.title || id,
    category: typeof object.category === "string" && object.category || fallbackCategory,
    publisher: typeof object.publisher === "string" && object.publisher || "",
    description: typeof object.description === "string" && object.description || "",
    aliases,
    endpoints
  };
}
function parseModels(body, modality = "text") {
  const parsed = parseJson(body);
  let entries = [];
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else {
    const root = asObject(parsed);
    if (root) {
      if (Array.isArray(root.data)) entries = root.data;
      else if (Array.isArray(root.models)) entries = root.models;
      else if (Array.isArray(root.categories)) {
        for (const category of root.categories) {
          const categoryObject = asObject(category);
          if (categoryObject && Array.isArray(categoryObject.models)) {
            entries = entries.concat(categoryObject.models);
          }
        }
      }
    }
  }
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const model = modelFromEntry(entry, modality);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}
function parseDeviceCode(body) {
  var _a, _b;
  const root = asObject(parseJson(body));
  if (!root) return null;
  const deviceCode = typeof root.device_code === "string" ? root.device_code : "";
  const userCode = typeof root.user_code === "string" ? root.user_code : "";
  if (!deviceCode || !userCode) return null;
  const uri = typeof root.verification_uri === "string" && root.verification_uri || typeof root.verification_url === "string" && root.verification_url || "/device";
  const interval = Number((_a = root.interval) != null ? _a : 5);
  const expiresIn = Number((_b = root.expires_in) != null ? _b : 900);
  return {
    deviceCode,
    userCode,
    verificationUri: uri,
    interval: isFinite(interval) && interval >= 1 ? interval : 1,
    expiresIn: isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900
  };
}
function parseDeviceToken(status, body) {
  var _a, _b, _c;
  const root = asObject(parseJson(body)) || {};
  const error = String((_a = root.error) != null ? _a : "").toLowerCase();
  const detail = typeof root.error_description === "string" && root.error_description || typeof root.message === "string" && root.message || String((_b = root.error) != null ? _b : "");
  const interval = Number((_c = root.interval) != null ? _c : 0);
  if (status >= 200 && status < 300 && typeof root.access_token === "string" && root.access_token) {
    return { state: "granted", apiKey: root.access_token, interval: interval > 0 ? interval : 0, detail };
  }
  if (error === "authorization_pending" || error === "pending" || status === 428) {
    return { state: "pending", apiKey: "", interval: interval > 0 ? interval : 0, detail };
  }
  if (error === "slow_down") {
    return { state: "slow_down", apiKey: "", interval: interval > 0 ? interval : 5, detail };
  }
  if (error === "expired_token" || error === "expired") {
    return { state: "expired", apiKey: "", interval: 0, detail };
  }
  if (error === "access_denied" || error === "denied") {
    return { state: "denied", apiKey: "", interval: 0, detail };
  }
  return { state: "error", apiKey: "", interval: 0, detail };
}
function parseUserInfo(body) {
  const root = asObject(parseJson(body));
  if (!root) return { name: "", email: "" };
  const name = typeof root.name === "string" && root.name || typeof root.username === "string" && root.username || typeof root.preferred_username === "string" && root.preferred_username || "";
  const email = typeof root.email === "string" ? root.email : "";
  return { name, email };
}
function isTextual(contentType) {
  if (!contentType) return true;
  const mime = contentType.toLowerCase();
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return false;
  if (mime.startsWith("application/octet-stream")) return false;
  return true;
}
function imageExtension(contentType, url = "") {
  const mime = (contentType || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  const fromUrl = /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.exec(url || "");
  if (fromUrl) return fromUrl[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

// src/format.ts
function applyTemplate(template, values) {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}
function slugify(text, maxWords = 6, maxLength = 48) {
  const words = (text || "").toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/[\s-]+/).filter((word) => word.length > 0).slice(0, maxWords);
  let slug = words.join("-");
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, "");
  }
  return slug || "image";
}
function timestampName(date = /* @__PURE__ */ new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}
function imageFileName(prompt, extension, date = /* @__PURE__ */ new Date()) {
  return "pollinations-" + slugify(prompt) + "-" + timestampName(date) + "." + extension;
}
function vaultPath(folder, name) {
  const clean = (folder || "").replace(/^\/+|\/+$/g, "");
  return clean ? clean + "/" + name : name;
}
function uniqueName(name, taken) {
  if (!taken.includes(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  while (taken.includes(base + "-" + index + extension)) index += 1;
  return base + "-" + index + extension;
}
function insertText(content, from, to, text, mode) {
  const start = Math.max(0, Math.min(from, content.length));
  const end = Math.max(start, Math.min(to, content.length));
  if (mode === "replace") {
    const updated2 = content.slice(0, start) + text + content.slice(end);
    return { content: updated2, cursor: start + text.length };
  }
  if (mode === "below") {
    const prefix = content.slice(0, end);
    const needsNewline = prefix.length > 0 && !prefix.endsWith("\n");
    const block = (needsNewline ? "\n" : "") + text + "\n";
    const updated2 = content.slice(0, end) + block + content.slice(end).replace(/^\n+/, "");
    return { content: updated2, cursor: end + block.length };
  }
  const updated = content.slice(0, start) + text + content.slice(end);
  return { content: updated, cursor: start + text.length };
}
function promptFromSelection(selection, template) {
  const trimmed = (selection || "").trim();
  if (!trimmed) return "";
  const rendered = applyTemplate(template, { text: trimmed, prompt: trimmed });
  return rendered.trim();
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  apiKey: "",
  appKey: "",
  textModel: "",
  imageModel: "",
  systemPrompt: "You are a concise, helpful assistant writing inside a note.",
  selectionTemplate: "{{text}}",
  imageFolder: "",
  imageWidth: 1024,
  imageHeight: 1024,
  insertMode: "cursor",
  temperature: 0.7,
  maxTokens: 0,
  openLinkAfterSignIn: true,
  accountName: ""
};
function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
function normalizeSettings(raw) {
  var _a;
  const input = raw && typeof raw === "object" ? raw : {};
  const merged = Object.assign({}, DEFAULT_SETTINGS, input);
  return {
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey.trim() : "",
    appKey: typeof merged.appKey === "string" ? merged.appKey.trim() : "",
    textModel: typeof merged.textModel === "string" ? merged.textModel.trim() : "",
    imageModel: typeof merged.imageModel === "string" ? merged.imageModel.trim() : "",
    systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt : "",
    selectionTemplate: typeof merged.selectionTemplate === "string" && merged.selectionTemplate ? merged.selectionTemplate : DEFAULT_SETTINGS.selectionTemplate,
    imageFolder: typeof merged.imageFolder === "string" ? merged.imageFolder.replace(/^\/+|\/+$/g, "") : "",
    imageWidth: clampInt(merged.imageWidth, DEFAULT_SETTINGS.imageWidth, 64, 4096),
    imageHeight: clampInt(merged.imageHeight, DEFAULT_SETTINGS.imageHeight, 64, 4096),
    insertMode: merged.insertMode === "below" || merged.insertMode === "replace" ? merged.insertMode : "cursor",
    temperature: Math.min(2, Math.max(0, Number((_a = merged.temperature) != null ? _a : DEFAULT_SETTINGS.temperature) || 0)),
    maxTokens: clampInt(merged.maxTokens, 0, 0, 2e5),
    openLinkAfterSignIn: merged.openLinkAfterSignIn !== false,
    accountName: typeof merged.accountName === "string" ? merged.accountName : ""
  };
}
function resolveApiKey(settings, env = {}) {
  return settings.apiKey || env.POLLINATIONS_API_KEY || "";
}
function resolveAppKey(settings, env = {}) {
  return settings.appKey || env.POLLINATIONS_APP_KEY || "";
}

// src/main.ts
var sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
function environment() {
  try {
    return typeof process !== "undefined" && process.env ? process.env : {};
  } catch (e) {
    return {};
  }
}
var PollinationsService = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  get settings() {
    return this.plugin.settings;
  }
  apiKey() {
    return resolveApiKey(this.settings, environment());
  }
  async send(request, options = {}) {
    var _a;
    const retries = (_a = options.retries) != null ? _a : 2;
    let attempts = 0;
    let last = {
      ok: false,
      kind: "network",
      status: 0,
      text: "",
      bytes: null,
      contentType: "",
      attempts: 0,
      message: messageFor("network")
    };
    while (attempts <= retries) {
      attempts += 1;
      last = await this.attempt(request, options, attempts);
      if (last.ok || !retryable(last.kind)) break;
      if (attempts <= retries) await sleep(backoffSeconds(attempts) * 1e3);
    }
    if (last.kind !== "none" && this.settings.apiKey) {
      console.log("Pollinations:", kindName(last.kind), "HTTP", last.status, request.url);
    }
    return last;
  }
  async attempt(request, options, attempts) {
    let response;
    try {
      response = await (0, import_obsidian.requestUrl)({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        throw: false
      });
    } catch (error) {
      return {
        ok: false,
        kind: "network",
        status: 0,
        text: "",
        bytes: null,
        contentType: "",
        attempts,
        message: messageFor("network") + " (" + String(error) + ")"
      };
    }
    const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "";
    const textual = isTextual(contentType);
    const text = textual ? response.text : "";
    let bytes = null;
    if (options.binary) {
      try {
        bytes = response.arrayBuffer;
      } catch (e) {
        bytes = null;
      }
    }
    const kind = classify(
      response.status,
      text,
      false,
      response.status >= 200 && response.status < 300 && options.binary && !bytes
    );
    const detail = extractText(text) || text.slice(0, 200);
    return {
      ok: kind === "none",
      kind,
      status: response.status,
      text,
      bytes,
      contentType,
      attempts,
      message: kind === "none" ? "Done." : messageFor(kind, response.status, detail)
    };
  }
  /* ------------------------------------------------------------ generations */
  async generateText(prompt, model = "") {
    const settings = this.settings;
    const useQuickRoute = !model && !settings.systemPrompt;
    const request = useQuickRoute ? buildTextRequest(prompt, { model: model || settings.textModel, seed: -1 }, this.apiKey()) : buildChatRequest(
      prompt,
      {
        model: model || settings.textModel,
        system: settings.systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens
      },
      this.apiKey()
    );
    const result = await this.send(request);
    if (!result.ok) throw new PollinationsError(result);
    const answer = extractText(result.text).trim();
    if (!answer) throw new PollinationsError(Object.assign({}, result, { kind: "parse", message: messageFor("parse") }));
    const usage = extractUsage(result.text);
    return {
      text: answer,
      model: extractModel(result.text),
      note: usage && usage.totalTokens > 0 ? usage.totalTokens + " tokens" : ""
    };
  }
  async generateImage(prompt) {
    const settings = this.settings;
    const request = buildImageRequest(
      prompt,
      {
        model: settings.imageModel,
        width: settings.imageWidth,
        height: settings.imageHeight
      },
      this.apiKey()
    );
    const result = await this.send(request, { binary: true, retries: 1 });
    if (!result.ok) throw new PollinationsError(result);
    if (!result.bytes) {
      throw new PollinationsError({
        ok: false,
        kind: "parse",
        status: result.status,
        text: result.text,
        bytes: null,
        contentType: result.contentType,
        attempts: result.attempts,
        message: messageFor("parse")
      });
    }
    return { bytes: result.bytes, extension: imageExtension(result.contentType, request.url) };
  }
  async fetchModels(modality) {
    const result = await this.send(buildModelsRequest(modality), { retries: 1 });
    if (!result.ok) throw new PollinationsError(result);
    return parseModels(result.text, modality);
  }
  async profile(apiKey = this.apiKey()) {
    const result = await this.send(buildUserInfoRequest(apiKey), { retries: 0 });
    return result.ok ? parseUserInfo(result.text) : { name: "", email: "" };
  }
};
var PollinationsError = class extends Error {
  constructor(result) {
    super(result.message || messageFor(result.kind));
    this.result = result;
  }
};
var PollinationsPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = normalizeSettings({});
    this.activeRequest = 0;
    /* ------------------------------------------------------------- device flow */
    this.signInRun = 0;
  }
  async onload() {
    await this.loadSettings();
    this.service = new PollinationsService(this);
    this.statusBar = this.addStatusBarItem();
    this.addSettingTab(new PollinationsSettingTab(this.app, this));
    this.addRibbonIcon("sparkles", "Pollinations: generate text", () => {
      this.generateFromEditor("text");
    });
    this.addCommand({
      id: "generate-text",
      name: "Generate text at the cursor",
      editorCallback: (editor, view) => this.generateText(editor, view, false)
    });
    this.addCommand({
      id: "generate-text-from-selection",
      name: "Generate text from the selection",
      editorCallback: (editor, view) => this.generateText(editor, view, true)
    });
    this.addCommand({
      id: "generate-text-review",
      name: "Generate text and review it before inserting",
      editorCallback: (editor, view) => this.generateText(editor, view, false, true)
    });
    this.addCommand({
      id: "generate-image",
      name: "Generate an image and embed it",
      editorCallback: (editor, view) => this.generateImage(editor, view, false)
    });
    this.addCommand({
      id: "generate-image-from-selection",
      name: "Generate an image from the selection",
      editorCallback: (editor, view) => this.generateImage(editor, view, true)
    });
    this.addCommand({
      id: "browse-models",
      name: "Browse the live model list",
      callback: () => new ModelBrowserModal(this).open()
    });
    this.addCommand({
      id: "sign-in",
      name: "Sign in with a Pollen account",
      callback: () => void this.signIn()
    });
    this.addCommand({
      id: "fetch-models",
      name: "Test the connection and count the models",
      callback: () => void this.testConnection()
    });
  }
  onunload() {
    this.statusBar.setText("");
  }
  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  busy(text) {
    this.activeRequest += 1;
    this.statusBar.setText("Pollinations: " + text);
    return this.activeRequest;
  }
  done(token) {
    if (token === this.activeRequest) this.statusBar.setText("");
  }
  fail(error) {
    const message = error instanceof Error ? error.message : String(error);
    new import_obsidian.Notice("Pollinations: " + message, 8e3);
    console.error("Pollinations:", error);
  }
  /* -------------------------------------------------------------- commands */
  activeEditor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    return view ? view.editor : null;
  }
  generateFromEditor(kind) {
    const editor = this.activeEditor();
    if (!editor) {
      new import_obsidian.Notice("Pollinations: open a note first.");
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (kind === "text") void this.generateText(editor, view != null ? view : null, false);
    else void this.generateImage(editor, view != null ? view : null, false);
  }
  async askForPrompt(title, placeholder, initial = "") {
    return new Promise((resolve) => new PromptModal(this.app, title, placeholder, initial, resolve).open());
  }
  async generateText(editor, view, fromSelection, review = false) {
    const selection = editor.getSelection();
    let prompt = "";
    if (fromSelection) {
      prompt = promptFromSelection(selection, this.settings.selectionTemplate);
      if (!prompt) {
        new import_obsidian.Notice("Pollinations: select some text first.");
        return;
      }
    } else {
      const asked = await this.askForPrompt("Generate text", "What should the note say?", selection.trim());
      if (asked === null) return;
      prompt = asked.trim();
      if (!prompt) return;
    }
    const token = this.busy("thinking...");
    try {
      const answer = await this.service.generateText(prompt);
      const mode = this.settings.insertMode;
      if (review) {
        const current = editor.getValue();
        const from = editor.posToOffset(editor.getCursor("from"));
        const to = editor.posToOffset(editor.getCursor("to"));
        const preview = insertText(current, from, to, answer.text, mode);
        new ReviewModal(this.app, answer.text, () => {
          editor.setValue(preview.content);
          editor.setCursor(editor.offsetToPos(preview.cursor));
          new import_obsidian.Notice("Pollinations: inserted.", 3e3);
        }).open();
      } else {
        this.insertIntoEditor(editor, answer.text, mode);
      }
      this.statusBar.setText(answer.note ? "Pollinations: " + answer.note : "");
      window.setTimeout(() => this.statusBar.setText(""), 3e3);
    } catch (error) {
      this.fail(error);
    } finally {
      this.done(token);
    }
  }
  insertIntoEditor(editor, text, mode) {
    if (mode === "below") {
      editor.replaceRange("\n" + text + "\n", editor.getCursor("to"));
      return;
    }
    editor.replaceSelection(text);
  }
  async generateImage(editor, view, fromSelection) {
    var _a, _b;
    let prompt = "";
    if (fromSelection && editor) {
      prompt = promptFromSelection(editor.getSelection(), "{{text}}");
      if (!prompt) {
        new import_obsidian.Notice("Pollinations: select some text first.");
        return;
      }
    } else {
      const asked = await this.askForPrompt("Generate an image", "Describe the image");
      if (asked === null) return;
      prompt = asked.trim();
      if (!prompt) return;
    }
    const token = this.busy("drawing...");
    try {
      const image = await this.service.generateImage(prompt);
      const file = await this.saveImage(prompt, image.bytes, image.extension, view);
      if (editor) {
        const link = this.app.fileManager.generateMarkdownLink(file, (_b = (_a = view == null ? void 0 : view.file) == null ? void 0 : _a.path) != null ? _b : file.path);
        editor.replaceRange((editor.getLine(editor.getCursor("to").line) ? "\n\n" : "\n") + "!" + link + "\n", editor.getCursor("to"));
      }
      new import_obsidian.Notice("Pollinations: saved " + file.path, 5e3);
    } catch (error) {
      this.fail(error);
    } finally {
      this.done(token);
    }
  }
  /** Saves the image next to the note, or in the configured folder. */
  async saveImage(prompt, bytes, extension, view) {
    var _a, _b, _c;
    const folder = this.settings.imageFolder || ((_c = (_b = (_a = view == null ? void 0 : view.file) == null ? void 0 : _a.parent) == null ? void 0 : _b.path) != null ? _c : "");
    const noteFolder = folder === "/" ? "" : folder;
    if (noteFolder && !this.app.vault.getAbstractFileByPath(noteFolder)) {
      await this.app.vault.createFolder(noteFolder);
    }
    const taken = this.app.vault.getFiles().filter((file) => {
      var _a2, _b2;
      return ((_b2 = (_a2 = file.parent) == null ? void 0 : _a2.path) != null ? _b2 : "") === noteFolder;
    }).map((file) => file.name);
    const candidate = uniqueName(imageFileName(prompt, extension), taken);
    const path = vaultPath(noteFolder, candidate);
    return this.app.vault.createBinary(path, bytes);
  }
  async testConnection() {
    const token = this.busy("testing...");
    try {
      const models = await this.service.fetchModels("text");
      new import_obsidian.Notice("Pollinations: connected, " + models.length + " text models available.", 5e3);
    } catch (error) {
      this.fail(error);
    } finally {
      this.done(token);
    }
  }
  async signIn() {
    this.signInRun += 1;
    const run = this.signInRun;
    const token = this.busy("signing in...");
    try {
      const start = await this.service.send(buildDeviceCodeRequest(resolveAppKey(this.settings, environment())), {
        retries: 1
      });
      if (!start.ok) throw new PollinationsError(start);
      const code = parseDeviceCode(start.text);
      if (!code) throw new Error("Pollinations did not return a device code.");
      const page = verificationUrl(code.verificationUri, code.userCode, false);
      const withCode = verificationUrl(code.verificationUri, code.userCode, true);
      new import_obsidian.Notice("Pollinations: enter " + code.userCode + " at " + page, 15e3);
      if (this.settings.openLinkAfterSignIn) window.open(withCode);
      const modal = new DeviceCodeModal(this.app, code.userCode, withCode, () => {
        this.signInRun += 1;
      });
      modal.open();
      let interval = code.interval;
      const deadline = Date.now() + code.expiresIn * 1e3;
      while (this.signInRun === run && Date.now() < deadline) {
        await sleep(interval * 1e3);
        if (this.signInRun !== run) break;
        const poll = await this.service.send(buildDeviceTokenRequest(code.deviceCode), { retries: 1 });
        const state = parseDeviceToken(poll.status, poll.text);
        if (state.state === "pending") continue;
        if (state.state === "slow_down") {
          interval = Math.max(interval + 5, state.interval);
          continue;
        }
        if (state.state === "granted") {
          this.settings.apiKey = state.apiKey;
          const profile = await this.service.profile(state.apiKey);
          this.settings.accountName = profile.name;
          await this.saveSettings();
          modal.close();
          new import_obsidian.Notice(
            "Pollinations: signed in" + (profile.name ? " as " + profile.name : "") + ". The key is stored in the plugin settings."
          );
          return;
        }
        modal.close();
        new import_obsidian.Notice(
          "Pollinations: sign-in " + state.state + (state.detail ? " - " + state.detail : ""),
          8e3
        );
        return;
      }
      modal.close();
      if (this.signInRun === run) new import_obsidian.Notice("Pollinations: the code expired. Start the sign-in again.", 8e3);
    } catch (error) {
      this.fail(error);
    } finally {
      this.done(token);
    }
  }
  async signOut() {
    this.signInRun += 1;
    this.settings.apiKey = "";
    this.settings.accountName = "";
    await this.saveSettings();
    new import_obsidian.Notice("Pollinations: signed out. The key was removed from the plugin settings.");
  }
};
var PromptModal = class extends import_obsidian.Modal {
  constructor(app, title, placeholder, initial, done) {
    super(app);
    this.value = initial;
    this.done = done;
    this.titleEl.setText(title);
    new import_obsidian.Setting(this.contentEl).addTextArea((area) => {
      area.setPlaceholder(placeholder).setValue(initial).onChange((value) => {
        this.value = value;
      });
      area.inputEl.rows = 5;
      area.inputEl.addClass("pollinations-prompt-input");
      window.setTimeout(() => area.inputEl.focus(), 0);
    });
    new import_obsidian.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Generate").setCta().onClick(() => {
        this.done(this.value);
        this.close();
      })
    ).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    if (this.value === null) return;
    this.contentEl.empty();
  }
};
var ReviewModal = class extends import_obsidian.Modal {
  constructor(app, text, insert) {
    super(app);
    this.insert = insert;
    this.titleEl.setText("Review the generated text");
    const preview = this.contentEl.createEl("div", { cls: "pollinations-preview" });
    preview.setText(text);
    new import_obsidian.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Insert").setCta().onClick(() => {
        this.insert();
        this.close();
      })
    ).addButton(
      (button) => button.setButtonText("Copy").onClick(async () => {
        await navigator.clipboard.writeText(text);
        new import_obsidian.Notice("Copied.");
      })
    ).addButton((button) => button.setButtonText("Discard").onClick(() => this.close()));
  }
};
var DeviceCodeModal = class extends import_obsidian.Modal {
  constructor(app, code, url, cancel) {
    super(app);
    this.code = code;
    this.url = url;
    this.cancel = cancel;
    this.titleEl.setText("Sign in to Pollinations");
    this.contentEl.createEl("p", {
      text: "Enter this code on the Pollinations page, then approve the request. This window closes by itself."
    });
    this.contentEl.createEl("div", { text: this.code, cls: "pollinations-code" });
    new import_obsidian.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Open the page").onClick(() => {
        window.open(this.url);
      })
    ).addButton(
      (button) => button.setButtonText("Copy the code").onClick(async () => {
        await navigator.clipboard.writeText(this.code);
        new import_obsidian.Notice("Copied.");
      })
    ).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }
  onClose() {
    this.cancel();
  }
};
var ModelBrowserModal = class extends import_obsidian.Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.models = [];
    this.titleEl.setText("Pollinations models");
    const search = this.contentEl.createEl("input", { type: "text" });
    search.placeholder = "Filter by name or publisher";
    search.addClass("pollinations-filter");
    search.oninput = () => this.render(search.value);
    this.listEl = this.contentEl.createEl("div");
    for (const modality of ["text", "image"]) {
      this.plugin.service.fetchModels(modality).then((models) => {
        this.models = this.models.concat(models).sort((a, b) => a.id.localeCompare(b.id));
        this.render(search.value);
      }).catch((error) => this.plugin.fail(error));
    }
  }
  render(filter) {
    const needle = filter.trim().toLowerCase();
    this.listEl.empty();
    if (this.models.length === 0) {
      this.listEl.createEl("p", { text: "Loading the live model list..." });
      return;
    }
    const shown = this.models.filter(
      (model) => !needle || model.id.toLowerCase().includes(needle) || model.title.toLowerCase().includes(needle) || model.publisher.toLowerCase().includes(needle)
    );
    for (const model of shown.slice(0, 200)) {
      const row = new import_obsidian.Setting(this.listEl).setName(model.title || model.id).setDesc(
        model.id + (model.publisher ? " - " + model.publisher : "") + (model.description ? " - " + model.description : "")
      );
      row.addButton(
        (button) => button.setButtonText(model.category === "image" ? "Use for images" : "Use for text").onClick(async () => {
          if (model.category === "image") this.plugin.settings.imageModel = model.id;
          else this.plugin.settings.textModel = model.id;
          await this.plugin.saveSettings();
          new import_obsidian.Notice("Pollinations: " + model.id + " is now the default " + model.category + " model.");
        })
      );
    }
  }
};
var PollinationsSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pollinations" });
    containerEl.createEl("p", {
      text: "Generate text and images inside your notes, paying with your own Pollen. Create a key at enter.pollinations.ai/keys, or sign in with a code below."
    });
    new import_obsidian.Setting(containerEl).setName("API key").setDesc(this.plugin.settings.apiKey ? "A key is stored in this plugin's settings." : "No key yet.").addText(
      (text) => text.setPlaceholder("sk_...").setValue(this.plugin.settings.apiKey).onChange(async (value) => {
        this.plugin.settings.apiKey = value.trim();
        await this.plugin.saveSettings();
      })
    ).addButton(
      (button) => button.setButtonText("Sign in with a code").onClick(() => void this.plugin.signIn())
    ).addButton((button) => button.setButtonText("Sign out").onClick(() => void this.plugin.signOut()));
    new import_obsidian.Setting(containerEl).setName("App key").setDesc(
      "Optional. Your own publishable key (pk_...) from enter.pollinations.ai/keys, so sign-ins are attributed to your Pollinations account. Leave empty to use the default consent screen."
    ).addText(
      (text) => text.setPlaceholder("pk_...").setValue(this.plugin.settings.appKey).onChange(async (value) => {
        this.plugin.settings.appKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    if (this.plugin.settings.accountName) {
      containerEl.createEl("p", { text: "Signed in as " + this.plugin.settings.accountName + "." });
    }
    new import_obsidian.Setting(containerEl).setName("Test the connection").setDesc("Ask Pollinations for the live model list.").addButton(
      (button) => button.setButtonText("Test").onClick(() => void this.plugin.testConnection())
    );
    containerEl.createEl("h3", { text: "Models" });
    new import_obsidian.Setting(containerEl).setName("Text model").setDesc('Leave empty for the quick default (nova-fast). Use the command "Browse the live model list" to pick one.').addText(
      (text) => text.setPlaceholder(DEFAULT_TEXT_MODEL).setValue(this.plugin.settings.textModel).onChange(async (value) => {
        this.plugin.settings.textModel = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Image model").setDesc("Leave empty for the quick default. Anything from the live image list works.").addText(
      (text) => text.setPlaceholder(DEFAULT_IMAGE_MODEL).setValue(this.plugin.settings.imageModel).onChange(async (value) => {
        this.plugin.settings.imageModel = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("System prompt").setDesc("Sent with text requests. Leave empty to use the cheaper one-shot text route.").addTextArea((area) => {
      area.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
        this.plugin.settings.systemPrompt = value;
        await this.plugin.saveSettings();
      });
      area.inputEl.rows = 3;
    });
    new import_obsidian.Setting(containerEl).setName("Selection template").setDesc("How the selection is sent. {{text}} is replaced with the selected text.").addText(
      (text) => text.setPlaceholder("{{text}}").setValue(this.plugin.settings.selectionTemplate).onChange(async (value) => {
        this.plugin.settings.selectionTemplate = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Temperature").addSlider(
      (slider) => slider.setLimits(0, 2, 0.1).setValue(this.plugin.settings.temperature).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.temperature = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Max tokens").setDesc("0 means no limit.").addText(
      (text) => text.setValue(String(this.plugin.settings.maxTokens)).onChange(async (value) => {
        const number = Number(value);
        this.plugin.settings.maxTokens = isFinite(number) && number > 0 ? Math.round(number) : 0;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Images" });
    new import_obsidian.Setting(containerEl).setName("Image folder").setDesc("Vault folder for generated images. Leave empty to save next to the note.").addText(
      (text) => text.setPlaceholder("attachments").setValue(this.plugin.settings.imageFolder).onChange(async (value) => {
        this.plugin.settings.imageFolder = value.trim().replace(/^\/+|\/+$/g, "");
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Image size").setDesc("Width and height in pixels.").addText(
      (text) => text.setValue(String(this.plugin.settings.imageWidth)).onChange(async (value) => {
        this.plugin.settings.imageWidth = normalizeSettings({ imageWidth: Number(value) }).imageWidth;
        await this.plugin.saveSettings();
      })
    ).addText(
      (text) => text.setValue(String(this.plugin.settings.imageHeight)).onChange(async (value) => {
        this.plugin.settings.imageHeight = normalizeSettings({ imageHeight: Number(value) }).imageHeight;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Where generated text goes").addDropdown(
      (dropdown) => dropdown.addOption("cursor", "At the cursor").addOption("below", "On a new line below").addOption("replace", "Replacing the selection").setValue(this.plugin.settings.insertMode).onChange(async (value) => {
        this.plugin.settings.insertMode = normalizeSettings({ insertMode: value }).insertMode;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Open the sign-in page in the browser").setDesc("Turn off if you would rather open the link yourself, for example on a phone.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openLinkAfterSignIn).onChange(async (value) => {
        this.plugin.settings.openLinkAfterSignIn = value;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("p", {
      text: "Nothing is generated until you run a command. The plugin sends the prompt to Pollinations and stores the answer in the note; keys stay on this device.",
      cls: "pollinations-progress"
    });
  }
};
var defaults = DEFAULT_SETTINGS;
