/**
 * The pure half of the plugin: URLs, request shapes, response parsing and error
 * classification. Nothing here imports Obsidian, so the whole file can be tested
 * and run outside the app (see tests/).
 */

export const GEN_BASE = "https://gen.pollinations.ai";
export const ENTER_BASE = "https://enter.pollinations.ai";

/** Only used when the user did not configure an app key of their own. */
export const DEFAULT_APP_KEY = "";

export const DEFAULT_TEXT_MODEL = "nova-fast";
export const DEFAULT_IMAGE_MODEL = "tongyi-mai/z-image-turbo";

export type Modality = "text" | "image" | "audio" | "embeddings";

export type ErrorKind =
	| "none"
	| "auth"
	| "balance"
	| "rate_limit"
	| "bad_request"
	| "server"
	| "network"
	| "parse";

export interface ApiRequest {
	url: string;
	method: "GET" | "POST";
	headers: Record<string, string>;
	body?: string;
}

export interface GenerationOptions {
	model?: string;
	seed?: number;
	system?: string;
	temperature?: number;
	maxTokens?: number;
	json?: boolean;
}

export interface ImageOptions {
	model?: string;
	width?: number;
	height?: number;
	seed?: number;
	safe?: boolean;
	enhance?: boolean;
	nologo?: boolean;
}

export interface ModelInfo {
	id: string;
	title: string;
	category: string;
	publisher: string;
	description: string;
	aliases: string[];
	endpoints: string[];
}

/* ------------------------------------------------------------------ requests */

export function authHeaders(apiKey: string): Record<string, string> {
	return apiKey ? { Authorization: "Bearer " + apiKey } : {};
}

export function jsonHeaders(apiKey: string): Record<string, string> {
	return Object.assign({ "Content-Type": "application/json" }, authHeaders(apiKey));
}

function query(pairs: Array<[string, string | number | boolean | undefined]>): string {
	const parts: string[] = [];
	for (const [key, value] of pairs) {
		if (value === undefined || value === null || value === "") continue;
		if (typeof value === "number" && !isFinite(value)) continue;
		parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
	}
	return parts.length ? "?" + parts.join("&") : "";
}

export function buildChatRequest(prompt: string, options: GenerationOptions = {}, apiKey = ""): ApiRequest {
	const messages: Array<{ role: string; content: string }> = [];
	if (options.system) messages.push({ role: "system", content: options.system });
	messages.push({ role: "user", content: prompt });

	const payload: Record<string, unknown> = { messages };
	if (options.model) payload.model = options.model;
	if (options.temperature !== undefined) payload.temperature = options.temperature;
	if (options.maxTokens !== undefined && options.maxTokens > 0) payload.max_tokens = options.maxTokens;
	if (options.seed !== undefined && options.seed >= 0) payload.seed = options.seed;
	if (options.json) payload.response_format = { type: "json_object" };

	return {
		url: GEN_BASE + "/v1/chat/completions",
		method: "POST",
		headers: jsonHeaders(apiKey),
		body: JSON.stringify(payload),
	};
}

/** The cheap one-shot route; good for short answers where latency matters. */
export function buildTextRequest(prompt: string, options: GenerationOptions = {}, apiKey = ""): ApiRequest {
	return {
		url:
			GEN_BASE +
			"/text/" +
			encodeURIComponent(prompt) +
			query([
				["model", options.model],
				["seed", options.seed],
				["system", options.system],
				["json", options.json ? "true" : undefined],
			]),
		method: "GET",
		headers: authHeaders(apiKey),
	};
}

export function buildImageRequest(prompt: string, options: ImageOptions = {}, apiKey = ""): ApiRequest {
	return {
		url:
			GEN_BASE +
			"/image/" +
			encodeURIComponent(prompt) +
			query([
				["model", options.model],
				["width", options.width],
				["height", options.height],
				["seed", options.seed],
				["safe", options.safe],
				["enhance", options.enhance],
				["nologo", options.nologo],
			]),
		method: "GET",
		headers: authHeaders(apiKey),
	};
}

export function buildModelsRequest(modality: Modality): ApiRequest {
	const path = modality === "embeddings" ? "/embeddings/models" : "/" + modality + "/models";
	return { url: GEN_BASE + path, method: "GET", headers: {} };
}

export function buildDeviceCodeRequest(appKey: string): ApiRequest {
	const body = appKey ? { client_id: appKey } : {};
	return {
		url: ENTER_BASE + "/api/device/code",
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

export function buildDeviceTokenRequest(deviceCode: string): ApiRequest {
	return {
		url: ENTER_BASE + "/api/device/token",
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ device_code: deviceCode }),
	};
}

export function buildUserInfoRequest(apiKey: string): ApiRequest {
	return { url: ENTER_BASE + "/api/device/userinfo", method: "GET", headers: authHeaders(apiKey) };
}

export function verificationUrl(uri: string, userCode: string, withCode: boolean): string {
	const target = uri && uri.startsWith("http") ? uri : ENTER_BASE + (uri || "/device");
	return withCode ? target + "?user_code=" + encodeURIComponent(userCode) : target;
}

/* ------------------------------------------------------------ classification */

const BALANCE_PATTERNS = [
	/[iI]nsufficient balance/,
	/insufficient_balance/,
	/[oO]ut of pollen/,
	/[nN]o pollen/,
	/balance is too low/,
];

export function mentionsBalance(body: string): boolean {
	if (!body) return false;
	return BALANCE_PATTERNS.some((pattern) => pattern.test(body));
}

export function classify(
	status: number,
	body: string,
	transportFailed = false,
	parseFailed = false
): ErrorKind {
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
	return "unknown" as ErrorKind;
}

export function retryable(kind: ErrorKind): boolean {
	return kind === "rate_limit" || kind === "server" || kind === "network";
}

export function backoffSeconds(attempt: number, base = 0.75, cap = 8): number {
	if (attempt <= 1) return base;
	return Math.min(cap, base * Math.pow(2, attempt - 1));
}

export function kindName(kind: ErrorKind): string {
	return kind === "none" ? "success" : kind.replace("_", " ");
}

/** A sentence that makes sense to a note taker. */
export function messageFor(kind: ErrorKind, status = 0, detail = ""): string {
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

/* ------------------------------------------------------------------- reading */

function asObject(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Pulls the answer out of a chat completion. Different models answer in
 * different shapes, so several known ones are tried before giving up.
 */
export function extractText(body: string): string {
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
		if (typeof root[key] === "string" && (root[key] as string).trim() !== "") {
			return root[key] as string;
		}
	}
	if (root.output_text) {
		const nested = contentToText(root.output_text);
		if (nested) return nested;
	}
	return "";
}

/** Content can be a string, a list of parts, or a nested message. */
export function contentToText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const item of value) {
			const nested = contentToText(item);
			if (nested) parts.push(nested);
		}
		return parts.join("");
	}
	const object = asObject(value);
	if (!object) return "";
	if (typeof object.text === "string") return object.text;
	if (object.content !== undefined) return contentToText(object.content);
	if (object.message !== undefined) return contentToText(object.message);
	return "";
}

export interface UsageInfo {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cachedTokens: number;
}

export function extractUsage(body: string): UsageInfo | null {
	const root = asObject(parseJson(body));
	if (!root) return null;
	const usage = asObject(root.usage);
	if (!usage) return null;
	const details = asObject(usage.prompt_tokens_details);
	return {
		promptTokens: Number(usage.prompt_tokens ?? 0),
		completionTokens: Number(usage.completion_tokens ?? 0),
		totalTokens: Number(usage.total_tokens ?? 0),
		cachedTokens: Number((details && details.cached_tokens) ?? 0),
	};
}

export function extractModel(body: string): string {
	const root = asObject(parseJson(body));
	if (!root) return "";
	if (typeof root.model === "string") return root.model;
	const choices = asArray(root.choices);
	const first = asObject(choices[0]);
	return first && typeof first.model === "string" ? first.model : "";
}

/* -------------------------------------------------------------------- models */

function modelFromEntry(entry: unknown, fallbackCategory: string): ModelInfo | null {
	const object = asObject(entry);
	if (!object) return null;

	const id =
		(typeof object.name === "string" && object.name) ||
		(typeof object.id === "string" && object.id) ||
		"";
	if (!id) return null;

	const aliases = asArray(object.aliases).filter((alias): alias is string => typeof alias === "string");
	const endpoints = asArray(object.supported_endpoints).filter(
		(endpoint): endpoint is string => typeof endpoint === "string"
	);

	return {
		id,
		title: (typeof object.title === "string" && object.title) || id,
		category: (typeof object.category === "string" && object.category) || fallbackCategory,
		publisher: (typeof object.publisher === "string" && object.publisher) || "",
		description: (typeof object.description === "string" && object.description) || "",
		aliases,
		endpoints,
	};
}

/** Accepts a plain array as well as the `{ data: [...] }` / `{ models: [...] }` envelopes. */
export function parseModels(body: string, modality: Modality = "text"): ModelInfo[] {
	const parsed = parseJson(body);
	let entries: unknown[] = [];
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

	const models: ModelInfo[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const model = modelFromEntry(entry, modality);
		if (!model || seen.has(model.id)) continue;
		seen.add(model.id);
		models.push(model);
	}
	return models;
}

export function modelIds(models: ModelInfo[]): string[] {
	return models.map((model) => model.id);
}

/** Only the models that accept a given endpoint, e.g. `/v1/chat/completions`. */
export function modelsSupporting(models: ModelInfo[], endpoint: string): ModelInfo[] {
	return models.filter((model) => model.endpoints.length === 0 || model.endpoints.includes(endpoint));
}

export function hasModel(models: ModelInfo[], id: string): boolean {
	if (!id) return false;
	return models.some((model) => model.id === id || model.aliases.includes(id));
}

export function findModel(models: ModelInfo[], id: string): ModelInfo | null {
	if (!id) return null;
	return (
		models.find((model) => model.id === id) ||
		models.find((model) => model.aliases.includes(id)) ||
		null
	);
}

/* --------------------------------------------------------------- device flow */

export interface DeviceCode {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	interval: number;
	expiresIn: number;
}

export function parseDeviceCode(body: string): DeviceCode | null {
	const root = asObject(parseJson(body));
	if (!root) return null;
	const deviceCode = typeof root.device_code === "string" ? root.device_code : "";
	const userCode = typeof root.user_code === "string" ? root.user_code : "";
	if (!deviceCode || !userCode) return null;

	const uri =
		(typeof root.verification_uri === "string" && root.verification_uri) ||
		(typeof root.verification_url === "string" && root.verification_url) ||
		"/device";
	const interval = Number(root.interval ?? 5);
	const expiresIn = Number(root.expires_in ?? 900);

	return {
		deviceCode,
		userCode,
		verificationUri: uri,
		interval: isFinite(interval) && interval >= 1 ? interval : 1,
		expiresIn: isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900,
	};
}

export type TokenState = "pending" | "slow_down" | "granted" | "expired" | "denied" | "error";

export interface TokenPoll {
	state: TokenState;
	apiKey: string;
	interval: number;
	detail: string;
}

export function parseDeviceToken(status: number, body: string): TokenPoll {
	const root = asObject(parseJson(body)) || {};
	const error = String(root.error ?? "").toLowerCase();
	const detail =
		(typeof root.error_description === "string" && root.error_description) ||
		(typeof root.message === "string" && root.message) ||
		String(root.error ?? "");

	const interval = Number(root.interval ?? 0);

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

export function parseUserInfo(body: string): { name: string; email: string } {
	const root = asObject(parseJson(body));
	if (!root) return { name: "", email: "" };
	const name =
		(typeof root.name === "string" && root.name) ||
		(typeof root.username === "string" && root.username) ||
		(typeof root.preferred_username === "string" && root.preferred_username) ||
		"";
	const email = typeof root.email === "string" ? root.email : "";
	return { name, email };
}

/* -------------------------------------------------------------------- bodies */

export function isTextual(contentType: string): boolean {
	if (!contentType) return true;
	const mime = contentType.toLowerCase();
	if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return false;
	if (mime.startsWith("application/octet-stream")) return false;
	return true;
}

/** The file extension to save an image response under. */
export function imageExtension(contentType: string, url = ""): string {
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
