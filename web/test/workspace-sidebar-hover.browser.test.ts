import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// 侧边栏悬浮展开回归：验收常驻浮层架构，而不是复刻实现细节。
// 覆盖：单实例浮层、意图延迟、宽限收留、逐帧揭示动画、图钉固定、快速反复不重建 DOM。
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p && existsSync(p)));

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/workspace-sidebar-hover-harness.tsx"],
        target: "browser",
        define: {
            __APP_VERSION__: '"test"',
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"',
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"',
            "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"',
            "process.env.NODE_ENV": '"production"',
        },
        plugins: [{
            name: "aliases",
            setup(builder) {
                builder.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "test-url" }));
                builder.onLoad({ filter: /.*/, namespace: "test-url" }, () => ({ contents: 'export default "";', loader: "js" }));
                // excalidraw 的 index.css 走条件 exports，Bun.build 解析不到：直接指到 dist 产物。
                builder.onResolve({ filter: /^@excalidraw\/excalidraw\/index\.css$/ }, () => ({ path: Bun.resolveSync("../node_modules/@excalidraw/excalidraw/dist/prod/index.css", import.meta.dir) }));
                // CSS 改由 PostCSS 编译（同 h3 测试），避免 Bun.build 解析 globals.css 里的静态资源路径。
                builder.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "test-css-stub" }));
                builder.onLoad({ filter: /.*/, namespace: "test-css-stub" }, () => ({ contents: "export default {}", loader: "js" }));
                builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            },
        }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    // 用与 Vite 相同的 PostCSS 插件编译当前源码，而不是过期的 dist 产物。
    const cssPath = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind({ base: import.meta.dir + "/.." })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
        + readFileSync(import.meta.dir + "/../src/styles/beeftv-local-overrides.css", "utf8")
        + readFileSync(import.meta.dir + "/../src/styles/workspace-product.css", "utf8");

    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
            if (path === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
            if (path.startsWith("/api/")) return Response.json({ code: 0, data: {} });
            return new Response('<html><head><link rel="stylesheet" href="/harness.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
        },
    });

    browser = await chromium.launch({ executablePath: CHROME_CANDIDATES[0], headless: true });
}, 60000);

afterAll(async () => {
    await browser?.close();
    server?.stop(true);
});

async function newShellPage() {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => console.error("pageerror:", error.message));
    await page.goto(server.url.toString());
    await page.locator(".app-workspace-sidebar-slot").waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    return page;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("折叠态浮层常驻且隐藏：单实例、不参与命中、宽度与真实侧栏同源", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);

        const layer = await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState());
        expect(layer.exists).toBe(true);
        expect(layer.state).toBe("closed");
        expect(layer.hidden).toBe("true");
        expect(layer.pointerEvents).toBe("none");
        expect(layer.opacity).toBe("0");

        // 宽度同源：浮层宽 = 展开态真实侧栏宽（图钉固定时不跳变）
        await page.evaluate(() => (window as any).__sidebarHoverProbe.expandViaPin());
        await wait(500);
        const expanded = await page.evaluate(() => (window as any).__sidebarHoverProbe.railState());
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        const layerAfter = await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState());
        expect(layerAfter.exists).toBe(true);
        expect(Number(layerAfter.width)).toBeGreaterThan(0);
    } finally {
        await page.close();
    }
});

test("快速掠过不触发预览：意图延迟拦住误触", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);

        await page.mouse.move(700, 450);
        await wait(80);
        await page.mouse.move(30, 450);
        await wait(50); // 快速掠过，短于 120ms 意图延迟
        await page.mouse.move(700, 450);
        await wait(400);

        const layer = await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState());
        expect(layer.state).toBe("closed");
    } finally {
        await page.close();
    }
});

test("悬停展开：clip-path 连续揭示、菜单完整、指针在浮层内不收回", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);

        await page.mouse.move(30, 450);
        const frames: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 10; i++) {
            frames.push(await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState()));
            await wait(45);
        }

        // 前段仍是 closed（意图延迟），随后 data-state=open 且 clip-path 出现连续中间值
        const states = frames.map((f) => f.state);
        expect(states).toContain("closed");
        expect(states).toContain("open");
        const openFrames = frames.filter((f) => f.state === "open");
        const clips = openFrames.map((f) => String(f.clipPath));
        const hasMidTransition = clips.some((clip) => clip.includes("%") && !clip.startsWith("inset(0px 0%"));
        expect(hasMidTransition).toBe(true);

        // 展开完成后菜单文字完整
        await wait(300);
        const titles = await page.evaluate(() => (window as any).__sidebarHoverProbe.openMenuTitles());
        expect(titles.length).toBeGreaterThan(4);
        expect(titles).toContain("新建项目");
        expect(titles).toContain("首页");

        // 指针滑进浮层区域（仍在 slot 内）不收回
        await page.mouse.move(200, 450);
        await wait(400);
        const inLayer = await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState());
        expect(inLayer.state).toBe("open");
    } finally {
        await page.close();
    }
});

test("移开收回：连续反向过渡回到隐藏态", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(30, 450);
        await wait(500);

        await page.mouse.move(900, 450);
        const closeFrames: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 8; i++) {
            closeFrames.push(await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState()));
            await wait(45);
        }
        const states = closeFrames.map((f) => f.state);
        expect(states).toContain("open");
        expect(states).toContain("closed");
        const last = closeFrames[closeFrames.length - 1];
        expect(last.state).toBe("closed");
        expect(last.pointerEvents).toBe("none");
    } finally {
        await page.close();
    }
});

test("快速反复进出：浮层节点身份不变，无 DOM 重建，最终归位", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);

        const identity = await page.evaluate(() => (window as any).__sidebarHoverProbe.railState().layerIdentity);
        expect(identity).toBeTruthy();

        for (let i = 0; i < 12; i++) {
            await page.mouse.move(30, 450);
            await wait(70);
            await page.mouse.move(900, 450);
            await wait(70);
        }
        await wait(600);

        const rail = await page.evaluate(() => (window as any).__sidebarHoverProbe.railState());
        expect(rail.layerCount).toBe(1);
        expect(rail.layerIdentity).toBe(identity);
        expect(rail.collapsed).toBe(true);
        expect(rail.railWidth).toBeLessThan(120);
    } finally {
        await page.close();
    }
});

test("图钉固定展开：浮层卸载、侧栏展开宽度与浮层宽度一致", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(30, 450);
        await wait(500);

        const layerWidth = await page.evaluate(() => (window as any).__sidebarHoverProbe.layerState().width);
        await page.evaluate(() => (window as any).__sidebarHoverProbe.expandViaPin());
        await wait(600);

        const rail = await page.evaluate(() => (window as any).__sidebarHoverProbe.railState());
        expect(rail.collapsed).toBe(false);
        expect(Number(layerWidth)).toBe(rail.railWidth);
    } finally {
        await page.close();
    }
});
