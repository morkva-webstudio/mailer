import LogoMailcheap from "@/components/LogoMailcheap";
import { BRAND_MARK_URL } from "@/lib/brand";
import { cn } from "@/lib/utils";

// The plane, or the server's own mark (lib/brand.js) at the same size.
export default function LogoBrand({ className }) {
	if (!BRAND_MARK_URL) return <LogoMailcheap className={className} />;
	// A plain img: the mark can live outside the app (another path of the domain), where next/image doesn't reach.
	// eslint-disable-next-line @next/next/no-img-element
	return <img src={BRAND_MARK_URL} alt="" aria-hidden="true" className={cn("size-6 shrink-0 rounded-md", className)} />;
}
