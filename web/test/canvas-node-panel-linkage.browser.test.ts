import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

import { productCss } from "./fixtures/product-css";

let browser: Browser;
let page: Page;
let server: ReturnType<typeof Bun.serve>;
let script: string;
let realNodeScript: string;

async function buildHarness(entrypoint: string) {
    const bundle = await Bun.build({
        entrypoints: [entrypoint],
        target: "browser", format: "esm",
        define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
        plugins: [{ name: "alias", setup(builder) {
            builder.onLoad({ filter: /src[\\/]components[\\/]model-logo\.tsx$/ }, () => ({ contents: "export function ModelLogo() { return null; }", loader: "js" }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
            builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
        } }],
    });
    if (!bundle.success) throw new Error(bundle.logs.join("\n"));
    return bundle.outputs.find((output) => output.path.endsWith(".js"))!.text();
}

beforeAll(async () => {
    script = await buildHarness(import.meta.dir + "/fixtures/canvas-node-panel-harness.tsx");
    realNodeScript = await buildHarness(import.meta.dir + "/fixtures/canvas-node-panel-real-node-harness.tsx");
    // The page loads the production CSS bundle built from src/styles/globals.css.
    // Tests assert that the node/panel transition rules come from that stylesheet.
    const css = await productCss();
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "application/javascript" } });
            if (path === "/real.js") return new Response(realNodeScript, { headers: { "Content-Type": "application/javascript" } });
            if (path === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
            if (path === "/real") return new Response('<!doctype html><html><head><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module">import { mountPanelRealNodeHarness } from "/real.js"; window.mountPanelRealNodeHarness = mountPanelRealNodeHarness;</script></body></html>', { headers: { "Content-Type": "text/html" } });
            return new Response('<!doctype html><html><head><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module">import { mountNodePanelHarness } from "/harness.js"; window.mountPanelHarness = mountNodePanelHarness;</script></body></html>', { headers: { "Content-Type": "text/html" } });
        },
    });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    // The geometry transition is intentionally disabled under reduced motion.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    page.on("pageerror", (error) => console.error(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
}, 90_000);

afterAll(async () => {
    await browser?.close();
    server?.stop(true);
});

type HarnessOptions = {
    node?: { position?: { x: number; y: number }; width?: number; height?: number };
    viewport?: { x: number; y: number; k: number };
    containerSize?: { width: number; height: number };
};

type FrameAction =
    | { atFrame: number; kind: "mount"; options: HarnessOptions }
    | { atFrame: number; kind: "patch-ratio"; size: string };

type FrameSample = {
    frame: number;
    hasPanel: boolean;
    panel?: {
        left: number; top: number; right: number; bottom: number; width: number; height: number;
        inlineWidth: string; inlineTransform: string; transitionDuration: string; animations: number; animated: boolean;
    };
    node?: {
        left: number; top: number; right: number; bottom: number; width: number; height: number;
        transitionDuration: string; animations: number;
    };
};

/**
 * Samples real animation frames (rAF callbacks, i.e. the values the browser
 * paints). Mounts run before that frame's sample; geometry changes run in a
 * follow-up task so the forced layout used for sampling cannot resolve the new
 * values before the transition starts.
 */
async function recordFrames(frameCount: number, action?: FrameAction) {
    return page.evaluate(({ frameCount, action }) => new Promise<FrameSample[]>((resolve) => {
        const samples: FrameSample[] = [];
        let frame = 0;
        const record = () => {
            if (action && action.atFrame === frame && action.kind === "mount") {
                (window as unknown as { mountPanelHarness?: (host: HTMLElement, options: unknown) => void }).mountPanelHarness?.(document.getElementById("root") as HTMLElement, action.options);
            }
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]");
            const node = document.querySelector<HTMLElement>('[data-testid="canvas-node"]');
            const box = (element: HTMLElement) => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            };
            samples.push(panel && node
                ? {
                    frame,
                    hasPanel: true,
                    panel: {
                        ...box(panel),
                        inlineWidth: panel.style.width,
                        inlineTransform: panel.style.transform,
                        transitionDuration: getComputedStyle(panel).transitionDuration,
                        animations: panel.getAnimations().length,
                        animated: panel.dataset.panelAnimated === "true",
                    },
                    node: { ...box(node), transitionDuration: getComputedStyle(node).transitionDuration, animations: node.getAnimations().length },
                }
                : { frame, hasPanel: false });
            // Apply geometry changes in a separate task, after this frame's
            // measurement. Reading layout right after the style mutation would
            // make the browser resolve the new values before the transition
            // starts, hiding the very frames this test wants to observe.
            if (action && action.atFrame === frame && action.kind === "patch-ratio") {
                const api = (window as unknown as { panelHarness?: { patchNode?: (patch: { size: string }) => void } }).panelHarness;
                setTimeout(() => api?.patchNode?.({ size: action.size }), 0);
            }
            frame += 1;
            if (frame >= frameCount) resolve(samples);
            else requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
    }), { frameCount, action });
}

async function openHarnessPage() {
    await page.goto(server.url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean((window as unknown as { mountPanelHarness?: unknown }).mountPanelHarness));
}

async function mountHarness(options: HarnessOptions = {}) {
    await openHarnessPage();
    await page.evaluate((opts) => (window as unknown as { mountPanelHarness: (host: HTMLElement, options: HarnessOptions) => void }).mountPanelHarness(document.getElementById("root") as HTMLElement, opts), options);
    // Same as a canvas click: the viewport mounts first, the panel follows in a
    // later commit, then measures the committed node element.
    await page.waitForSelector("[data-canvas-node-panel]");
    await settle();
    // Let the first-paint transition enablement and any layout settle land.
    await settle();
}

async function settle() {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function measure() {
    return page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]");
        const node = document.querySelector<HTMLElement>('[data-testid="canvas-node"]');
        const container = document.querySelector<HTMLElement>('[data-testid="canvas-container"]');
        if (!panel || !node || !container) throw new Error("panel harness not mounted");
        const pick = (element: HTMLElement) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const style = getComputedStyle(panel);
        const nodeStyle = getComputedStyle(node);
        const sheetHasPanelRule = [...document.styleSheets].some((sheet) => {
            try {
                return [...sheet.cssRules].some((rule) => rule.cssText.includes("[data-canvas-node-panel]"));
            } catch {
                return false;
            }
        });
        return {
            panel: pick(panel),
            node: pick(node),
            container: { ...pick(container), clientWidth: container.clientWidth, clientHeight: container.clientHeight },
            inline: { transform: panel.style.transform, width: panel.style.width },
            productionStyle: {
                sheetHasPanelRule,
                position: style.position,
                overflowY: style.overflowY,
                maxWidth: style.maxWidth,
                transitionDuration: style.transitionDuration,
                animations: panel.getAnimations().length,
                animated: panel.dataset.panelAnimated === "true",
                nodeClassName: node.className,
                nodeTransitionDuration: nodeStyle.transitionDuration,
                nodeAnimations: node.getAnimations().length,
            },
        };
    });
}

function expectPanelAttachedBelow(measurement: Awaited<ReturnType<typeof measure>>) {
    // keepBelowNode: 16px under the node, horizontally centered on it. The
    // tolerance covers subpixel rounding while both boxes animate.
    expect(Math.abs(measurement.panel.top - (measurement.node.bottom + 16))).toBeLessThan(1.5);
    expect(Math.abs(measurement.panel.left + measurement.panel.width / 2 - (measurement.node.left + measurement.node.width / 2))).toBeLessThan(1.5);
}

describe("canvas node panel linkage", () => {
    test("first painted frame is already the measured position and does not animate", async () => {
        await openHarnessPage();
        // Mount inside the recorder so frame 0..n are real paints.
        const samples = await recordFrames(12, { atFrame: 0, kind: "mount", options: {} });

        const panelFrames = samples.filter((sample) => sample.hasPanel);
        expect(panelFrames.length).toBeGreaterThan(0);
        const first = panelFrames[0];
        // 720px node at (240,120): 920px panel centered at x=600, top 541.
        expect(first.panel!.left).toBeCloseTo(140, 0);
        expect(first.panel!.top).toBeCloseTo(541, 0);
        expect(first.panel!.width).toBeCloseTo(920, 0);
        expect(first.panel!.inlineTransform).toBe("translate3d(140px, 541px, 0px)");
        expect(first.panel!.animations).toBe(0);
        // No later frame may move it: nothing flies in from the origin.
        for (const sample of panelFrames) {
            expect(sample.panel!.left).toBeCloseTo(first.panel!.left, 1);
            expect(sample.panel!.top).toBeCloseTo(first.panel!.top, 1);
            expect(sample.panel!.animations).toBe(0);
            // Neither surface starts a transition on its first paint.
            expect(sample.node!.animations).toBe(0);
        }

        const measurement = await measure();
        // The node uses the product class that carries the 340ms geometry transition.
        expect(measurement.productionStyle.nodeClassName).toContain("node-element");
        expect(measurement.productionStyle.nodeTransitionDuration).toBe("0.34s, 0.34s, 0.34s");
        // The panel only animates after its first paint.
        expect(measurement.productionStyle.animated).toBe(true);
        expect(measurement.productionStyle.transitionDuration).toBe("0.34s, 0.34s");
        expect(measurement.productionStyle.animations).toBe(0);
        // These values only exist in src/styles/globals.css; the harness page
        // supplies no layout CSS of its own.
        expect(measurement.productionStyle.sheetHasPanelRule).toBe(true);
        expect(measurement.productionStyle.position).toBe("absolute");
        expect(measurement.productionStyle.overflowY).toBe("auto");
        expect(measurement.productionStyle.maxWidth).toBe("calc(100% - 24px)");
    });

    test("switching the node ratio animates several frames while node and panel stay attached", async () => {
        await mountHarness();
        // Patch early, then sample through the 340ms geometry transition.
        const samples = await recordFrames(40, { atFrame: 2, kind: "patch-ratio", size: "1:1" });

        const panelFrames = samples.filter((sample) => sample.hasPanel);
        const nodeWidths = panelFrames.map((sample) => Math.round(sample.node!.width));
        const panelWidths = panelFrames.map((sample) => Math.round(sample.panel!.width));
        expect(new Set(nodeWidths).size).toBeGreaterThanOrEqual(4);
        expect(new Set(panelWidths).size).toBeGreaterThanOrEqual(4);
        expect(nodeWidths).toContain(720);
        expect(nodeWidths).toContain(420);
        // At least one intermediate frame must be mid-transition for both surfaces.
        expect(nodeWidths.some((width) => width !== 720 && width !== 420)).toBe(true);
        expect(panelWidths.some((width) => width !== 920 && width !== 660)).toBe(true);
        expect(panelFrames.some((sample) => sample.panel!.animations > 0)).toBe(true);
        expect(panelFrames.some((sample) => sample.node!.animations > 0)).toBe(true);
        // Every sampled paint, including intermediate ones, keeps the panel
        // attached to the node of that same frame.
        for (const sample of panelFrames) {
            const node = sample.node!;
            expect(Math.abs(sample.panel!.top - (node.bottom + 16))).toBeLessThan(1.5);
            expect(Math.abs(sample.panel!.left + sample.panel!.width / 2 - (node.left + node.width / 2))).toBeLessThan(1.5);
        }

        await settle();
        const measurement = await measure();
        expect(measurement.node.width).toBeCloseTo(420, 0);
        expect(measurement.node.height).toBeCloseTo(420, 0);
        expect(measurement.inline.width).toBe("660px");
        expect(measurement.productionStyle.transitionDuration).toBe("0.34s, 0.34s");
        expect(measurement.productionStyle.animations).toBe(0);
        // Width and position come from the same layout pass; a stale width here
        // is what produces an off-center panel.
        expect(measurement.panel.left).toBeGreaterThanOrEqual(measurement.container.left + 16 - 0.5);
        expect(measurement.panel.right).toBeLessThanOrEqual(measurement.container.right - 16 + 0.5);
    });

    test("drag preview moves the panel with the node synchronously and release does not animate", async () => {
        await mountHarness({ node: { width: 480, height: 300, position: { x: 300, y: 180 } } });
        const initial = await measure();
        expect(initial.panel.width).toBeCloseTo(720, 0);

        const dragged = await page.evaluate(() => {
            const harness = (window as unknown as { panelHarness: { applyDrag: (preview: { x: number; y: number; nodeIds: Set<string> }) => void } }).panelHarness;
            // Same call the canvas selection controller makes per animation frame.
            harness.applyDrag({ x: 40, y: 30, nodeIds: new Set(["panel-node"]) });
            // Measure inside the same task: the panel must already be at the
            // dragged position instead of easing toward it.
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            const node = document.querySelector<HTMLElement>('[data-testid="canvas-node"]')!;
            const panelRect = panel.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            return {
                panel: { left: panelRect.left, top: panelRect.top, width: panelRect.width },
                node: { left: nodeRect.left, top: nodeRect.top, bottom: nodeRect.bottom, width: nodeRect.width },
                transform: panel.style.transform,
                panelTransition: getComputedStyle(panel).transitionDuration,
                nodeTransition: getComputedStyle(node).transitionDuration,
                panelAnimations: panel.getAnimations().length,
                nodeAnimations: node.getAnimations().length,
            };
        });

        expect(dragged.node.left).toBeCloseTo(340, 0);
        expect(dragged.panel.left).toBeCloseTo(340 + 240 - 360, 0);
        expect(dragged.panel.top).toBeCloseTo(210 + 300 + 16, 0);
        expect(dragged.panel.left + dragged.panel.width / 2).toBeCloseTo(dragged.node.left + dragged.node.width / 2, 1);
        // Drag must not start the geometry transition on either surface.
        expect(dragged.panelTransition).toBe("0s");
        expect(dragged.nodeTransition).toBe("0s");
        expect(dragged.panelAnimations).toBe(0);
        expect(dragged.nodeAnimations).toBe(0);

        const followed = await page.evaluate(() => {
            const harness = (window as unknown as { panelHarness: { applyDrag: (preview: { x: number; y: number; nodeIds: Set<string> }) => void } }).panelHarness;
            harness.applyDrag({ x: 84, y: 51, nodeIds: new Set(["panel-node"]) });
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            return { transform: panel.style.transform, transitionDuration: getComputedStyle(panel).transitionDuration, animations: panel.getAnimations().length };
        });
        expect(followed.transform).toBe("translate3d(264px, 547px, 0px)");
        expect(followed.transitionDuration).toBe("0s");
        expect(followed.animations).toBe(0);

        // Release: the canvas commits the moved geometry in the same task and
        // clears the preview. Transitions must stay off through that paint.
        const dropped = await page.evaluate(() => {
            const harness = (window as unknown as { panelHarness: { applyDrag: (preview: null) => void; setNodeGeometry: (geometry: { width: number; height: number; position: { x: number; y: number } }) => void } }).panelHarness;
            harness.applyDrag(null);
            harness.setNodeGeometry({ width: 480, height: 300, position: { x: 384, y: 231 } });
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            const node = document.querySelector<HTMLElement>('[data-testid="canvas-node"]')!;
            return {
                panelTransition: getComputedStyle(panel).transitionDuration,
                nodeTransition: getComputedStyle(node).transitionDuration,
                panelAnimations: panel.getAnimations().length,
                nodeAnimations: node.getAnimations().length,
            };
        });
        expect(dropped.panelTransition).toBe("0s");
        expect(dropped.nodeTransition).toBe("0s");
        expect(dropped.panelAnimations).toBe(0);
        expect(dropped.nodeAnimations).toBe(0);

        await settle();
        await settle();
        const released = await measure();
        expectPanelAttachedBelow(released);
        expect(released.panel.left).toBeCloseTo(384 + 240 - 360, 0);
        expect(released.panel.top).toBeCloseTo(231 + 300 + 16, 0);
        expect(released.productionStyle.animations).toBe(0);
        expect(released.productionStyle.nodeAnimations).toBe(0);
        // Once the drop has painted, the next geometry change animates again.
        expect(released.productionStyle.transitionDuration).toBe("0.34s, 0.34s");
        expect(released.productionStyle.nodeTransitionDuration).toBe("0.34s, 0.34s, 0.34s");
    });

    test("manual node resize keeps both surfaces at 0s and re-enables afterwards", async () => {
        await mountHarness({ node: { width: 480, height: 300, position: { x: 300, y: 180 } } });
        // The prompt panel defaults: width = nodeWidth * 1.5 clamped to 660..920.
        const expectedWidth = (nodeWidth: number) => `${Math.min(920, Math.max(660, Math.round(nodeWidth * 1.5)))}px`;
        await page.evaluate(() => (window as unknown as { panelHarness: { setNodeResizing: (active: boolean) => void } }).panelHarness.setNodeResizing(true));

        for (const width of [520, 560, 600]) {
            await page.evaluate((nodeWidth) => (window as unknown as { panelHarness: { setNodeGeometry: (geometry: { width: number; height: number; position: { x: number; y: number } }) => void } }).panelHarness.setNodeGeometry({ width: nodeWidth, height: 300, position: { x: 300, y: 180 } }), width);
            await settle();
            const measurement = await measure();
            // One resize step: width and position must already agree, with no
            // transition easing toward the new geometry.
            expect(measurement.inline.width).toBe(expectedWidth(width));
            expectPanelAttachedBelow(measurement);
            expect(measurement.productionStyle.transitionDuration).toBe("0s");
            expect(measurement.productionStyle.animations).toBe(0);
            expect(measurement.productionStyle.nodeTransitionDuration).toBe("0s");
            expect(measurement.productionStyle.nodeAnimations).toBe(0);
        }

        await page.evaluate(() => (window as unknown as { panelHarness: { setNodeResizing: (active: boolean) => void } }).panelHarness.setNodeResizing(false));
        await settle();
        await settle();
        const settled = await measure();
        expect(settled.productionStyle.transitionDuration).toBe("0.34s, 0.34s");
        expect(settled.productionStyle.nodeTransitionDuration).toBe("0.34s, 0.34s, 0.34s");
        expectPanelAttachedBelow(settled);
    });

    test("canvas pan/zoom disables transitions and the panel follows in the same pass", async () => {
        await mountHarness({ node: { width: 480, height: 300, position: { x: 300, y: 180 } } });
        await page.evaluate(() => (window as unknown as { panelHarness: { setViewportInteracting: (active: boolean) => void } }).panelHarness.setViewportInteracting(true));

        const zoomed = await page.evaluate(() => {
            const harness = (window as unknown as { panelHarness: { applyLiveViewport: (viewport: { x: number; y: number; k: number }) => void } }).panelHarness;
            // Mirrors a live wheel-zoom/pan frame: world transform + graphics event.
            harness.applyLiveViewport({ x: 0, y: -60, k: 1.5 });
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            const node = document.querySelector<HTMLElement>('[data-testid="canvas-node"]')!;
            const panelRect = panel.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            return {
                panel: { left: panelRect.left, top: panelRect.top, width: panelRect.width },
                node: { left: nodeRect.left, bottom: nodeRect.bottom, width: nodeRect.width },
                panelTransition: getComputedStyle(panel).transitionDuration,
                nodeTransition: getComputedStyle(node).transitionDuration,
                panelAnimations: panel.getAnimations().length,
                nodeAnimations: node.getAnimations().length,
            };
        });

        expect(zoomed.node.left).toBeCloseTo(300 * 1.5, 0);
        expect(zoomed.panel.width).toBeCloseTo(920, 0);
        expect(zoomed.panel.top).toBeCloseTo(-60 + (180 + 300) * 1.5 + 16, 0);
        expect(zoomed.panel.left + zoomed.panel.width / 2).toBeCloseTo(zoomed.node.left + zoomed.node.width / 2, 1);
        // A transition here would lag the compositor world transform.
        expect(zoomed.panelTransition).toBe("0s");
        expect(zoomed.nodeTransition).toBe("0s");
        expect(zoomed.panelAnimations).toBe(0);
        expect(zoomed.nodeAnimations).toBe(0);

        await page.evaluate(() => (window as unknown as { panelHarness: { setViewportInteracting: (active: boolean) => void } }).panelHarness.setViewportInteracting(false));
        // Gesture end commits the same camera; the world layer and the panel
        // targets stay put and the transition is safe to re-enable.
        await page.evaluate(() => (window as unknown as { panelHarness: { setViewport: (viewport: { x: number; y: number; k: number }) => void } }).panelHarness.setViewport({ x: 0, y: -60, k: 1.5 }));
        await settle();
        await settle();
        const restored = await measure();
        expect(restored.productionStyle.transitionDuration).toBe("0.34s, 0.34s");
        expect(restored.productionStyle.nodeTransitionDuration).toBe("0.34s, 0.34s, 0.34s");
        expect(restored.productionStyle.animations).toBe(0);
        expectPanelAttachedBelow(restored);

        await page.evaluate(() => (window as unknown as { panelHarness: { setContainerSize: (size: { width: number; height: number }) => void } }).panelHarness.setContainerSize({ width: 800, height: 700 }));
        await settle();
        const resized = await measure();
        // The panel is clamped into the narrower viewport instead of hanging
        // past the right edge (the production max-width also caps it at 776px).
        expect(resized.productionStyle.maxWidth).toBe("calc(100% - 24px)");
        expect(resized.panel.left).toBeGreaterThanOrEqual(resized.container.left + 16 - 0.5);
        expect(resized.panel.right).toBeLessThanOrEqual(resized.container.right - 8 + 0.5);
        expect(resized.panel.width).toBeCloseTo(resized.container.clientWidth - 24, 0);
    });

    test("real CanvasNode resize handle disables transitions on both surfaces", async () => {
        await page.goto(server.url.toString() + "real", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => Boolean((window as unknown as { mountPanelRealNodeHarness?: unknown }).mountPanelRealNodeHarness));
        await page.evaluate(() => (window as unknown as { mountPanelRealNodeHarness: (host: HTMLElement) => void }).mountPanelRealNodeHarness(document.getElementById("root") as HTMLElement));
        await page.waitForSelector("[data-canvas-node-panel]");
        await settle();

        const handle = await page.evaluate(() => {
            const node = document.querySelector<HTMLElement>('[data-node-id="resize-node"]');
            if (!node) return null;
            const candidates = [...node.querySelectorAll<HTMLElement>('[class*="cursor-nwse-resize"]')]
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width };
                })
                .sort((a, b) => (b.x + b.y) - (a.x + a.y));
            return candidates[0] ?? null;
        });
        expect(handle).not.toBeNull();
        expect(handle!.size).toBeGreaterThan(0);

        await page.mouse.move(handle!.x, handle!.y);
        await page.mouse.down();
        await page.mouse.move(handle!.x + 60, handle!.y + 45, { steps: 4 });
        await settle();
        const during = await page.evaluate(() => {
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            const node = document.querySelector<HTMLElement>('[data-node-id="resize-node"]')!;
            const container = document.querySelector<HTMLElement>('[data-testid="canvas-container"]')!;
            const panelRect = panel.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            return {
                resizing: container.dataset.canvasNodeResizing,
                panelTransition: getComputedStyle(panel).transitionDuration,
                nodeTransition: getComputedStyle(node).transitionDuration,
                panelAnimations: panel.getAnimations().length,
                nodeAnimations: node.getAnimations().length,
                panel: { left: panelRect.left, top: panelRect.top, width: panelRect.width },
                node: { left: nodeRect.left, bottom: nodeRect.bottom, width: nodeRect.width },
            };
        });
        expect(during.resizing).toBe("true");
        expect(during.panelTransition).toBe("0s");
        expect(during.nodeTransition).toBe("0s");
        expect(during.panelAnimations).toBe(0);
        expect(during.nodeAnimations).toBe(0);
        // The node grew from its bottom-right handle; the panel already follows.
        expect(during.node.width).toBeGreaterThan(480);
        expect(Math.abs(during.panel.top - (during.node.bottom + 16))).toBeLessThan(1.5);
        expect(Math.abs(during.panel.left + during.panel.width / 2 - (during.node.left + during.node.width / 2))).toBeLessThan(1.5);

        await page.mouse.up();
        await settle();
        await settle();
        const after = await page.evaluate(() => {
            const panel = document.querySelector<HTMLElement>("[data-canvas-node-panel]")!;
            const node = document.querySelector<HTMLElement>('[data-node-id="resize-node"]')!;
            const container = document.querySelector<HTMLElement>('[data-testid="canvas-container"]')!;
            return {
                resizing: container.dataset.canvasNodeResizing === "true",
                panelTransition: getComputedStyle(panel).transitionDuration,
                nodeTransition: getComputedStyle(node).transitionDuration,
                panelAnimations: panel.getAnimations().length,
                nodeAnimations: node.getAnimations().length,
            };
        });
        expect(after.resizing).toBe(false);
        expect(after.panelTransition).toBe("0.34s, 0.34s");
        expect(after.nodeTransition).toBe("0.34s, 0.34s, 0.34s");
        expect(after.panelAnimations).toBe(0);
        expect(after.nodeAnimations).toBe(0);
    });
});
