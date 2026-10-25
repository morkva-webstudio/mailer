// A server that serves MailCheap under a path of its domain (https://example.com/mailer) sets NEXT_PUBLIC_BASE_PATH
// to that path, for builds too: Next.js prefixes its links, router and assets itself, and this adds it to the paths
// it doesn't see (fetch, redirects from route handlers, plain <a> and unoptimized images). Empty everywhere else.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function withBasePath(path) {
	return path.startsWith("/") ? `${BASE_PATH}${path}` : path;
}
