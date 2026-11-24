import type {BrowserContext} from "@playwright/test";

/** One Content-Security-Policy or Trusted Types violation a page reported. */
export interface CspViolation {
	directive: string;
	blockedURI: string;
	sample: string;
	page: string;
}

/** The assertion message both e2e tiers fail with when a page broke the policy. */
export const CSP_VIOLATIONS = "Content-Security-Policy violations";

/**
 * Collects every securitypolicyviolation a context's documents report, into the returned list.
 * The preview server sends the deployed policy (vite.config.js, preview.headers), so a page the
 * policy would break in production shows up here. The reports reach the test through a binding,
 * which outlives navigations. Document contexts only: both tiers block the service worker, and
 * a dedicated worker's violations don't fire on the document.
 */
export async function watchCspViolations(context: BrowserContext): Promise<CspViolation[]> {
	const violations: CspViolation[] = [];
	await context.exposeBinding("__e2eCspViolation", (_source, violation: CspViolation) => {
		violations.push(violation);
	});
	await context.addInitScript(() => {
		document.addEventListener("securitypolicyviolation", (event) => {
			const report = (window as unknown as Record<string, (v: CspViolation) => void>)
				.__e2eCspViolation;
			report({
				directive: event.effectiveDirective,
				blockedURI: event.blockedURI,
				sample: event.sample,
				page: location.pathname,
			});
		});
	});
	return violations;
}
