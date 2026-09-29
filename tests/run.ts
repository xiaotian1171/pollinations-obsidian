/**
 * The offline suite for the pure modules, plus a live check against the real API.
 *
 *   node build/tests.js          # offline: no network, no key
 *   node build/tests.js --live   # also talk to Pollinations
 *
 * The live part needs POLLINATIONS_API_KEY for the signed steps and accepts
 * POLLINATIONS_APP_KEY for the device-flow attribution step.
 */

import * as api from "../src/api";
import * as fmt from "../src/format";
import { DEFAULT_SETTINGS, normalizeSettings, resolveApiKey, resolveAppKey } from "../src/settings";

let passed = 0;
let failed = 0;
function group(name: string): void {
	console.log("\n-- " + name);
}

function ok(condition: boolean, message: string): void {
	if (condition) {
		passed += 1;
		console.log("   ok   " + message);
	} else {
		failed += 1;
		console.log("   FAIL " + message);
	}
}

function equal(actual: unknown, expected: unknown, message: string): void {
	const same = JSON.stringify(actual) === JSON.stringify(expected);
	ok(same, message + (same ? "" : " (got " + JSON.stringify(actual) + ", wanted " + JSON.stringify(expected) + ")"));
}

function contains(haystack: string, needle: string, message: string): void {
	ok(haystack.includes(needle), message + (haystack.includes(needle) ? "" : " (in " + JSON.stringify(haystack) + ")"));
}

/* ------------------------------------------------------------------- urls */

group("urls and requests");
{
	const chat = api.buildChatRequest("hello world", { model: "nova-fast", temperature: 0.5, maxTokens: 100 }, "sk_test");
	equal(chat.url, "https://gen.pollinations.ai/v1/chat/completions", "chat goes to the completions endpoint");
	equal(chat.method, "POST", "chat is a POST");
	equal(chat.headers["Authorization"], "Bearer sk_test", "chat carries the key");
	equal(chat.headers["Content-Type"], "application/json", "chat declares JSON");
	equal(JSON.parse(chat.body ?? "{}").messages[0].content, "hello world", "chat sends the prompt as a user message");
	equal(JSON.parse(chat.body ?? "{}").max_tokens, 100, "chat sends max tokens");
	ok(!("seed" in JSON.parse(chat.body ?? "{}")), "a negative seed is dropped");

	const withSystem = api.buildChatRequest("hi", { system: "be brief" });
	equal(JSON.parse(withSystem.body ?? "{}").messages.length, 2, "a system prompt comes first");
	equal(JSON.parse(withSystem.body ?? "{}").messages[0].role, "system", "the first message is the system one");
	equal(withSystem.headers["Authorization"], undefined, "no key, no header");

	const json = api.buildChatRequest("give me JSON", { json: true });
	equal(JSON.parse(json.body ?? "{}").response_format.type, "json_object", "JSON mode is passed through");

	const text = api.buildTextRequest("a b&c?", { model: "nova-fast", seed: 7 }, "sk_x");
	contains(text.url, "/text/a%20b%26c%3F", "the prompt is escaped in the path");
	contains(text.url, "model=nova-fast", "the text route carries the model");
	contains(text.url, "seed=7", "the text route carries the seed");
	equal(text.method, "GET", "the text route is a GET");

	const image = api.buildImageRequest("a watermill", { width: 1024, height: 512, model: "z-image", nologo: true });
	contains(image.url, "/image/a%20watermill", "the image route escapes the prompt");
	contains(image.url, "width=1024", "the image route carries the width");
	contains(image.url, "height=512", "the image route carries the height");
	contains(image.url, "nologo=true", "the image route can drop the logo");
	ok(!image.url.includes("safe="), "unset options are left out");

	equal(api.buildModelsRequest("image").url, "https://gen.pollinations.ai/image/models", "image models endpoint");
	equal(api.buildModelsRequest("embeddings").url, "https://gen.pollinations.ai/embeddings/models", "embeddings models endpoint");

	const code = api.buildDeviceCodeRequest("pk_app");
	equal(code.url, "https://enter.pollinations.ai/api/device/code", "the device code endpoint");
	equal(JSON.parse(code.body ?? "{}").client_id, "pk_app", "the app key is the client id");
	equal(JSON.parse(api.buildDeviceCodeRequest("").body ?? "{}").client_id, undefined, "no app key, no client id");
	equal(JSON.parse(api.buildDeviceTokenRequest("dev-1").body ?? "{}").device_code, "dev-1", "the token request carries the code");
	equal(api.buildUserInfoRequest("sk_x").headers["Authorization"], "Bearer sk_x", "userinfo is signed");

	equal(api.verificationUrl("/device", "ABCD", false), "https://enter.pollinations.ai/device", "a relative uri becomes absolute");
	equal(api.verificationUrl("/device", "ABCD", true), "https://enter.pollinations.ai/device?user_code=ABCD", "the code can be pre-filled");
	equal(api.verificationUrl("https://example.com/x", "AB CD", true), "https://example.com/x?user_code=AB%20CD", "an absolute uri is kept");
}

/* ---------------------------------------------------------------- failures */

group("error classification");
{
	equal(api.classify(401, ""), "auth", "401 is an auth failure");
	equal(api.classify(403, ""), "auth", "403 is an auth failure");
	equal(api.classify(402, "Insufficient balance"), "balance", "402 is a balance failure");
	equal(api.classify(200, "This key is out of pollen"), "balance", "a 200 that mentions pollen is still a balance failure");
	equal(api.classify(429, ""), "rate_limit", "429 is a rate limit");
	equal(api.classify(400, ""), "bad_request", "400 is a bad request");
	equal(api.classify(404, ""), "bad_request", "404 is a bad request");
	equal(api.classify(503, ""), "server", "503 is a server failure");
	equal(api.classify(500, ""), "server", "500 is a server failure");
	equal(api.classify(200, "hello"), "none", "a plain 200 is a success");
	equal(api.classify(200, "{}", false, true), "parse", "a 200 that cannot be parsed is a parse failure");
	equal(api.classify(0, "", true), "network", "a transport failure is a network failure");
	equal(api.classify(0, ""), "network", "status 0 is a network failure");
	equal(api.classify(418, ""), "unknown", "an unusual status is unknown");

	ok(api.mentionsBalance("Insufficient balance. This request costs ~0.0136 pollen"), "the balance wording is recognised");
	ok(api.mentionsBalance("insufficient_balance"), "the snake case wording is recognised");
	ok(!api.mentionsBalance("hello"), "a normal body is not a balance failure");

	ok(api.retryable("rate_limit"), "rate limits are retried");
	ok(api.retryable("server"), "server failures are retried");
	ok(api.retryable("network"), "network failures are retried");
	ok(!api.retryable("auth"), "auth failures are not retried");
	ok(!api.retryable("balance"), "balance failures are not retried");
	ok(!api.retryable("bad_request"), "bad requests are not retried");

	equal(api.backoffSeconds(1), 0.75, "the first wait is 0.75s");
	equal(api.backoffSeconds(2), 1.5, "the second wait doubles");
	equal(api.backoffSeconds(3), 3, "the third wait doubles again");
	equal(api.backoffSeconds(9), 8, "the wait is capped at 8s");

	const kinds: api.ErrorKind[] = ["none", "auth", "balance", "rate_limit", "bad_request", "server", "network", "parse"];
	const messages = new Set(kinds.map((kind) => api.messageFor(kind, 500)));
	equal(messages.size, kinds.length, "every failure kind has its own sentence");
	for (const kind of kinds.filter((kind) => kind !== "none")) {
		ok(api.messageFor(kind, 500).length > 10, kind + " has a usable message");
	}
	equal(api.messageFor("none"), "Done.", "success is a plain word, not an explanation");
	equal(api.messageFor("none"), "Done.", "success needs no explanation");
	equal(api.kindName("none"), "success", "success is named");
	equal(api.kindName("rate_limit"), "rate limit", "the underscore is readable");
}

/* ----------------------------------------------------------------- reading */

group("reading answers");
{
	const chat = JSON.stringify({ choices: [{ message: { role: "assistant", content: "A watermill." } }] });
	equal(api.extractText(chat), "A watermill.", "the chat answer is read from choices");
	equal(api.extractText('"just a string"'), "just a string", "a bare JSON string is the answer");
	equal(api.extractText(JSON.stringify({ text: "from text" })), "from text", "the text field is read");
	equal(api.extractText(JSON.stringify({ content: "from content" })), "from content", "the content field is read");
	equal(
		api.extractText(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "part A" }, { type: "text", text: " part B" }] } }] })),
		"part A part B",
		"a list of parts is joined"
	);
	equal(
		api.extractText(JSON.stringify({ choices: [{ message: { content: { content: "nested" } } }] })),
		"nested",
		"a nested content object is unwrapped"
	);
	equal(api.extractText("not json at all"), "", "a body that is not JSON yields nothing");
	equal(api.extractText(JSON.stringify({ choices: [] })), "", "an empty choice list yields nothing");
	equal(api.extractText(JSON.stringify({ output_text: "from output" })), "from output", "the output_text fallback works");

	const usage = api.extractUsage(
		JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 28, total_tokens: 40, prompt_tokens_details: { cached_tokens: 3 } } })
	);
	equal(usage?.totalTokens, 40, "total tokens are read");
	equal(usage?.cachedTokens, 3, "cached tokens are read");
	equal(api.extractUsage("{}"), null, "no usage means no usage");

	equal(api.extractModel(JSON.stringify({ model: "us.amazon.nova-micro-v1:0" })), "us.amazon.nova-micro-v1:0", "the model is read");
	equal(api.extractModel(JSON.stringify({ choices: [{ model: "other" }] })), "other", "a model on the choice is read");
	equal(api.extractModel("{}"), "", "no model is empty");
}

/* ------------------------------------------------------------------ models */

group("model lists");
{
	const list = api.parseModels(
		JSON.stringify([
			{
				name: "openai/gpt-5.4-nano",
				aliases: ["gpt-5.4-nano", "openai"],
				category: "text",
				publisher: "OpenAI",
				title: "GPT-5.4 Nano",
				description: "Fast all-rounder",
				supported_endpoints: ["/v1/chat/completions", "/text/{prompt}"],
			},
			{ name: "nova-fast", category: "text" },
			{ id: "legacy-id" },
			{ name: "openai/gpt-5.4-nano", category: "text" },
			{ not: "a model" },
		])
	);
	equal(list.length, 3, "duplicates and entries without a name are dropped");
	equal(list[0].id, "openai/gpt-5.4-nano", "the name field is the id");
	equal(list[0].title, "GPT-5.4 Nano", "the title is kept");
	equal(list[1].title, "nova-fast", "a missing title falls back to the id");
	equal(list[2].id, "legacy-id", "an id field works too");
	equal(list[0].aliases, ["gpt-5.4-nano", "openai"], "aliases are kept");
	equal(api.modelIds(list).length, 3, "ids are listed");

	const envelope = api.parseModels(JSON.stringify({ data: [{ name: "a" }, { name: "b" }] }), "image");
	equal(envelope.length, 2, "the data envelope is read");
	equal(envelope[0].category, "image", "the modality is the fallback category");

	const categories = api.parseModels(JSON.stringify({ categories: [{ models: [{ name: "c" }] }, { models: [{ name: "d" }] }] }));
	equal(api.modelIds(categories), ["c", "d"], "the categories envelope is read");
	equal(api.parseModels("").length, 0, "an empty body yields no models");
	equal(api.parseModels("nonsense").length, 0, "a non JSON body yields no models");

	const chatOnly = api.modelsSupporting(list, "/v1/chat/completions");
	equal(api.modelIds(chatOnly), ["openai/gpt-5.4-nano", "nova-fast", "legacy-id"], "a model without endpoints is assumed to work");
	const textOnly = api.modelsSupporting(api.parseModels(JSON.stringify([{ name: "x", supported_endpoints: ["/image/{prompt}"] }])), "/v1/chat/completions");
	equal(textOnly.length, 0, "an incompatible endpoint is filtered out");

	ok(api.hasModel(list, "openai/gpt-5.4-nano"), "a model is found by id");
	ok(api.hasModel(list, "gpt-5.4-nano"), "a model is found by alias");
	ok(!api.hasModel(list, "nope"), "an unknown model is not found");
	equal(api.findModel(list, "gpt-5.4-nano")?.id, "openai/gpt-5.4-nano", "find resolves an alias");
	equal(api.findModel(list, ""), null, "an empty id finds nothing");
}

/* ------------------------------------------------------------- device flow */

group("device flow");
{
	const code = api.parseDeviceCode(
		JSON.stringify({ device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "/device", interval: 5, expires_in: 1800 })
	);
	equal(code?.deviceCode, "dev-1", "the device code is read");
	equal(code?.userCode, "ABCD-1234", "the user code is read");
	equal(code?.verificationUri, "/device", "the verification uri is read");
	equal(code?.interval, 5, "the interval is read");
	equal(code?.expiresIn, 1800, "the expiry is read");
	equal(api.parseDeviceCode(JSON.stringify({ verification_url: "https://x/y", device_code: "d", user_code: "u" }))?.verificationUri, "https://x/y", "the url spelling works");
	equal(api.parseDeviceCode(JSON.stringify({ verification_uri: "/device", interval: 0.2 })), null, "a code is required");
	equal(api.parseDeviceCode(JSON.stringify({ verification_uri: "/device", device_code: "d" })), null, "a user code is required");
	equal(api.parseDeviceCode(JSON.stringify({ device_code: "d", user_code: "u", interval: 0 }))?.interval, 1, "the interval has a floor of 1s");
	equal(api.parseDeviceCode(JSON.stringify({ device_code: "d", user_code: "u" }))?.expiresIn, 900, "a missing expiry gets a default");

	equal(api.parseDeviceToken(400, JSON.stringify({ error: "authorization_pending" })).state, "pending", "HTTP 400 with pending is pending");
	equal(api.parseDeviceToken(200, JSON.stringify({ error: "authorization_pending" })).state, "pending", "pending is pending");
	equal(api.parseDeviceToken(428, "{}").state, "pending", "428 is pending");
	equal(api.parseDeviceToken(400, JSON.stringify({ error: "slow_down", interval: 10 })).interval, 10, "slow_down carries a new interval");
	equal(api.parseDeviceToken(400, JSON.stringify({ error: "slow_down" })).interval, 5, "slow_down without an interval uses 5s");
	equal(api.parseDeviceToken(200, JSON.stringify({ access_token: "sk_new" })).apiKey, "sk_new", "a granted poll returns the key");
	equal(api.parseDeviceToken(200, JSON.stringify({ access_token: "sk_new" })).state, "granted", "granted state");
	equal(api.parseDeviceToken(400, JSON.stringify({ error: "expired_token" })).state, "expired", "expired state");
	equal(api.parseDeviceToken(400, JSON.stringify({ error: "access_denied" })).state, "denied", "denied state");
	equal(api.parseDeviceToken(500, "boom").state, "error", "anything else is an error");
	equal(api.parseDeviceToken(400, JSON.stringify({ error: "authorization_pending", error_description: "not yet" })).detail, "not yet", "the description is kept");

	equal(api.parseUserInfo(JSON.stringify({ name: "ada", email: "a@b.c" })).name, "ada", "the profile name is read");
	equal(api.parseUserInfo(JSON.stringify({ username: "ada" })).name, "ada", "the username field works");
	equal(api.parseUserInfo("{}").name, "", "an empty profile is empty");
}

/* ------------------------------------------------------------------ bodies */

group("bodies and file names");
{
	ok(api.isTextual("application/json"), "JSON is text");
	ok(api.isTextual(""), "a missing content type is treated as text");
	ok(!api.isTextual("image/jpeg"), "an image is not text");
	ok(!api.isTextual("audio/mpeg"), "audio is not text");
	ok(!api.isTextual("application/octet-stream"), "an octet stream is not text");

	equal(api.imageExtension("image/jpeg"), "jpg", "jpeg becomes jpg");
	equal(api.imageExtension("image/png; charset=binary"), "png", "png is detected with a parameter");
	equal(api.imageExtension("image/webp"), "webp", "webp is kept");
	equal(api.imageExtension("", "https://gen.pollinations.ai/image/x.png?seed=1"), "png", "the extension can come from the url");
	equal(api.imageExtension(""), "jpg", "the default is jpg");

	const date = new Date(2026, 8, 30, 12, 15, 1);
	equal(fmt.imageFileName("A wooden watermill!", "png", date), "pollinations-a-wooden-watermill-20260930-121501.png", "the file name is readable and safe");
	equal(fmt.imageFileName("你好世界", "png", date), "pollinations-image-20260930-121501.png", "a prompt with no latin words still gets a name");
	equal(fmt.imageFileName("a b c d e f g h", "png", date), "pollinations-a-b-c-d-e-f-20260930-121501.png", "the name is capped by words");
	equal(fmt.slugify("  ---  "), "image", "a slug never comes out empty");
	equal(fmt.slugify("x".repeat(80)).length <= 48, true, "a slug is capped in length");

	equal(fmt.uniqueName("a.png", []), "a.png", "a free name is kept");
	equal(fmt.uniqueName("a.png", ["a.png"]), "a-2.png", "a taken name gets a number");
	equal(fmt.uniqueName("a.png", ["a.png", "a-2.png"]), "a-3.png", "the next free number is found");
	equal(fmt.vaultPath("", "a.png"), "a.png", "an empty folder means the vault root");
	equal(fmt.vaultPath("attachments", "a.png"), "attachments/a.png", "a folder is joined");

	equal(fmt.applyTemplate("{{text}} and {{other}}", { text: "T" }), "T and {{other}}", "known placeholders are replaced");
	equal(fmt.applyTemplate("Summarise: {{ text }}", { text: "T" }), "Summarise: T", "spaces inside the placeholder are fine");
	equal(fmt.promptFromSelection("  hi  ", "{{text}}"), "hi", "a selection is trimmed");
	equal(fmt.promptFromSelection("hi", "Explain {{text}} simply"), "Explain hi simply", "a template can wrap the selection");
	equal(fmt.promptFromSelection("   ", "{{text}}"), "", "an empty selection means no prompt");

	equal(fmt.imageEmbed("a.png", "alt", 0), "![alt](a.png)", "an embed without a size");
	equal(fmt.imageEmbed("attachments/a b.png", "a [b]", 300), "![a b](attachments/a b.png|300)", "the alt text is cleaned and the size added");
}

/* ---------------------------------------------------------- editor inserts */

group("where the answer lands");
{
	const note = "line one\nline two";

	const atCursor = fmt.insertText(note, 4, 4, "X", "cursor");
	equal(atCursor.content, "lineX one\nline two", "cursor mode writes at the caret");
	equal(atCursor.cursor, 5, "the cursor moves past the insert");

	const replacing = fmt.insertText(note, 0, 8, "replaced", "replace");
	equal(replacing.content, "replaced\nline two", "replace mode overwrites exactly the selection");

	const below = fmt.insertText(note, 8, 8, "answer", "below");
	equal(below.content, "line one\nanswer\nline two", "below mode starts a new line after the selection");
	equal(
		fmt.insertText(note, 0, 4, "answer", "below").content,
		"line\nanswer\n one\nline two",
		"inserting in the middle of a line leaves the rest of the line alone"
	);

	const belowAtEnd = fmt.insertText("abc", 3, 3, "answer", "below");
	equal(belowAtEnd.content, "abc\nanswer\n", "below mode at the end of the note adds the newline it needs");

	const clamped = fmt.insertText(note, -5, 999, "X", "cursor");
	ok(clamped.content.includes("X"), "out of range offsets are clamped");
}

/* ---------------------------------------------------------------- settings */

group("settings");
{
	const defaults = normalizeSettings(undefined);
	equal(defaults.textModel, "", "the text model defaults to empty, meaning the API default");
	equal(defaults.imageWidth, 1024, "the default image width");
	equal(defaults.insertMode, "cursor", "text lands at the cursor by default");
	equal(defaults.selectionTemplate, DEFAULT_SETTINGS.selectionTemplate, "the default template is used");

	const repaired = normalizeSettings({
		apiKey: "  sk_key  ",
		imageWidth: 99999,
		imageHeight: 1,
		temperature: 9,
		insertMode: "nowhere",
		maxTokens: -4,
		imageFolder: "/attachments/images/",
		selectionTemplate: "",
	});
	equal(repaired.apiKey, "sk_key", "the key is trimmed");
	equal(repaired.imageWidth, 4096, "an oversized width is clamped");
	equal(repaired.imageHeight, 64, "a tiny height is clamped");
	equal(repaired.temperature, 2, "the temperature is clamped");
	equal(repaired.insertMode, "cursor", "an unknown insert mode falls back");
	equal(repaired.maxTokens, 0, "a negative token limit becomes zero");
	equal(repaired.imageFolder, "attachments/images", "slashes are trimmed from the folder");
	equal(repaired.selectionTemplate, DEFAULT_SETTINGS.selectionTemplate, "an empty template falls back");

	const partial = normalizeSettings({ apiKey: "sk_a", insertMode: "below" });
	equal(partial.insertMode, "below", "a valid insert mode is kept");
	equal(partial.imageWidth, 1024, "missing values keep their defaults");

	equal(resolveApiKey(normalizeSettings({ apiKey: "sk_setting" }), { POLLINATIONS_API_KEY: "sk_env" }), "sk_setting", "the setting wins over the environment");
	equal(resolveApiKey(normalizeSettings({}), { POLLINATIONS_API_KEY: "sk_env" }), "sk_env", "the environment is the fallback");
	equal(resolveApiKey(normalizeSettings({}), {}), "", "no key anywhere is empty");
	equal(resolveAppKey(normalizeSettings({ appKey: "pk_setting" }), { POLLINATIONS_APP_KEY: "pk_env" }), "pk_setting", "the app key setting wins");
	equal(resolveAppKey(normalizeSettings({}), {}), "", "an unknown app key is empty");
}

/* ----------------------------------------------------------------- live */

async function live(): Promise<void> {
	const key = process.env.POLLINATIONS_API_KEY ?? "";
	const appKey = process.env.POLLINATIONS_APP_KEY ?? "";
	let failing = 0;

	async function send(request: api.ApiRequest, binary = false): Promise<{ status: number; text: string; contentType: string; bytes: number }> {
		const started = Date.now();
		const response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
		const contentType = response.headers.get("content-type") ?? "";
		const buffer = Buffer.from(await response.arrayBuffer());
		const text = api.isTextual(contentType) ? buffer.toString("utf8") : "";
		console.log(
			"   " +
				request.method +
				" " +
				request.url.split("?")[0].replace(api.GEN_BASE, "").replace(api.ENTER_BASE, "") +
				" -> " +
				response.status +
				" in " +
				((Date.now() - started) / 1000).toFixed(2) +
				"s" +
				(contentType ? " " + contentType : "") +
				(!binary && text ? " " + text.slice(0, 160).replace(/\n/g, " ") : "")
		);
		return { status: response.status, text, contentType, bytes: buffer.length };
	}

	function expect(condition: boolean, message: string): void {
		if (condition) {
			passed += 1;
			console.log("   ok   " + message);
		} else {
			failing += 1;
			failed += 1;
			console.log("   FAIL " + message);
		}
	}

	group("live: text and models");
	{
		const prompt = await send(api.buildTextRequest("Say hello in three words.", {}, key));
		expect(prompt.status === 200 && prompt.text.length > 0, "the prompt route answers 200 with text");

		const chat = await send(api.buildChatRequest("Name a village in one word.", { model: "nova-fast" }, key));
		const answer = api.extractText(chat.text);
		const usage = api.extractUsage(chat.text);
		const model = api.extractModel(chat.text);
		console.log("   answer: " + JSON.stringify(answer.slice(0, 80)) + " model=" + model + " usage=" + JSON.stringify(usage));
		expect(chat.status === 200 && answer.length > 0, "chat answers and the answer is extracted");
		expect(model.length > 0, "the serving model is reported");

		const textModels = await send(api.buildModelsRequest("text"));
		const parsedText = api.parseModels(textModels.text, "text");
		const imageModels = await send(api.buildModelsRequest("image"));
		const parsedImage = api.parseModels(imageModels.text, "image");
		console.log("   text models: " + parsedText.length + ", image models: " + parsedImage.length);
		expect(parsedText.length > 0 && parsedImage.length > 0, "the live model lists are read");
		expect(api.hasModel(parsedText, "nova-fast"), "the default text model is in the live list");
		const chatOnly = api.modelsSupporting(parsedText, "/v1/chat/completions");
		expect(chatOnly.length > 0 && chatOnly.length <= parsedText.length, "the endpoint filter works on real data");
	}

	group("live: image");
	{
		const image = await send(api.buildImageRequest("a wooden watermill, flat illustration", { width: 256, height: 256 }, key), true);
		const extension = api.imageExtension(image.contentType);
		console.log("   bytes=" + image.bytes + " extension=" + extension);
		expect(image.status === 200 && image.bytes > 1000, "the image route returned bytes");
		expect(api.isTextual(image.contentType) === false, "the image body is not treated as text");
		expect(["png", "jpg", "webp", "gif", "avif"].includes(extension), "the image extension is recognised");
	}

	group("live: device flow");
	{
		const start = await send(api.buildDeviceCodeRequest(appKey));
		const code = api.parseDeviceCode(start.text);
		console.log("   user_code=" + (code?.userCode ?? "-") + " interval=" + (code?.interval ?? "-") + " expires_in=" + (code?.expiresIn ?? "-"));
		expect(start.status === 200 && code !== null, "a device code is issued");

		if (code) {
			const poll = await send(api.buildDeviceTokenRequest(code.deviceCode));
			const state = api.parseDeviceToken(poll.status, poll.text);
			console.log("   poll state=" + state.state + " detail=" + state.detail);
			expect(state.state === "pending" || state.state === "slow_down", "an unapproved poll is pending, not an error");
		}
	}

	group("live: speech is a paid model");
	{
		const response = await fetch(api.GEN_BASE + "/v1/audio/speech", {
			method: "POST",
			headers: Object.assign({ "Content-Type": "application/json" }, api.authHeaders(key)),
			body: JSON.stringify({ input: "hello", voice: "alloy", response_format: "wav" }),
		});
		const body = await response.text();
		const kind = api.classify(response.status, body);
		console.log("   speech -> " + response.status + " kind=" + kind + " " + body.slice(0, 120));
		expect(
			kind === "none" || kind === "balance",
			"speech either worked or reported a balance failure (a free account cannot pay for it)"
		);
	}

	console.log("\n=== live check finished: " + failing + " failing step(s)");
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
	console.log("Pollinations for Obsidian - test suite");
	if (process.argv.includes("--live") || process.env.POLLINATIONS_LIVE) {
		await live();
	}
	console.log("\ntotal: " + passed + " passed, " + failed + " failed");
	if (failed > 0) process.exit(1);
}

void main();
