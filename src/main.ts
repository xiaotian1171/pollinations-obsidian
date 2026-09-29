/**
 * Pollinations for Obsidian.
 *
 * The plugin adds text and image generation to the editor. Everything that can
 * be decided without Obsidian (URLs, payloads, parsing, error kinds, file names,
 * where text lands) lives in src/api.ts and src/format.ts, which are covered by
 * tests. This file is the glue: commands, modals, settings and the sign-in flow.
 */

import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
} from "obsidian";

import * as api from "./api";
import * as fmt from "./format";
import {
	DEFAULT_SETTINGS,
	PollinationsSettings,
	normalizeSettings,
	resolveApiKey,
	resolveAppKey,
} from "./settings";

interface SendResult {
	ok: boolean;
	kind: api.ErrorKind;
	status: number;
	text: string;
	bytes: ArrayBuffer | null;
	contentType: string;
	attempts: number;
	message: string;
}

interface SendOptions {
	binary?: boolean;
	retries?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function environment(): Record<string, string | undefined> {
	try {
		return typeof process !== "undefined" && process.env ? (process.env as Record<string, string | undefined>) : {};
	} catch {
		return {};
	}
}

/* ------------------------------------------------------------------- service */

/** Sends API requests through Obsidian's own HTTP client, with retries. */
class PollinationsService {
	constructor(private readonly plugin: PollinationsPlugin) {}

	private get settings(): PollinationsSettings {
		return this.plugin.settings;
	}

	apiKey(): string {
		return resolveApiKey(this.settings, environment());
	}

	async send(request: api.ApiRequest, options: SendOptions = {}): Promise<SendResult> {
		const retries = options.retries ?? 2;
		let attempts = 0;
		let last: SendResult = {
			ok: false,
			kind: "network",
			status: 0,
			text: "",
			bytes: null,
			contentType: "",
			attempts: 0,
			message: api.messageFor("network"),
		};

		while (attempts <= retries) {
			attempts += 1;
			last = await this.attempt(request, options, attempts);
			if (last.ok || !api.retryable(last.kind)) break;
			if (attempts <= retries) await sleep(api.backoffSeconds(attempts) * 1000);
		}

		if (last.kind !== "none" && this.settings.apiKey) {
			// one line with the classification; the caller decides what the user sees
			console.log("Pollinations:", api.kindName(last.kind), "HTTP", last.status, request.url);
		}
		return last;
	}

	private async attempt(
		request: api.ApiRequest,
		options: SendOptions,
		attempts: number
	): Promise<SendResult> {
		let response: { status: number; headers: Record<string, string>; text: string; arrayBuffer: ArrayBuffer };
		try {
			response = await requestUrl({
				url: request.url,
				method: request.method,
				headers: request.headers,
				body: request.body,
				throw: false,
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
				message: api.messageFor("network") + " (" + String(error) + ")",
			};
		}

		const contentType =
			response.headers["content-type"] ||
			response.headers["Content-Type"] ||
			"";
		const textual = api.isTextual(contentType);
		const text = textual ? response.text : "";
		let bytes: ArrayBuffer | null = null;
		if (options.binary) {
			try {
				bytes = response.arrayBuffer;
			} catch {
				bytes = null;
			}
		}

		const kind = api.classify(
			response.status,
			text,
			false,
			response.status >= 200 && response.status < 300 && options.binary && !bytes
		);
		const detail = api.extractText(text) || text.slice(0, 200);

		return {
			ok: kind === "none",
			kind,
			status: response.status,
			text,
			bytes,
			contentType,
			attempts,
			message: kind === "none" ? "Done." : api.messageFor(kind, response.status, detail),
		};
	}

	/* ------------------------------------------------------------ generations */

	async generateText(prompt: string, model = ""): Promise<{ text: string; model: string; note: string }> {
		const settings = this.settings;
		const useQuickRoute = !model && !settings.systemPrompt;

		const request = useQuickRoute
			? api.buildTextRequest(prompt, { model: model || settings.textModel, seed: -1 }, this.apiKey())
			: api.buildChatRequest(
					prompt,
					{
						model: model || settings.textModel,
						system: settings.systemPrompt,
						temperature: settings.temperature,
						maxTokens: settings.maxTokens,
					},
					this.apiKey()
			  );

		const result = await this.send(request);
		if (!result.ok) throw new PollinationsError(result);
		const answer = api.extractText(result.text).trim();
		if (!answer) throw new PollinationsError(Object.assign({}, result, { kind: "parse" as api.ErrorKind, message: api.messageFor("parse") }));
		const usage = api.extractUsage(result.text);
		return {
			text: answer,
			model: api.extractModel(result.text),
			note: usage && usage.totalTokens > 0 ? usage.totalTokens + " tokens" : "",
		};
	}

	async generateImage(prompt: string): Promise<{ bytes: ArrayBuffer; extension: string }> {
		const settings = this.settings;
		const request = api.buildImageRequest(
			prompt,
			{
				model: settings.imageModel,
				width: settings.imageWidth,
				height: settings.imageHeight,
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
				message: api.messageFor("parse"),
			});
		}
		return { bytes: result.bytes, extension: api.imageExtension(result.contentType, request.url) };
	}

	async fetchModels(modality: api.Modality): Promise<api.ModelInfo[]> {
		const result = await this.send(api.buildModelsRequest(modality), { retries: 1 });
		if (!result.ok) throw new PollinationsError(result);
		return api.parseModels(result.text, modality);
	}

	async profile(apiKey = this.apiKey()): Promise<{ name: string; email: string }> {
		const result = await this.send(api.buildUserInfoRequest(apiKey), { retries: 0 });
		return result.ok ? api.parseUserInfo(result.text) : { name: "", email: "" };
	}
}

class PollinationsError extends Error {
	readonly result: SendResult;

	constructor(result: SendResult) {
		super(result.message || api.messageFor(result.kind));
		this.result = result;
	}
}

/* -------------------------------------------------------------------- plugin */

export default class PollinationsPlugin extends Plugin {
	settings: PollinationsSettings = normalizeSettings({});
	service!: PollinationsService;
	private statusBar!: HTMLElement;
	private activeRequest = 0;

	async onload(): Promise<void> {
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
			editorCallback: (editor, view) => this.generateText(editor, view, false),
		});

		this.addCommand({
			id: "generate-text-from-selection",
			name: "Generate text from the selection",
			editorCallback: (editor, view) => this.generateText(editor, view, true),
		});

		this.addCommand({
			id: "generate-text-review",
			name: "Generate text and review it before inserting",
			editorCallback: (editor, view) => this.generateText(editor, view, false, true),
		});

		this.addCommand({
			id: "generate-image",
			name: "Generate an image and embed it",
			editorCallback: (editor, view) => this.generateImage(editor, view, false),
		});

		this.addCommand({
			id: "generate-image-from-selection",
			name: "Generate an image from the selection",
			editorCallback: (editor, view) => this.generateImage(editor, view, true),
		});

		this.addCommand({
			id: "browse-models",
			name: "Browse the live model list",
			callback: () => new ModelBrowserModal(this).open(),
		});

		this.addCommand({
			id: "sign-in",
			name: "Sign in with a Pollen account",
			callback: () => void this.signIn(),
		});

		this.addCommand({
			id: "fetch-models",
			name: "Test the connection and count the models",
			callback: () => void this.testConnection(),
		});
	}

	onunload(): void {
		this.statusBar.setText("");
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	busy(text: string): number {
		this.activeRequest += 1;
		this.statusBar.setText("Pollinations: " + text);
		return this.activeRequest;
	}

	done(token: number): void {
		if (token === this.activeRequest) this.statusBar.setText("");
	}

	fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		new Notice("Pollinations: " + message, 8000);
		console.error("Pollinations:", error);
	}

	/* -------------------------------------------------------------- commands */

	private activeEditor(): Editor | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view ? view.editor : null;
	}

	private generateFromEditor(kind: "text" | "image"): void {
		const editor = this.activeEditor();
		if (!editor) {
			new Notice("Pollinations: open a note first.");
			return;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (kind === "text") void this.generateText(editor, view ?? null, false);
		else void this.generateImage(editor, view ?? null, false);
	}

	private async askForPrompt(title: string, placeholder: string, initial = ""): Promise<string | null> {
		return new Promise((resolve) => new PromptModal(this.app, title, placeholder, initial, resolve).open());
	}

	private async generateText(
		editor: Editor,
		view: MarkdownFileInfo | null,
		fromSelection: boolean,
		review = false
	): Promise<void> {
		const selection = editor.getSelection();
		let prompt = "";

		if (fromSelection) {
			prompt = fmt.promptFromSelection(selection, this.settings.selectionTemplate);
			if (!prompt) {
				new Notice("Pollinations: select some text first.");
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
				const preview = fmt.insertText(current, from, to, answer.text, mode);
				new ReviewModal(this.app, answer.text, () => {
					editor.setValue(preview.content);
					editor.setCursor(editor.offsetToPos(preview.cursor));
					new Notice("Pollinations: inserted.", 3000);
				}).open();
			} else {
				this.insertIntoEditor(editor, answer.text, mode);
			}
			this.statusBar.setText(answer.note ? "Pollinations: " + answer.note : "");
			window.setTimeout(() => this.statusBar.setText(""), 3000);
		} catch (error) {
			this.fail(error);
		} finally {
			this.done(token);
		}
	}

	private insertIntoEditor(editor: Editor, text: string, mode: PollinationsSettings["insertMode"]): void {
		if (mode === "below") {
			editor.replaceRange("\n" + text + "\n", editor.getCursor("to"));
			return;
		}
		editor.replaceSelection(text);
	}

	private async generateImage(
		editor: Editor | null,
		view: MarkdownFileInfo | null,
		fromSelection: boolean
	): Promise<void> {
		let prompt = "";
		if (fromSelection && editor) {
			prompt = fmt.promptFromSelection(editor.getSelection(), "{{text}}");
			if (!prompt) {
				new Notice("Pollinations: select some text first.");
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
				const link = this.app.fileManager.generateMarkdownLink(file, view?.file?.path ?? file.path);
				editor.replaceRange((editor.getLine(editor.getCursor("to").line) ? "\n\n" : "\n") + link + "\n", editor.getCursor("to"));
			}
			new Notice("Pollinations: saved " + file.path, 5000);
		} catch (error) {
			this.fail(error);
		} finally {
			this.done(token);
		}
	}

	/** Saves the image next to the note, or in the configured folder. */
	async saveImage(prompt: string, bytes: ArrayBuffer, extension: string, view: MarkdownFileInfo | null): Promise<TFile> {
		const folder = this.settings.imageFolder || (view?.file?.parent?.path ?? "");
		const noteFolder = folder === "/" ? "" : folder;
		const taken = this.app.vault
			.getFiles()
			.filter((file) => (file.parent?.path ?? "") === noteFolder)
			.map((file) => file.name);

		const candidate = fmt.uniqueName(fmt.imageFileName(prompt, extension), taken);
		const path = fmt.vaultPath(noteFolder, candidate);
		return this.app.vault.createBinary(path, bytes);
	}

	async testConnection(): Promise<void> {
		const token = this.busy("testing...");
		try {
			const models = await this.service.fetchModels("text");
			new Notice("Pollinations: connected, " + models.length + " text models available.", 5000);
		} catch (error) {
			this.fail(error);
		} finally {
			this.done(token);
		}
	}

	/* ------------------------------------------------------------- device flow */

	private signInRun = 0;

	async signIn(): Promise<void> {
		this.signInRun += 1;
		const run = this.signInRun;

		const token = this.busy("signing in...");
		try {
			const start = await this.service.send(api.buildDeviceCodeRequest(resolveAppKey(this.settings, environment())), {
				retries: 1,
			});
			if (!start.ok) throw new PollinationsError(start);

			const code = api.parseDeviceCode(start.text);
			if (!code) throw new Error("Pollinations did not return a device code.");

			const page = api.verificationUrl(code.verificationUri, code.userCode, false);
			const withCode = api.verificationUrl(code.verificationUri, code.userCode, true);
			new Notice("Pollinations: enter " + code.userCode + " at " + page, 15000);
			if (this.settings.openLinkAfterSignIn) window.open(withCode);

			const modal = new DeviceCodeModal(this.app, code.userCode, withCode, () => {
				this.signInRun += 1; // cancels the loop below
			});
			modal.open();

			let interval = code.interval;
			const deadline = Date.now() + code.expiresIn * 1000;

			while (this.signInRun === run && Date.now() < deadline) {
				await sleep(interval * 1000);
				if (this.signInRun !== run) break;

				const poll = await this.service.send(api.buildDeviceTokenRequest(code.deviceCode), { retries: 1 });
				const state = api.parseDeviceToken(poll.status, poll.text);

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
					new Notice(
						"Pollinations: signed in" + (profile.name ? " as " + profile.name : "") + ". The key is stored in the plugin settings."
					);
					return;
				}
				modal.close();
				new Notice(
					"Pollinations: sign-in " + state.state + (state.detail ? " - " + state.detail : ""),
					8000
				);
				return;
			}

			modal.close();
			if (this.signInRun === run) new Notice("Pollinations: the code expired. Start the sign-in again.", 8000);
		} catch (error) {
			this.fail(error);
		} finally {
			this.done(token);
		}
	}

	async signOut(): Promise<void> {
		this.signInRun += 1;
		this.settings.apiKey = "";
		this.settings.accountName = "";
		await this.saveSettings();
		new Notice("Pollinations: signed out. The key was removed from the plugin settings.");
	}
}

/* -------------------------------------------------------------------- modals */

class PromptModal extends Modal {
	private value: string;
	private readonly done: (value: string | null) => void;

	constructor(app: App, title: string, placeholder: string, initial: string, done: (value: string | null) => void) {
		super(app);
		this.value = initial;
		this.done = done;
		this.titleEl.setText(title);

		new Setting(this.contentEl).addTextArea((area) => {
			area.setPlaceholder(placeholder).setValue(initial).onChange((value) => {
				this.value = value;
			});
			area.inputEl.rows = 5;
			area.inputEl.addClass("pollinations-prompt-input");
			window.setTimeout(() => area.inputEl.focus(), 0);
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Generate").setCta().onClick(() => {
					this.done(this.value);
					this.close();
				})
			)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		if (this.value === null) return;
		this.contentEl.empty();
	}
}

class ReviewModal extends Modal {
	constructor(app: App, text: string, private readonly insert: () => void) {
		super(app);
		this.titleEl.setText("Review the generated text");
		const preview = this.contentEl.createEl("div", { cls: "pollinations-preview" });
		preview.setText(text);

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Insert").setCta().onClick(() => {
					this.insert();
					this.close();
				})
			)
			.addButton((button) =>
				button.setButtonText("Copy").onClick(async () => {
					await navigator.clipboard.writeText(text);
					new Notice("Copied.");
				})
			)
			.addButton((button) => button.setButtonText("Discard").onClick(() => this.close()));
	}
}

class DeviceCodeModal extends Modal {
	constructor(app: App, private readonly code: string, private readonly url: string, private readonly cancel: () => void) {
		super(app);
		this.titleEl.setText("Sign in to Pollinations");
		this.contentEl.createEl("p", {
			text: "Enter this code on the Pollinations page, then approve the request. This window closes by itself.",
		});
		this.contentEl.createEl("div", { text: this.code, cls: "pollinations-code" });

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Open the page").onClick(() => {
					window.open(this.url);
				})
			)
			.addButton((button) =>
				button.setButtonText("Copy the code").onClick(async () => {
					await navigator.clipboard.writeText(this.code);
					new Notice("Copied.");
				})
			)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.cancel();
	}
}

class ModelBrowserModal extends Modal {
	private models: api.ModelInfo[] = [];
	private listEl!: HTMLElement;

	constructor(private readonly plugin: PollinationsPlugin) {
		super(plugin.app);
		this.titleEl.setText("Pollinations models");

		const search = this.contentEl.createEl("input", { type: "text" });
		search.placeholder = "Filter by name or publisher";
		search.addClass("pollinations-filter");
		search.oninput = () => this.render(search.value);

		this.listEl = this.contentEl.createEl("div");

		for (const modality of ["text", "image"] as api.Modality[]) {
			this.plugin.service
				.fetchModels(modality)
				.then((models) => {
					this.models = this.models.concat(models).sort((a, b) => a.id.localeCompare(b.id));
					this.render(search.value);
				})
				.catch((error) => this.plugin.fail(error));
		}
	}

	private render(filter: string): void {
		const needle = filter.trim().toLowerCase();
		this.listEl.empty();
		if (this.models.length === 0) {
			this.listEl.createEl("p", { text: "Loading the live model list..." });
			return;
		}

		const shown = this.models.filter(
			(model) =>
				!needle ||
				model.id.toLowerCase().includes(needle) ||
				model.title.toLowerCase().includes(needle) ||
				model.publisher.toLowerCase().includes(needle)
		);

		for (const model of shown.slice(0, 200)) {
			const row = new Setting(this.listEl).setName(model.title || model.id).setDesc(
				model.id + (model.publisher ? " - " + model.publisher : "") + (model.description ? " - " + model.description : "")
			);
			row.addButton((button) =>
				button.setButtonText(model.category === "image" ? "Use for images" : "Use for text").onClick(async () => {
					if (model.category === "image") this.plugin.settings.imageModel = model.id;
					else this.plugin.settings.textModel = model.id;
					await this.plugin.saveSettings();
					new Notice("Pollinations: " + model.id + " is now the default " + model.category + " model.");
				})
			);
		}
	}
}

/* ------------------------------------------------------------------ settings */

class PollinationsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: PollinationsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Pollinations" });
		containerEl.createEl("p", {
			text: "Generate text and images inside your notes, paying with your own Pollen. Create a key at enter.pollinations.ai/keys, or sign in with a code below.",
		});

		new Setting(containerEl)
			.setName("API key")
			.setDesc(this.plugin.settings.apiKey ? "A key is stored in this plugin's settings." : "No key yet.")
			.addText((text) =>
				text
					.setPlaceholder("sk_...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((button) =>
				button.setButtonText("Sign in with a code").onClick(() => void this.plugin.signIn())
			)
			.addButton((button) => button.setButtonText("Sign out").onClick(() => void this.plugin.signOut()));

		new Setting(containerEl)
			.setName("App key")
			.setDesc(
				"Optional. Your own publishable key (pk_...) from enter.pollinations.ai/keys, so sign-ins are attributed to your Pollinations account. Leave empty to use the default consent screen."
			)
			.addText((text) =>
				text
					.setPlaceholder("pk_...")
					.setValue(this.plugin.settings.appKey)
					.onChange(async (value) => {
						this.plugin.settings.appKey = value.trim();
						await this.plugin.saveSettings();
					})
			);

		if (this.plugin.settings.accountName) {
			containerEl.createEl("p", { text: "Signed in as " + this.plugin.settings.accountName + "." });
		}

		new Setting(containerEl)
			.setName("Test the connection")
			.setDesc("Ask Pollinations for the live model list.")
			.addButton((button) =>
				button.setButtonText("Test").onClick(() => void this.plugin.testConnection())
			);

		containerEl.createEl("h3", { text: "Models" });

		new Setting(containerEl)
			.setName("Text model")
			.setDesc("Leave empty for the quick default (nova-fast). Use the command \"Browse the live model list\" to pick one.")
			.addText((text) =>
				text
					.setPlaceholder(api.DEFAULT_TEXT_MODEL)
					.setValue(this.plugin.settings.textModel)
					.onChange(async (value) => {
						this.plugin.settings.textModel = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image model")
			.setDesc("Leave empty for the quick default. Anything from the live image list works.")
			.addText((text) =>
				text
					.setPlaceholder(api.DEFAULT_IMAGE_MODEL)
					.setValue(this.plugin.settings.imageModel)
					.onChange(async (value) => {
						this.plugin.settings.imageModel = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("Sent with text requests. Leave empty to use the cheaper one-shot text route.")
			.addTextArea((area) => {
				area
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				area.inputEl.rows = 3;
			});

		new Setting(containerEl)
			.setName("Selection template")
			.setDesc("How the selection is sent. {{text}} is replaced with the selected text.")
			.addText((text) =>
				text
					.setPlaceholder("{{text}}")
					.setValue(this.plugin.settings.selectionTemplate)
					.onChange(async (value) => {
						this.plugin.settings.selectionTemplate = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Temperature")
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max tokens")
			.setDesc("0 means no limit.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxTokens)).onChange(async (value) => {
					const number = Number(value);
					this.plugin.settings.maxTokens = isFinite(number) && number > 0 ? Math.round(number) : 0;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h3", { text: "Images" });

		new Setting(containerEl)
			.setName("Image folder")
			.setDesc("Vault folder for generated images. Leave empty to save next to the note.")
			.addText((text) =>
				text
					.setPlaceholder("attachments")
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						this.plugin.settings.imageFolder = value.trim().replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image size")
			.setDesc("Width and height in pixels.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.imageWidth)).onChange(async (value) => {
					this.plugin.settings.imageWidth = normalizeSettings({ imageWidth: Number(value) }).imageWidth;
					await this.plugin.saveSettings();
				})
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.imageHeight)).onChange(async (value) => {
					this.plugin.settings.imageHeight = normalizeSettings({ imageHeight: Number(value) }).imageHeight;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Where generated text goes")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("cursor", "At the cursor")
					.addOption("below", "On a new line below")
					.addOption("replace", "Replacing the selection")
					.setValue(this.plugin.settings.insertMode)
					.onChange(async (value) => {
						this.plugin.settings.insertMode = normalizeSettings({ insertMode: value }).insertMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open the sign-in page in the browser")
			.setDesc("Turn off if you would rather open the link yourself, for example on a phone.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openLinkAfterSignIn).onChange(async (value) => {
					this.plugin.settings.openLinkAfterSignIn = value;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("p", {
			text: "Nothing is generated until you run a command. The plugin sends the prompt to Pollinations and stores the answer in the note; keys stay on this device.",
			cls: "pollinations-progress",
		});
	}
}

/* keep the defaults import used, they document the fallbacks in one place */
export const defaults = DEFAULT_SETTINGS;
