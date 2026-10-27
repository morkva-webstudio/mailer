import { cn } from "@/lib/utils";

// On what's shown but not available yet, so it can be decided later whether it's needed.
export default function BadgeSoon({ className }) {
	return (
		<span className={cn("inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground", className)}>
			Soon
		</span>
	);
}
