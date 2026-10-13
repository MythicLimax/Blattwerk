import { createRequire } from "node:module";
import { init } from "@embedpdf/pdfium";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
//#region src/shared/annotations.ts
const STAMP_STYLES = {
	approved: { color: {
		r: .13,
		g: .55,
		b: .13
	} },
	reviewed: { color: {
		r: .13,
		g: .55,
		b: .13
	} },
	final: { color: {
		r: .13,
		g: .55,
		b: .13
	} },
	rejected: { color: {
		r: .8,
		g: .1,
		b: .1
	} },
	confidential: { color: {
		r: .8,
		g: .1,
		b: .1
	} },
	draft: { color: {
		r: .15,
		g: .3,
		b: .75
	} },
	forComment: { color: {
		r: .15,
		g: .3,
		b: .75
	} }
};
function toPdfDate(date) {
	const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${sign}${pad(offset / 60)}'${pad(offset % 60)}'`;
}
//#endregion
//#region src/workers/pdfium/memory.ts
function withBuffer(m, size, fn) {
	const ptr = m.pdfium.wasmExports.malloc(size);
	if (!ptr) throw new Error("PDFium: kein Speicher");
	try {
		return fn(ptr);
	} finally {
		m.pdfium.wasmExports.free(ptr);
	}
}
function withWString(m, value, fn) {
	const size = (value.length + 1) * 2;
	return withBuffer(m, size, (ptr) => {
		m.pdfium.stringToUTF16(value, ptr, size);
		return fn(ptr);
	});
}
function withFloats(m, values, fn) {
	return withBuffer(m, Math.max(4, values.length * 4), (ptr) => {
		values.forEach((value, i) => m.pdfium.setValue(ptr + i * 4, value, "float"));
		return fn(ptr);
	});
}
function copyOut(m, ptr, size) {
	return m.pdfium.HEAPU8.slice(ptr, ptr + size);
}
//#endregion
//#region src/shared/pages.ts
const A4 = {
	width: 595.28,
	height: 841.89
};
//#endregion
//#region src/shared/image-info.ts
function readPng(bytes) {
	if (bytes.length < 24 || [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	].some((b, i) => bytes[i] !== b)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	return width > 0 && height > 0 ? {
		kind: "png",
		width,
		height,
		rotation: 0
	} : null;
}
function exifRotation(view, start, length) {
	if (length < 14 || view.getUint32(start) !== 1165519206) return 0;
	const tiff = start + 6;
	const little = view.getUint16(tiff) === 18761;
	const u16 = (offset) => view.getUint16(offset, little);
	const u32 = (offset) => view.getUint32(offset, little);
	const ifd = tiff + u32(tiff + 4);
	if (ifd + 2 > start + length) return 0;
	const entries = u16(ifd);
	for (let i = 0; i < entries; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > start + length) break;
		if (u16(entry) === 274) {
			const value = u16(entry + 8);
			return value === 3 ? 180 : value === 6 ? 90 : value === 8 ? 270 : 0;
		}
	}
	return 0;
}
function readJpeg(bytes) {
	if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let rotation = 0;
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 255) return null;
		const marker = bytes[offset + 1];
		if (marker === 255) {
			offset++;
			continue;
		}
		const length = view.getUint16(offset + 2);
		if (marker === 225) rotation = exifRotation(view, offset + 4, length - 2);
		if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
			if (offset + 9 > bytes.length) return null;
			const height = view.getUint16(offset + 5);
			const width = view.getUint16(offset + 7);
			return width > 0 && height > 0 ? {
				kind: "jpeg",
				width,
				height,
				rotation
			} : null;
		}
		offset += 2 + length;
	}
	return null;
}
function readImageInfo(bytes) {
	return readPng(bytes) ?? readJpeg(bytes);
}
function imagePageLayout(info) {
	const turned = info.rotation === 90 || info.rotation === 270;
	const shownWidth = turned ? info.height : info.width;
	const shownHeight = turned ? info.width : info.height;
	const landscape = shownWidth > shownHeight;
	const maxWidth = landscape ? A4.height : A4.width;
	const maxHeight = landscape ? A4.width : A4.height;
	const scale = Math.min(1, maxWidth / shownWidth, maxHeight / shownHeight);
	const width = Math.round(shownWidth * scale * 100) / 100;
	const height = Math.round(shownHeight * scale * 100) / 100;
	switch (info.rotation) {
		case 90: return {
			width,
			height,
			matrix: [
				0,
				-height,
				width,
				0,
				0,
				height
			]
		};
		case 180: return {
			width,
			height,
			matrix: [
				-width,
				0,
				0,
				-height,
				width,
				height
			]
		};
		case 270: return {
			width,
			height,
			matrix: [
				0,
				height,
				-width,
				0,
				width,
				0
			]
		};
		default: return {
			width,
			height,
			matrix: [
				width,
				0,
				0,
				height,
				0,
				0
			]
		};
	}
}
//#endregion
//#region src/workers/pdfium/pages.ts
const ERR_PASSWORD = 4;
var PageOperationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "PageOperationError";
	}
};
var Allocations = class {
	#m;
	#ptrs = [];
	#docs = [];
	constructor(m) {
		this.#m = m;
	}
	copy(data) {
		const ptr = this.#m.pdfium.wasmExports.malloc(Math.max(1, data.length));
		if (!ptr) throw new Error("PDFium: kein Speicher");
		this.#m.pdfium.HEAPU8.set(data, ptr);
		this.#ptrs.push(ptr);
		return ptr;
	}
	ints(values) {
		const ptr = this.#m.pdfium.wasmExports.malloc(Math.max(4, values.length * 4));
		if (!ptr) throw new Error("PDFium: kein Speicher");
		values.forEach((value, i) => this.#m.pdfium.setValue(ptr + i * 4, value, "i32"));
		this.#ptrs.push(ptr);
		return ptr;
	}
	openDocument(source) {
		const data = new Uint8Array(source.data);
		const ptr = this.copy(data);
		const doc = this.#m.FPDF_LoadMemDocument(ptr, data.length, source.password ?? "");
		if (!doc) {
			const error = this.#m.FPDF_GetLastError();
			throw error === ERR_PASSWORD ? new PageOperationError("password", "Kennwort für das Quelldokument fehlt oder ist falsch") : new PageOperationError("invalid", `Quelldokument lässt sich nicht öffnen (Fehler ${error})`);
		}
		this.#docs.push(doc);
		return doc;
	}
	release() {
		for (const doc of this.#docs.splice(0)) this.#m.FPDF_CloseDocument(doc);
		for (const ptr of this.#ptrs.splice(0)) this.#m.pdfium.wasmExports.free(ptr);
	}
};
function checkPages(pages, pageCount, keepOrder = false) {
	const unique = [...new Set(pages)];
	if (unique.length === 0 || unique.some((p) => !Number.isInteger(p) || p < 0 || p >= pageCount)) throw new PageOperationError("range", `Ungültige Seiten: ${pages.join(", ")}`);
	return keepOrder ? unique : unique.sort((a, b) => a - b);
}
function checkPosition(at, pageCount) {
	if (!Number.isInteger(at) || at < 0 || at > pageCount) throw new PageOperationError("range", `Ungültige Position: ${at}`);
	return at;
}
function insertImage(m, doc, at, image, memory) {
	const layout = imagePageLayout(image);
	const page = m.FPDFPage_New(doc, at, layout.width, layout.height);
	if (!page) throw new PageOperationError("image", "Neue Seite für das Bild lässt sich nicht anlegen");
	try {
		const object = m.FPDFPageObj_NewImageObj(doc);
		const data = new Uint8Array(image.data);
		const ptr = memory.copy(data);
		if (!(image.kind === "jpeg" ? m.EPDFImageObj_SetJpeg(0, 0, object, ptr, data.length) : m.EPDFImageObj_SetPng(0, 0, object, ptr, data.length))) {
			m.FPDFPageObj_Destroy(object);
			throw new PageOperationError("image", "Bild lässt sich nicht einbetten");
		}
		const [a, b, c, d, e, f] = layout.matrix;
		m.FPDFImageObj_SetMatrix(object, a, b, c, d, e, f);
		m.FPDFPage_InsertObject(page, object);
		if (!m.FPDFPage_GenerateContent(page)) throw new PageOperationError("image", "Seiteninhalt lässt sich nicht erzeugen");
	} finally {
		m.FPDF_ClosePage(page);
	}
}
function applyPageOperation(m, doc, op, memory) {
	const pageCount = m.FPDF_GetPageCount(doc);
	switch (op.type) {
		case "rotate": {
			const steps = op.delta / 90;
			for (const index of checkPages(op.pages, pageCount)) {
				const page = m.FPDF_LoadPage(doc, index);
				if (!page) throw new PageOperationError("range", `Seite ${index + 1} lässt sich nicht laden`);
				try {
					m.FPDFPage_SetRotation(page, (m.FPDFPage_GetRotation(page) + steps) % 4);
				} finally {
					m.FPDF_ClosePage(page);
				}
			}
			return;
		}
		case "delete": {
			const pages = checkPages(op.pages, pageCount);
			if (pages.length >= pageCount) throw new PageOperationError("all-pages", "Mindestens eine Seite muss bleiben");
			for (const index of pages.reverse()) m.FPDFPage_Delete(doc, index);
			return;
		}
		case "move": {
			const pages = checkPages(op.pages, pageCount);
			const to = op.to;
			if (!Number.isInteger(to) || to < 0 || to > pageCount - pages.length) throw new PageOperationError("range", `Ungültiges Ziel: ${to}`);
			if (!m.FPDF_MovePages(doc, memory.ints(pages), pages.length, to)) throw new PageOperationError("range", "Seiten lassen sich nicht verschieben");
			return;
		}
		case "insertBlank": {
			const at = checkPosition(op.at, pageCount);
			if (!(op.width > 0 && op.height > 0 && op.width <= 14400 && op.height <= 14400) || !(op.count >= 1 && op.count <= 1e3)) throw new PageOperationError("range", "Ungültige Seitengröße oder Anzahl");
			for (let k = 0; k < op.count; k++) {
				const page = m.FPDFPage_New(doc, at + k, op.width, op.height);
				if (!page) throw new PageOperationError("range", "Leere Seite lässt sich nicht anlegen");
				m.FPDF_ClosePage(page);
			}
			return;
		}
		case "insertPdf": {
			const at = checkPosition(op.at, pageCount);
			importPdf(m, doc, op.source, at, memory);
			return;
		}
		case "insertImages": {
			const at = checkPosition(op.at, pageCount);
			op.images.forEach((image, k) => insertImage(m, doc, at + k, image, memory));
			return;
		}
	}
}
function importPdf(m, doc, source, at, memory) {
	const src = memory.openDocument(source);
	const sourceCount = m.FPDF_GetPageCount(src);
	const pages = source.pages === null ? null : checkPages(source.pages, sourceCount, true);
	if (!(pages ? m.FPDF_ImportPagesByIndex(doc, src, memory.ints(pages), pages.length, at) : m.FPDF_ImportPagesByIndex(doc, src, 0, 0, at))) throw new PageOperationError("import", "Seiten lassen sich nicht übernehmen");
}
function composeDocument(m, parts, memory) {
	const doc = m.FPDF_CreateNewDocument();
	if (!doc) throw new Error("PDFium: neues Dokument lässt sich nicht anlegen");
	try {
		for (const part of parts) {
			const at = m.FPDF_GetPageCount(doc);
			if (part.type === "pdf") importPdf(m, doc, part.source, at, memory);
			else insertImage(m, doc, at, part.image, memory);
		}
		if (m.FPDF_GetPageCount(doc) === 0) throw new PageOperationError("range", "Das neue Dokument hätte keine Seiten");
		return doc;
	} catch (error) {
		m.FPDF_CloseDocument(doc);
		throw error;
	}
}
function inspectDocument(m, data, password) {
	const memory = new Allocations(m);
	try {
		const doc = memory.openDocument({
			data: data.slice().buffer,
			password,
			pages: null
		});
		return {
			ok: true,
			pageCount: m.FPDF_GetPageCount(doc)
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof PageOperationError && error.code === "password" ? "password" : "invalid"
		};
	} finally {
		memory.release();
	}
}
//#endregion
//#region src/workers/pdfium/engine.ts
const SUBTYPE = {
	text: 1,
	freetext: 3,
	line: 4,
	square: 5,
	circle: 6,
	highlight: 9,
	underline: 10,
	squiggly: 11,
	strikeout: 12,
	stamp: 13,
	ink: 15
};
const COLOR_TYPE = {
	color: 0,
	interior: 1
};
const BORDER_SOLID = 1;
const LINE_END = {
	none: 0,
	openArrow: 4
};
const REPLY_TYPE_REPLY = 1;
const FONT_HELVETICA = 4;
const NOTE_ICONS = {
	Comment: 0,
	Key: 1,
	Note: 2,
	Help: 3,
	NewParagraph: 4,
	Paragraph: 5,
	Insert: 6
};
const FLAG = {
	hidden: 2,
	print: 4,
	noZoom: 8,
	noRotate: 16
};
const SAVE_INCREMENTAL = 1;
const SAVE_FULL = 2;
var PdfiumError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PdfiumError";
	}
};
function objectNumber(ref) {
	const match = /^(\d+)R$/.exec(ref);
	if (!match) throw new PdfiumError(`Ungültige Objektreferenz: ${ref}`);
	return Number(match[1]);
}
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
var PdfiumEngine = class {
	#m;
	constructor(module) {
		this.#m = module;
	}
	applyAndSave(bytes, password, changes, options) {
		return this.process(bytes, password, changes, [], options);
	}
	process(bytes, password, changes, operations, options) {
		const m = this.#m;
		const memory = new Allocations(m);
		try {
			return this.#process(bytes, password, changes, operations, options, memory);
		} finally {
			memory.release();
		}
	}
	compose(parts) {
		const m = this.#m;
		const memory = new Allocations(m);
		try {
			const doc = composeDocument(m, parts, memory);
			try {
				return this.#save(doc, SAVE_FULL);
			} finally {
				m.FPDF_CloseDocument(doc);
			}
		} finally {
			memory.release();
		}
	}
	inspect(bytes, password) {
		return inspectDocument(this.#m, bytes, password);
	}
	#process(bytes, password, changes, operations, options, memory) {
		const m = this.#m;
		return withBuffer(m, bytes.length, (dataPtr) => {
			m.pdfium.HEAPU8.set(bytes, dataPtr);
			const doc = m.FPDF_LoadMemDocument(dataPtr, bytes.length, password ?? "");
			if (!doc) throw new PdfiumError(`Dokument lässt sich nicht öffnen (Fehler ${m.FPDF_GetLastError()})`);
			try {
				const pages = /* @__PURE__ */ new Map();
				const page = (index) => {
					let ptr = pages.get(index);
					if (!ptr) {
						ptr = m.FPDF_LoadPage(doc, index);
						if (!ptr) throw new PdfiumError(`Seite ${index + 1} lässt sich nicht laden`);
						pages.set(index, ptr);
					}
					return ptr;
				};
				try {
					for (const ref of changes.deletions) this.#deleteByRef(doc, page, ref);
					for (const upsert of changes.upserts) this.#upsert(doc, page(upsert.annotation.pageIndex), upsert, options);
				} finally {
					for (const ptr of pages.values()) m.FPDF_ClosePage(ptr);
				}
				for (const operation of operations) applyPageOperation(m, doc, operation, memory);
				return this.#save(doc, options.incremental ? SAVE_INCREMENTAL : SAVE_FULL);
			} finally {
				m.FPDF_CloseDocument(doc);
			}
		});
	}
	canOpen(bytes, password) {
		const m = this.#m;
		return withBuffer(m, bytes.length, (dataPtr) => {
			m.pdfium.HEAPU8.set(bytes, dataPtr);
			const doc = m.FPDF_LoadMemDocument(dataPtr, bytes.length, password ?? "");
			if (!doc) return false;
			const ok = m.FPDF_GetPageCount(doc) > 0;
			m.FPDF_CloseDocument(doc);
			return ok;
		});
	}
	#save(doc, flags) {
		const m = this.#m;
		const writer = m.PDFiumExt_OpenFileWriter();
		try {
			if (!m.FPDF_SaveAsCopy(doc, writer, flags)) throw new PdfiumError("Speichern fehlgeschlagen");
			const size = m.PDFiumExt_GetFileWriterSize(writer);
			return withBuffer(m, size, (ptr) => {
				m.PDFiumExt_GetFileWriterData(writer, ptr, size);
				return copyOut(m, ptr, size);
			});
		} finally {
			m.PDFiumExt_CloseFileWriter(writer);
		}
	}
	#deleteByRef(doc, page, ref) {
		const m = this.#m;
		const number = objectNumber(ref);
		const count = m.FPDF_GetPageCount(doc);
		for (let index = 0; index < count; index++) {
			const pagePtr = page(index);
			const annot = m.EPDFPage_GetAnnotByObjectNumber(pagePtr, number);
			if (!annot) continue;
			const popup = m.FPDFAnnot_GetLinkedAnnot(annot, "Popup");
			const popupNumber = popup ? m.EPDFAnnot_GetObjectNumber(popup) : 0;
			if (popup) m.FPDFPage_CloseAnnot(popup);
			m.FPDFPage_CloseAnnot(annot);
			m.EPDFPage_RemoveAnnotByObjectNumber(pagePtr, number);
			if (popupNumber > 0) m.EPDFPage_RemoveAnnotByObjectNumber(pagePtr, popupNumber);
			return;
		}
	}
	#upsert(doc, pagePtr, upsert, options) {
		const m = this.#m;
		const a = upsert.annotation;
		const isNew = a.ref === null;
		const annot = isNew ? m.EPDFPage_CreateAnnot(pagePtr, SUBTYPE[a.kind === "arrow" ? "line" : a.kind === "note" ? "text" : a.kind]) : m.EPDFPage_GetAnnotByObjectNumber(pagePtr, objectNumber(a.ref));
		if (!annot) throw new PdfiumError(`Anmerkung ${a.ref ?? a.id} nicht gefunden`);
		try {
			const now = options.now ?? /* @__PURE__ */ new Date();
			this.#setCommon(annot, a, isNew, now);
			if (isNew || upsert.appearance) {
				this.#setKindSpecific(doc, annot, a, isNew);
				if (a.kind !== "stamp") m.EPDFAnnot_GenerateAppearance(annot);
			}
			for (const reply of a.replies) this.#upsertReply(pagePtr, annot, a, reply, now);
			for (const status of a.statuses) if (status.ref === null) this.#addStatus(pagePtr, annot, a, status, now);
		} finally {
			m.FPDFPage_CloseAnnot(annot);
		}
	}
	#setString(annot, key, value) {
		const m = this.#m;
		withWString(m, value, (ptr) => m.FPDFAnnot_SetStringValue(annot, key, ptr));
	}
	#setContents(annot, text, isNew) {
		this.#setString(annot, "Contents", text);
		if (!isNew && this.#m.FPDFAnnot_HasKey(annot, "RC")) this.#setString(annot, "RC", richText(text));
	}
	#setRect(annot, rect) {
		const m = this.#m;
		const [left, bottom, right, top] = rect;
		withFloats(m, [
			left,
			top,
			right,
			bottom
		], (ptr) => m.FPDFAnnot_SetRect(annot, ptr));
	}
	#setColor(annot, type, color) {
		this.#m.EPDFAnnot_SetColor(annot, type, byte(color.r), byte(color.g), byte(color.b));
	}
	#setCommon(annot, a, isNew, now) {
		const m = this.#m;
		this.#setRect(annot, a.rect);
		this.#setContents(annot, a.contents, isNew);
		this.#setString(annot, "T", a.author);
		this.#setString(annot, "M", a.modified || toPdfDate(now));
		if (isNew) {
			this.#setString(annot, "CreationDate", a.created || toPdfDate(now));
			this.#setString(annot, "NM", a.id);
		}
		if (a.kind !== "stamp" && a.kind !== "freetext") this.#setColor(annot, COLOR_TYPE.color, a.color);
		m.EPDFAnnot_SetOpacity(annot, byte(a.opacity));
		if (isNew) m.FPDFAnnot_SetFlags(annot, a.kind === "note" ? FLAG.print | FLAG.noZoom | FLAG.noRotate : FLAG.print);
	}
	#setKindSpecific(doc, annot, a, isNew) {
		const m = this.#m;
		switch (a.kind) {
			case "highlight":
			case "underline":
			case "strikeout":
			case "squiggly":
				if (isNew) for (const quad of a.quads) this.#appendQuad(annot, quad);
				break;
			case "note":
				m.EPDFAnnot_SetName(annot, NOTE_ICONS[a.icon] ?? NOTE_ICONS.Comment ?? 0);
				break;
			case "freetext":
				m.EPDFAnnot_SetDefaultAppearance(annot, FONT_HELVETICA, a.fontSize, byte(a.color.r), byte(a.color.g), byte(a.color.b));
				m.EPDFAnnot_SetBorderStyle(annot, BORDER_SOLID, 0);
				break;
			case "ink":
				if (!isNew) m.FPDFAnnot_RemoveInkList(annot);
				for (const path of a.paths) this.#addInkStroke(annot, path);
				m.EPDFAnnot_SetBorderStyle(annot, BORDER_SOLID, a.width);
				break;
			case "square":
			case "circle":
				m.EPDFAnnot_SetBorderStyle(annot, BORDER_SOLID, a.width);
				if (a.fill) this.#setColor(annot, COLOR_TYPE.interior, a.fill);
				else if (a.fill === null) m.EPDFAnnot_ClearColor(annot, COLOR_TYPE.interior);
				break;
			case "line":
			case "arrow":
				withFloats(m, [
					a.start.x,
					a.start.y,
					a.end.x,
					a.end.y
				], (ptr) => m.EPDFAnnot_SetLine(annot, ptr, ptr + 8));
				m.EPDFAnnot_SetLineEndings(annot, LINE_END.none, a.kind === "arrow" ? LINE_END.openArrow : LINE_END.none);
				m.EPDFAnnot_SetBorderStyle(annot, BORDER_SOLID, a.width);
				break;
			case "stamp": if (isNew) this.#buildStampAppearance(doc, annot, a);
		}
	}
	#appendQuad(annot, quad) {
		const m = this.#m;
		withFloats(m, quad.flatMap((p) => [p.x, p.y]), (ptr) => m.FPDFAnnot_AppendAttachmentPoints(annot, ptr));
	}
	#addInkStroke(annot, path) {
		const m = this.#m;
		if (path.length === 0) return;
		withFloats(m, path.flatMap((p) => [p.x, p.y]), (ptr) => m.FPDFAnnot_AddInkStroke(annot, ptr, path.length));
	}
	#buildStampAppearance(doc, annot, a) {
		const m = this.#m;
		const [left, bottom, right, top] = a.rect;
		const width = right - left;
		const height = top - bottom;
		const color = STAMP_STYLES[a.stamp].color;
		const border = Math.max(1.5, height * .06);
		const frame = m.FPDFPageObj_CreateNewRect(left + border / 2, bottom + border / 2, width - border, height - border);
		m.FPDFPageObj_SetStrokeColor(frame, byte(color.r), byte(color.g), byte(color.b), 255);
		m.FPDFPageObj_SetStrokeWidth(frame, border);
		m.FPDFPath_SetDrawMode(frame, 0, true);
		m.FPDFAnnot_AppendObject(annot, frame);
		const font = m.FPDFText_LoadStandardFont(doc, "Helvetica-Bold");
		let fontSize = height * .5;
		const text = m.FPDFPageObj_CreateTextObj(doc, font, fontSize);
		withWString(m, a.label, (ptr) => m.FPDFText_SetText(text, ptr));
		const measured = withBuffer(m, 16, (ptr) => {
			m.FPDFPageObj_GetBounds(text, ptr, ptr + 4, ptr + 8, ptr + 12);
			const l = m.pdfium.getValue(ptr, "float");
			return m.pdfium.getValue(ptr + 8, "float") - l;
		});
		const available = width - border * 4;
		const scale = measured > available && measured > 0 ? available / measured : 1;
		fontSize *= scale;
		const x = left + (width - measured * scale) / 2;
		const y = bottom + (height - fontSize * .72) / 2;
		m.FPDFPageObj_Transform(text, scale, 0, 0, scale, x, y);
		m.FPDFPageObj_SetFillColor(text, byte(color.r), byte(color.g), byte(color.b), 255);
		m.FPDFAnnot_AppendObject(annot, text);
		m.FPDFFont_Close(font);
	}
	#upsertReply(pagePtr, parent, a, reply, now) {
		const m = this.#m;
		const isNew = reply.ref === null;
		const annot = isNew ? m.EPDFPage_CreateAnnot(pagePtr, SUBTYPE.text) : m.EPDFPage_GetAnnotByObjectNumber(pagePtr, objectNumber(reply.ref));
		if (!annot) return;
		try {
			this.#setContents(annot, reply.contents, isNew);
			this.#setString(annot, "T", reply.author);
			this.#setString(annot, "M", reply.modified || toPdfDate(now));
			if (isNew) {
				const [left, , , top] = a.rect;
				this.#setRect(annot, [
					left,
					top - 20,
					left + 20,
					top
				]);
				this.#setString(annot, "CreationDate", reply.modified || toPdfDate(now));
				this.#setString(annot, "NM", reply.id);
				m.EPDFAnnot_SetLinkedAnnot(annot, "IRT", parent);
				m.EPDFAnnot_SetReplyType(annot, REPLY_TYPE_REPLY);
				m.EPDFAnnot_SetName(annot, NOTE_ICONS.Comment ?? 0);
				m.FPDFAnnot_SetFlags(annot, FLAG.hidden | FLAG.noZoom | FLAG.noRotate);
			}
		} finally {
			m.FPDFPage_CloseAnnot(annot);
		}
	}
	#addStatus(pagePtr, parent, a, status, now) {
		const m = this.#m;
		const annot = m.EPDFPage_CreateAnnot(pagePtr, SUBTYPE.text);
		if (!annot) return;
		try {
			const [left, , , top] = a.rect;
			this.#setRect(annot, [
				left,
				top - 20,
				left + 20,
				top
			]);
			this.#setString(annot, "T", status.author);
			this.#setString(annot, "M", status.modified || toPdfDate(now));
			this.#setString(annot, "NM", status.id);
			this.#setString(annot, "State", status.status);
			this.#setString(annot, "StateModel", "Review");
			m.EPDFAnnot_SetLinkedAnnot(annot, "IRT", parent);
			m.FPDFAnnot_SetFlags(annot, FLAG.hidden | FLAG.noZoom | FLAG.noRotate);
		} finally {
			m.FPDFPage_CloseAnnot(annot);
		}
	}
};
function richText(text) {
	const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:spec="2.0.2">${text.split(/\r\n|\r|\n/).map((line) => `<p>${escape(line)}</p>`).join("")}</body>`;
}
//#endregion
//#region ../../../../private/tmp/claude-501/review3/exp.ts
const ROOT = "/Users/linus/Entwicklung/Blattwerk";
const require = createRequire(ROOT + "/package.json");
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsRoot, "legacy/build/pdf.worker.mjs")).href;
const none = {
	upserts: [],
	deletions: []
};
const opts = {
	incremental: true,
	now: new Date(Date.UTC(2026, 9, 12))
};
const read = (f) => new Uint8Array(readFileSync(path.join(ROOT, f)));
const isPrefix = (a, b) => b.length >= a.length && Buffer.from(b.subarray(0, a.length)).equals(Buffer.from(a));
async function info(bytes, password) {
	const task = pdfjs.getDocument({
		data: bytes.slice(),
		password,
		verbosity: 1
	});
	try {
		const pdf = await task.promise;
		const texts = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const tc = await page.getTextContent();
			texts.push(tc.items.map((it) => it.str).join(" ").slice(0, 40));
			await page.getOperatorList();
		}
		return {
			pages: pdf.numPages,
			texts
		};
	} catch (e) {
		return { error: String(e) };
	} finally {
		await task.destroy();
	}
}
const wasm = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"));
const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
m.PDFiumExt_Init();
const engine = new PdfiumEngine(m);
const b0 = read("test/fixtures/pdfs/text.pdf");
const b1 = engine.process(b0, null, none, [{
	type: "rotate",
	pages: [0],
	delta: 90
}], opts);
const b2 = engine.process(b1, null, none, [{
	type: "delete",
	pages: [1]
}], opts);
const b3 = engine.process(b2, null, none, [{
	type: "move",
	pages: [0],
	to: 3
}], opts);
console.log("A prefix b0<b1", isPrefix(b0, b1), "b1<b2", isPrefix(b1, b2), "b2<b3", isPrefix(b2, b3), "sizes", b0.length, b1.length, b2.length, b3.length);
const s1 = b3.subarray(0, b1.length);
console.log("A restore s1 equals b1", Buffer.from(s1).equals(Buffer.from(b1)));
const i0 = await info(b3.subarray(0, b0.length));
console.log("C deleted page still in saved file prefix: pages of prefix", i0.pages, "page2 text", i0.texts?.[1]);
const i2 = await info(b2);
console.log("C after delete pages", i2.pages);
const enc = read("test/fixtures/pdfs/verschluesselt.pdf");
const jpg = read("test/fixtures/images/foto.jpg");
const ji = readImageInfo(jpg);
const be = engine.process(enc, "geheim", none, [
	{
		type: "insertPdf",
		at: 0,
		source: {
			data: b0.slice().buffer,
			password: null,
			pages: [4]
		}
	},
	{
		type: "insertBlank",
		at: 1,
		width: 300,
		height: 300,
		count: 1
	},
	{
		type: "insertImages",
		at: 2,
		images: [{
			kind: ji.kind,
			data: jpg.slice().buffer,
			width: ji.width,
			height: ji.height,
			rotation: 0
		}]
	}
], opts);
console.log("B encrypted target, prefix kept", isPrefix(enc, be));
const ie = await info(be, "geheim");
console.log("B pdf.js", JSON.stringify(ie).slice(0, 300));
console.log("B pdfium canOpen no pw", engine.canOpen(be, null), "with pw", engine.canOpen(be, "geheim"));
const plain = engine.process(b0, null, none, [{
	type: "insertPdf",
	at: 0,
	source: {
		data: b0.slice().buffer,
		password: null,
		pages: [4]
	}
}], opts);
console.log("B reference plain insert text", JSON.stringify((await info(plain)).texts?.[0]));
for (const f of ["kaputte-xref.pdf", "abgeschnitten.pdf"]) {
	const d0 = read("test/fixtures/pdfs/" + f);
	try {
		const d1 = engine.process(d0, null, none, [{
			type: "rotate",
			pages: [0],
			delta: 90
		}], opts);
		const d2 = engine.process(d1, null, none, [{
			type: "delete",
			pages: [1]
		}], opts);
		const r0 = await info(d0);
		const r2 = await info(d2);
		console.log("D", f, "pdfjs before", r0.pages ?? r0.error, "after 2 ops", r2.pages ?? r2.error, "pdfium pages", engine.inspect(d2, null), "prefix", isPrefix(d0, d1), isPrefix(d1, d2));
	} catch (e) {
		console.log("D", f, "error", String(e));
	}
}
const k0 = read("test/fixtures/pdfs/kommentare.pdf");
async function refs(bytes) {
	const task = pdfjs.getDocument({
		data: bytes.slice(),
		verbosity: 0
	});
	const pdf = await task.promise;
	const out = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		const a = await (await pdf.getPage(i)).getAnnotations();
		out.push(i + ":" + a.map((x) => x.id + "/" + x.subtype).join(","));
	}
	await task.destroy();
	return out.join(" | ");
}
const k1 = engine.process(k0, null, none, [{
	type: "insertBlank",
	at: 0,
	width: 100,
	height: 100,
	count: 1
}], opts);
console.log("E refs before", await refs(k0));
console.log("E refs after insertBlank", await refs(k1));
const big = path.join(ROOT, "test/fixtures/generated/gross-600-seiten.pdf");
if (existsSync(big)) {
	const g0 = new Uint8Array(readFileSync(big));
	let t = performance.now();
	const g1 = engine.process(g0, null, none, [{
		type: "rotate",
		pages: [0],
		delta: 90
	}], opts);
	const tA = performance.now() - t;
	t = performance.now();
	const g2 = engine.process(g1, null, none, [{
		type: "delete",
		pages: [5]
	}], opts);
	const tB = performance.now() - t;
	console.log("F big", g0.length, "delta1", g1.length - g0.length, "delta2", g2.length - g1.length, "ms", Math.round(tA), Math.round(tB), "prefix", isPrefix(g0, g1), isPrefix(g1, g2), "wasm heap MB", Math.round(m.pdfium.HEAPU8.length / 1e6));
}
//#endregion
export {};
