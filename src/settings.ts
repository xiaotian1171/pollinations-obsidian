import type { ThemeColors } from "./types";

/**
 * Settings are plain data so they can be defaulted and repaired without
 * Obsidian in the picture (see tests/settings).
 */

export type InsertMode = "cursor" | "below" | "replace";

export interface PollinationsSettings {
	apiKey: string;
	appKey: string;
	textModel: string;
	imageModel: string;
	systemPrompt: string;
	selectionTemplate: string;
	imageFolder: string;
	imageWidth: number;
	imageHeight: number;
	insertMode: InsertMode;
	temperature: number;
	maxTokens: number;
	openLinkAfterSignIn: boolean;
	/** The Pollinations account name, once a device sign-in succeeded. */
	accountName: string;
}

export const DEFAULT_SETTINGS: PollinationsSettings = {
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
	accountName: "",
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const number = Number(value);
	if (!isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSettings(raw: unknown): PollinationsSettings {
	const input = (raw && typeof raw === "object" ? raw : {}) as Partial<PollinationsSettings>;
	const merged = Object.assign({}, DEFAULT_SETTINGS, input);

	return {
		apiKey: typeof merged.apiKey === "string" ? merged.apiKey.trim() : "",
		appKey: typeof merged.appKey === "string" ? merged.appKey.trim() : "",
		textModel: typeof merged.textModel === "string" ? merged.textModel.trim() : "",
		imageModel: typeof merged.imageModel === "string" ? merged.imageModel.trim() : "",
		systemPrompt: typeof merged.systemPrompt === "string" ? merged.systemPrompt : "",
		selectionTemplate: typeof merged.selectionTemplate === "string" && merged.selectionTemplate
			? merged.selectionTemplate
			: DEFAULT_SETTINGS.selectionTemplate,
		imageFolder: typeof merged.imageFolder === "string" ? merged.imageFolder.replace(/^\/+|\/+$/g, "") : "",
		imageWidth: clampInt(merged.imageWidth, DEFAULT_SETTINGS.imageWidth, 64, 4096),
		imageHeight: clampInt(merged.imageHeight, DEFAULT_SETTINGS.imageHeight, 64, 4096),
		insertMode:
			merged.insertMode === "below" || merged.insertMode === "replace" ? merged.insertMode : "cursor",
		temperature: Math.min(2, Math.max(0, Number(merged.temperature ?? DEFAULT_SETTINGS.temperature) || 0)),
		maxTokens: clampInt(merged.maxTokens, 0, 0, 200000),
		openLinkAfterSignIn: merged.openLinkAfterSignIn !== false,
		accountName: typeof merged.accountName === "string" ? merged.accountName : "",
	};
}

/** The key the plugin sends: the user's own key, else the environment's. */
export function resolveApiKey(settings: PollinationsSettings, env: Record<string, string | undefined> = {}): string {
	return settings.apiKey || env.POLLINATIONS_API_KEY || "";
}

export function resolveAppKey(settings: PollinationsSettings, env: Record<string, string | undefined> = {}): string {
	return settings.appKey || env.POLLINATIONS_APP_KEY || "";
}

/** Not used yet, kept so the settings tab can theme its own parts. */
export type { ThemeColors };
