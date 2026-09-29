/**
 * Turning a prompt into note content: names for saved files, templates for the
 * selection, and where the answer lands in the editor. Pure, so it is tested.
 */

import type { InsertMode } from "./settings";

export function applyTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
	);
}

/** A short, file-system safe name drawn from the prompt. */
export function slugify(text: string, maxWords = 6, maxLength = 48): string {
	const words = (text || "")
		.toLowerCase()
		.replace(/[^a-z0-9\s-]+/g, " ")
		.split(/[\s-]+/)
		.filter((word) => word.length > 0)
		.slice(0, maxWords);

	let slug = words.join("-");
	if (slug.length > maxLength) {
		slug = slug.slice(0, maxLength).replace(/-+$/, "");
	}
	return slug || "image";
}

export function timestampName(date = new Date()): string {
	const pad = (value: number, size = 2) => String(value).padStart(size, "0");
	return (
		String(date.getFullYear()) +
		pad(date.getMonth() + 1) +
		pad(date.getDate()) +
		"-" +
		pad(date.getHours()) +
		pad(date.getMinutes()) +
		pad(date.getSeconds())
	);
}

/** `pollinations-a-watermill-20260930-121501.png` */
export function imageFileName(prompt: string, extension: string, date = new Date()): string {
	return "pollinations-" + slugify(prompt) + "-" + timestampName(date) + "." + extension;
}

export function vaultPath(folder: string, name: string): string {
	const clean = (folder || "").replace(/^\/+|\/+$/g, "");
	return clean ? clean + "/" + name : name;
}

/** `name.png`, `name-2.png`, `name-3.png`... */
export function uniqueName(name: string, taken: string[]): string {
	if (!taken.includes(name)) return name;
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	let index = 2;
	while (taken.includes(base + "-" + index + extension)) index += 1;
	return base + "-" + index + extension;
}

export function imageEmbed(path: string, alt: string, width = 0): string {
	const altText = (alt || "").replace(/[\[\]]/g, "").trim();
	const size = width > 0 ? "|" + width : "";
	return "![" + altText + "](" + path + size + ")";
}

/**
 * Where generated text goes. `cursor` writes at the caret, `below` puts it on a
 * new line after the cursor, and `replace` overwrites the selection.
 */
export function insertText(
	content: string,
	from: number,
	to: number,
	text: string,
	mode: InsertMode
): { content: string; cursor: number } {
	const start = Math.max(0, Math.min(from, content.length));
	const end = Math.max(start, Math.min(to, content.length));

	if (mode === "replace") {
		const updated = content.slice(0, start) + text + content.slice(end);
		return { content: updated, cursor: start + text.length };
	}

	if (mode === "below") {
		const prefix = content.slice(0, end);
		const needsNewline = prefix.length > 0 && !prefix.endsWith("\n");
		const block = (needsNewline ? "\n" : "") + text + "\n";
		const updated = content.slice(0, end) + block + content.slice(end).replace(/^\n+/, "");
		return { content: updated, cursor: end + block.length };
	}

	const updated = content.slice(0, start) + text + content.slice(end);
	return { content: updated, cursor: start + text.length };
}

/** What the model should see for a selection: the note's context plus a template. */
export function promptFromSelection(selection: string, template: string): string {
	const trimmed = (selection || "").trim();
	if (!trimmed) return "";
	const rendered = applyTemplate(template, { text: trimmed, prompt: trimmed });
	return rendered.trim();
}
