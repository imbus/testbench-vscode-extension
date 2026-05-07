/**
 * @file src/test/ui/utils/webviewUtils.ts
 * @description Webview availability and switching helpers for UI tests.
 */

import { getTestLogger } from "./testLogger";
import { UITimeouts } from "./waitHelpers";
import { WebDriver, By, SideBarView } from "vscode-extension-tester";

const logger = getTestLogger();

/**
 * Checks if the login webview should be available (user is not logged in).
 * When logged in, tree views are shown instead of the webview.
 *
 * @param _driver - The WebDriver instance (unused but kept for API consistency)
 * @returns Promise<boolean> - True if webview should be available (not logged in), false if logged in
 */
export async function isWebviewAvailable(_driver: WebDriver): Promise<boolean> {
    try {
        // Check if tree views are visible (indicates user is logged in)
        // If Projects, Test Themes, or Test Elements views are visible, webview is hidden
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const sections = await content.getSections();

        for (const section of sections) {
            const title = await section.getTitle();
            // If we see tree views, user is logged in and webview is hidden
            if (title.includes("Projects") || title.includes("Test Themes") || title.includes("Test Elements")) {
                return false;
            }
            // If we see the login webview section, it's available
            if (title.includes("Login to TestBench")) {
                return true;
            }
        }

        // If no sections found or only login section, assume webview might be available
        return true;
    } catch (error) {
        // If we can't determine, assume webview might be available
        // StaleElementReferenceError is expected during state transitions (login/logout)
        // and doesn't indicate a real problem, so log at trace level instead of debug
        const isStaleElementError =
            error instanceof Error && (error.name === "StaleElementReferenceError" || error.message.includes("stale"));

        if (isStaleElementError) {
            logger.trace(
                "Webview",
                "Element became stale while checking availability (expected during state transitions)"
            );
        } else {
            logger.debug("Webview", "Could not determine webview availability:", error);
        }
        return true;
    }
}

/**
 * Finds and switches to the webview iframe in the shadow DOM.
 * Returns true if successful, false otherwise.
 *
 * @param driver - The WebDriver instance
 * @param markAttribute - Optional attribute name to mark the iframe (default: 'data-test-webview')
 * @param timeout - Maximum time to wait for webview (default: UITimeouts.VERY_LONG)
 * @returns Promise<boolean> - True if webview was found and switched to, false otherwise
 */
export async function findAndSwitchToWebview(
    driver: WebDriver,
    markAttribute: string = "data-test-webview",
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        const attributeNamePattern = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
        const safeMarkAttribute = attributeNamePattern.test(markAttribute) ? markAttribute : "data-test-webview";

        if (safeMarkAttribute !== markAttribute) {
            logger.warn(
                "Webview",
                `Invalid webview markAttribute "${markAttribute}". Falling back to "${safeMarkAttribute}".`
            );
        }

        // Wait for webview to be available with a single attempt using proper waits
        const iframeFound: boolean = await driver.wait(
            async (): Promise<boolean> => {
                const result = (await driver.executeScript(
                    `
                function findIframesInShadowDOM(root) {
                    const iframes = [];
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.shadowRoot) {
                            const shadowIframes = node.shadowRoot.querySelectorAll('iframe');
                            iframes.push(...shadowIframes);
                            iframes.push(...findIframesInShadowDOM(node.shadowRoot));
                        }
                        if (node.tagName === 'IFRAME') {
                            iframes.push(node);
                        }
                    }
                    return iframes;
                }
                const allIframes = findIframesInShadowDOM(document.body);
                if (allIframes.length > 0) {
                    allIframes[allIframes.length - 1].setAttribute(String(arguments[0] || 'data-test-webview'), 'true');
                    return true;
                }
                return false;
            `,
                    safeMarkAttribute
                )) as boolean;
                return result;
            },
            timeout,
            "Waiting for webview iframe",
            UITimeouts.MINIMAL
        );

        if (!iframeFound) {
            return false;
        }

        // Find and switch to the marked iframe
        const markedIframes = await driver.findElements(By.css(`iframe[${safeMarkAttribute}="true"]`));
        if (markedIframes.length === 0) {
            return false;
        }

        await driver.switchTo().frame(markedIframes[0]);

        // Wait for active-frame to load content
        const contentLoaded = await driver.wait(
            async () => {
                const result = (await driver.executeScript(`
                const activeFrame = document.getElementById('active-frame');
                if (!activeFrame) return { loaded: false, reason: 'no active-frame' };
                
                const contentDocument = activeFrame.contentDocument || activeFrame.contentWindow?.document;
                if (!contentDocument) return { loaded: false, reason: 'no contentDocument' };
                
                const form = contentDocument.getElementById('addConnectionForm');
                const serverField = contentDocument.getElementById('serverName');
                const forms = contentDocument.querySelectorAll('form').length;
                
                return {
                    loaded: !!(form || serverField || forms > 0),
                    hasForm: !!form,
                    hasServerField: !!serverField,
                    forms: forms
                };
            `)) as { loaded: boolean; hasForm?: boolean; hasServerField?: boolean; forms?: number; reason?: string };
                return result.loaded;
            },
            UITimeouts.LONG,
            "Waiting for content to load in active-frame",
            UITimeouts.MINIMAL
        );

        if (!contentLoaded) {
            await driver.switchTo().defaultContent();
            return false;
        }

        // Switch to the active-frame iframe inside the webview iframe
        const activeFrame = await driver.findElement(By.id("active-frame"));
        await driver.switchTo().frame(activeFrame);

        // Verify form is accessible
        const forms = await driver.findElements(By.id("addConnectionForm"));
        const serverFields = await driver.findElements(By.id("serverName"));

        if (forms.length === 0 && serverFields.length === 0) {
            await driver.switchTo().defaultContent();
            return false;
        }

        // Webview loading is a background operation, no slow motion needed
        return true;
    } catch (error) {
        logger.error("Webview", "Error finding webview:", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}
