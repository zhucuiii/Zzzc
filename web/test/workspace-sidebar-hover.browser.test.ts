import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// 侧边栏悬停展开回归：验收“侧栏本体原地宽度过渡”这一交互契约。
// 覆盖：悬停时真实侧栏撑宽（非浮层）、连续宽度帧、意图延迟、宽限收回、
// localStorage 偏好不被悬停污染、快速反复最终归位。
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
            return new Response('<html><head><link rel="stylesheet" href="/harness.css"></head><body style="margin:0"><div id="root" class="app-user-workspace app-product-workspace"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
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

// 探针：读侧栏本体几何（而非任何浮层）。
async function railState(page: any) {
    return page.evaluate(() => {
        const slot = document.querySelector(".app-workspace-sidebar-slot");
        const rail = document.querySelector(".app-workspace-sidebar");
        return {
            slotW: Math.round(slot.getBoundingClientRect().width),
            railW: Math.round(rail.getBoundingClientRect().width),
            hover: slot.classList.contains("is-hover-preview"),
            hoverLayers: document.querySelectorAll(".app-workspace-sidebar-hover-layer").length,
            titles: [...rail.querySelectorAll(".app-workspace-nav-title")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent),
        };
    });
}

test("悬停展开：真实侧栏原地连续变宽、菜单文字完整、无浮层", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        const collapsed = await railState(page);
        expect(collapsed.railW).toBeLessThan(120);
        expect(collapsed.hoverLayers).toBe(0);

        await page.mouse.move(30, 450);
        // 逐帧采样宽度：必须出现 86 与 240 之间的连续中间值
        const widths: number[] = [];
        for (let i = 0; i < 12; i++) {
            widths.push((await railState(page)).railW);
            await wait(45);
        }
        expect(widths[0]).toBeLessThan(120);
        const settled = widths[widths.length - 1];
        expect(settled).toBeGreaterThan(200);
        const midValues = widths.filter((w) => w > 100 && w < 230);
        expect(midValues.length).toBeGreaterThan(0);

        await wait(300);
        const open = await railState(page);
        expect(open.titles.length).toBeGreaterThan(4);
        expect(open.titles).toContain("新建项目");
        expect(open.hover).toBe(true);
        expect(open.hoverLayers).toBe(0);
    } finally {
        await page.close();
    }
});

test("悬停不污染展开偏好：localStorage 仍记录折叠", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(30, 450);
        await wait(500);
        const persisted = await page.evaluate(() => localStorage.getItem("infinite-canvas:workspace-sidebar-collapsed"));
        expect(persisted).toBe("1");
    } finally {
        await page.close();
    }
});

test("快速掠过不触发：意图延迟拦住误触", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(700, 450);
        await wait(80);
        await page.mouse.move(30, 450);
        await wait(50); // 短于 120ms 意图延迟
        await page.mouse.move(700, 450);
        await wait(400);
        const state = await railState(page);
        expect(state.railW).toBeLessThan(120);
        expect(state.hover).toBe(false);
    } finally {
        await page.close();
    }
});

test("移开收回：连续宽度过渡回到折叠宽", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(30, 450);
        await wait(500);

        await page.mouse.move(900, 450);
        const widths: number[] = [];
        for (let i = 0; i < 10; i++) {
            widths.push((await railState(page)).railW);
            await wait(45);
        }
        expect(widths[0]).toBeGreaterThan(200);
        const last = widths[widths.length - 1];
        expect(last).toBeLessThan(120);
        const midValues = widths.filter((w) => w > 100 && w < 220);
        expect(midValues.length).toBeGreaterThan(0);
    } finally {
        await page.close();
    }
});

test("快速反复进出：最终回到折叠宽，无残留状态", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        for (let i = 0; i < 12; i++) {
            await page.mouse.move(30, 450);
            await wait(70);
            await page.mouse.move(900, 450);
            await wait(70);
        }
        await wait(700);
        const state = await railState(page);
        expect(state.railW).toBeLessThan(120);
        expect(state.hover).toBe(false);
        expect(state.hoverLayers).toBe(0);
    } finally {
        await page.close();
    }
});

test("点击收起按钮在悬停态可把侧栏真正固定收起", async () => {
    const page = await newShellPage();
    try {
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await wait(500);
        await page.mouse.move(30, 450);
        await wait(500);

        // 悬停态下侧栏顶部按钮是“收起”：点击即固定收起（写偏好）。
        // 鼠标仍停在侧栏上时预览会继续撑宽——移开后应平滑回到折叠宽。
        await page.evaluate(() => (window as any).__sidebarHoverProbe.collapse());
        await page.mouse.move(900, 450);
        await wait(700);
        const state = await railState(page);
        expect(state.railW).toBeLessThan(120);
        expect(state.hover).toBe(false);
        const persisted = await page.evaluate(() => localStorage.getItem("infinite-canvas:workspace-sidebar-collapsed"));
        expect(persisted).toBe("1");
    } finally {
        await page.close();
    }
});
