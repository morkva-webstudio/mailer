"use client";

import { useId, useRef, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { getContactOptions } from "@/app/(app)/contacts/actions";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { formatNumber } from "@/lib/format";
import { MAX_TAGS, cleanTag } from "@/lib/contact-fields";
import { cn } from "@/lib/utils";

// Several tags at once: a click opens the newsletter's tags, read fresh each time, with how many contacts have each;
// typing filters them, and Enter adds a new one. tags: the names the page had, shown until the list comes.
export default function PickerTags({ value, onChange, newsletterId, tags = [], placeholder = "Select tag(s)", label = "Tags" }) {
	const [isOpen, setIsOpen] = useState(false);
	const [text, setText] = useState("");
	const [options, setOptions] = useState(() => tags.map((name) => ({ name, contacts: null })));
	const [isLoading, setIsLoading] = useState(false);
	const inputRef = useRef(null);
	const fieldRef = useRef(null);
	const requestRef = useRef(0);
	const listId = useId();
	const query = cleanTag(text) ?? "";
	const shown = options.filter(({ name }) => name.includes(query));
	const canCreate = Boolean(query) && !options.some(({ name }) => name === query) && !value.includes(query);
	const isFull = value.length >= MAX_TAGS;

	// Read again at each opening, so tags added since the page loaded are there.
	function open() {
		if (isOpen) return;
		setIsOpen(true);
		if (!newsletterId) return;
		const request = ++requestRef.current;
		setIsLoading(true);
		getContactOptions(newsletterId).then((result) => {
			if (request !== requestRef.current) return;
			setIsLoading(false);
			if (!result?.error) setOptions(result.tags.map(({ name, contacts }) => ({ name, contacts })));
		});
	}

	function toggle(name) {
		if (value.includes(name)) onChange(value.filter((tag) => tag !== name));
		else if (!isFull) onChange([...value, name]);
		setText("");
		inputRef.current?.focus();
	}

	function onKeyDown(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			if (canCreate) toggle(query);
			else if (shown.length === 1) toggle(shown[0].name);
		} else if (event.key === "Backspace" && !text && value.length > 0) {
			onChange(value.slice(0, -1));
		} else if (event.key === "Escape") {
			setIsOpen(false);
		}
	}

	return (
		<Popover open={isOpen} onOpenChange={(next) => (next ? open() : setIsOpen(false))}>
			<PopoverAnchor asChild>
				<div
					ref={fieldRef}
					onClick={() => {
						open();
						inputRef.current?.focus();
					}}
					className="flex min-h-9 cursor-text flex-wrap items-center gap-1 rounded-lg bg-background px-1.5 py-1 shadow-border transition-shadow duration-150 focus-within:ring-3 focus-within:ring-ring/50"
				>
					{value.map((tag) => (
						<span key={tag} className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-foreground">
							<span className="truncate">{tag}</span>
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									onChange(value.filter((item) => item !== tag));
								}}
								aria-label={`Remove ${tag}`}
								className="grid size-5 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
					<input
						ref={inputRef}
						value={text}
						onChange={(event) => {
							setText(event.target.value);
							open();
						}}
						onFocus={open}
						onKeyDown={onKeyDown}
						placeholder={value.length > 0 ? "" : placeholder}
						aria-label={label}
						aria-expanded={isOpen}
						aria-controls={listId}
						role="combobox"
						maxLength={60}
						className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				className="w-(--radix-popover-trigger-width) min-w-64 p-1"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onInteractOutside={(event) => {
					// A click in the field itself keeps the list open.
					if (event.target instanceof Node && fieldRef.current?.contains(event.target)) event.preventDefault();
				}}
			>
				<ul id={listId} role="listbox" aria-label={label} aria-multiselectable="true" className="max-h-64 overflow-y-auto">
					{canCreate && (
						<li>
							<button type="button" onClick={() => toggle(query)} disabled={isFull} className={OPTION}>
								<Plus className="size-4 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">Add &ldquo;{query}&rdquo;</span>
							</button>
						</li>
					)}
					{shown.map(({ name, contacts }) => {
						const isSelected = value.includes(name);
						return (
							<li key={name} role="option" aria-selected={isSelected}>
								<button type="button" onClick={() => toggle(name)} disabled={!isSelected && isFull} className={OPTION}>
									<span className={cn("grid size-4 place-items-center rounded-sm shadow-border", isSelected && "bg-foreground text-background")}>
										{isSelected && <Check className="size-3" />}
									</span>
									<span className="min-w-0 flex-1 truncate">{name}</span>
									{contacts !== null && <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(contacts)}</span>}
								</button>
							</li>
						);
					})}
					{shown.length === 0 && !canCreate && (
						<li className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
							{isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
							{isLoading ? "Loading tags" : "No tags yet: type one and press Enter"}
						</li>
					)}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

const OPTION =
	"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-muted focus-visible:bg-muted disabled:opacity-50";
