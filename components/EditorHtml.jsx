"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { Segmented } from "@/components/FieldsTheme";

const MODE_KEY = "mailcheap:html-editor-mode";
const MODES = [
	{ value: "visual", label: "Visual", content: "Visual" },
	{ value: "html", label: "HTML", content: "HTML" },
];

// A designed HTML email (format html): Visual edits its text in place, as it looks, HTML edits its code. Visual only
// changes what's typed into it: the document goes back as the browser keeps it, so an email nobody types into stays as
// it was saved. The mode is the browser's, for every email.
export default function EditorHtml({ value, onChange }) {
	// Visual on the server; the browser's stored choice once it's here, without a hydration mismatch.
	const stored = useSyncExternalStore(subscribeNever, readMode, () => "visual");
	const [chosen, setMode] = useState(null);
	const mode = chosen ?? stored;
	// Each switch to Visual starts the frame from the code as it is then.
	const [visualKey, setVisualKey] = useState(0);

	function changeMode(next) {
		setMode(next);
		if (next === "visual") setVisualKey((key) => key + 1);
		try {
			localStorage.setItem(MODE_KEY, next);
		} catch {}
	}

	return (
		<div className="relative">
			<div className="flex items-center justify-end border-b border-border/60 px-4 py-2">
				<Segmented size="sm" label="Editor" value={mode} options={MODES} onChange={changeMode} />
			</div>
			{mode === "visual" ? (
				<FrameVisual key={visualKey} value={value} onChange={onChange} />
			) : (
				<textarea
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder="<html>"
					spellCheck={false}
					aria-label="Content"
					className="block min-h-[560px] w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
				/>
			)}
		</div>
	);
}

function subscribeNever() {
	return () => {};
}

function readMode() {
	try {
		return localStorage.getItem(MODE_KEY) === "html" ? "html" : "visual";
	} catch {
		return "visual";
	}
}

// The email in a frame whose document is editable. No scripts run in it (the sandbox has no allow-scripts); this page
// reaches its document, same origin, to make it editable and read it back. Links don't open while editing.
function FrameVisual({ value, onChange }) {
	const frameRef = useRef(null);
	const [initial] = useState(value);
	const [height, setHeight] = useState(560);
	const emitChange = useEffectEvent((html) => onChange(html));

	useEffect(() => {
		const frame = frameRef.current;
		let observer = null;
		let detach = () => {};

		function setup() {
			const doc = frame?.contentDocument;
			if (!doc?.body) return;
			doc.designMode = "on";
			const prefix = getDoctype(initial);
			const fit = () => setHeight(Math.max(560, doc.documentElement.scrollHeight));
			const emit = () => emitChange(`${prefix}${doc.documentElement.outerHTML}`);
			const stopLinks = (event) => {
				if (event.target.closest?.("a")) event.preventDefault();
			};
			doc.addEventListener("input", emit);
			doc.addEventListener("click", stopLinks);
			observer = new ResizeObserver(fit);
			observer.observe(doc.documentElement);
			fit();
			detach = () => {
				doc.removeEventListener("input", emit);
				doc.removeEventListener("click", stopLinks);
			};
		}

		frame.addEventListener("load", setup);
		if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body?.childNodes.length) setup();
		return () => {
			frame.removeEventListener("load", setup);
			observer?.disconnect();
			detach();
		};
	}, [initial]);

	return (
		<iframe
			ref={frameRef}
			title="Email, editable"
			srcDoc={initial}
			sandbox="allow-same-origin"
			style={{ height }}
			className="block w-full border-0 bg-white"
		/>
	);
}

// What comes before <html>, as it was written: outerHTML leaves out the doctype.
function getDoctype(html) {
	const start = html.search(/<html[\s>]/i);
	if (start > 0) return html.slice(0, start);
	return /^\s*<!doctype/i.test(html) ? "" : "<!DOCTYPE html>\n";
}
