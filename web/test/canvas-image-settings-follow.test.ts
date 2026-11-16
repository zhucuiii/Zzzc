import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("../src/components/canvas/canvas-image-settings-popover.tsx", import.meta.url)).text();

// 图像设置浮层贴着输入框跟随。这类"跟随"出问题几乎都是同一个病根：
// 有两处代码同时在写位置，或者跟随路径里触发了重渲染 —— 前者让位置来回
// 打架、后者让主线程卡住，肉眼看到的就是"切比例时浮层顿一下"。
// 下面把这两条钉死。
describe("image settings popover follow", () => {
    test("follow loop never triggers a React re-render", () => {
        const trackStart = source.indexOf("const track = () => {");
        expect(trackStart).toBeGreaterThan(-1);
        // 循环体在函数内部，"};" 结束；用花括号配平找边界更稳。
        const trackEnd = source.indexOf("\n        };", trackStart);
        expect(trackEnd).toBeGreaterThan(trackStart);
        const loop = source.slice(trackStart, trackEnd);
        // 只看代码，注释里提到这些名字（解释为什么不用）不算违规。
        const code = loop
            .split("\n")
            .filter((line) => !line.trim().startsWith("//"))
            .join("\n");

        // 跟随循环里只能写 CSS 变量，绝不能 setState。
        expect(code).not.toContain("setButtonRect");
        expect(code).not.toContain("setOpen");
        // 也不该读面板布局属性（每帧强制重排）。
        expect(code).not.toContain("offsetWidth");
        expect(code).not.toContain("offsetHeight");
        expect(code).toContain("--panel-live-offset");
        expect(code).toContain("--panel-live-left");
    });

    test("React style carries no competing left/top/bottom position", () => {
        const styleStart = source.indexOf("const style = {");
        expect(styleStart).toBeGreaterThan(-1);
        const styleEnd = source.indexOf("} as const;", styleStart);
        const style = source.slice(styleStart, styleEnd);

        // 位置只能有一个来源：CSS 变量。若这里再写 left/top/bottom，
        // React 每次渲染都会把位置打回旧值，下一帧又被变量拉回来。
        expect(style).not.toMatch(/^\s*left:/m);
        expect(style).not.toMatch(/^\s*top:/m);
        expect(style).not.toMatch(/^\s*bottom:/m);
        expect(style).toContain("--panel-live-left");
        expect(style).toContain("--panel-live-offset");
    });

    test("the anchor is never re-synced while the popover is open", () => {
        // 尺寸变化只影响高度上限，而高度上限在挂载时就锁死了；
        // 再让 ResizeObserver 去 syncPosition，切比例那 260ms 里会
        // 连续十几次重渲染，浮层高度也跟着跳 —— 位置跟上了，底部还是在顿。
        expect(source).not.toContain("new ResizeObserver");
    });

    test("React writes no max-height, so the CSS calc can own it", () => {
        const styleStart = source.indexOf("const style = {");
        const styleEnd = source.indexOf("} as const;", styleStart);
        const style = source.slice(styleStart, styleEnd);

        // 内联 max-height 会盖掉 CSS 的 calc，浮层在内容变高时就向下溢出，
        // 压住下面的输入框。上限必须只由 CSS 从位置变量推导。
        expect(style).not.toContain("maxHeight");
        expect(source).not.toContain("const [maxHeight]");
    });

    test("the popover stylesheet derives max-height from the live offset", async () => {
        const css = await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text();
        const topRule = css.slice(css.indexOf('.canvas-image-settings-popover[data-side="top"]'));
        const rule = topRule.slice(0, topRule.indexOf("}"));

        // 上限与位置同源，浮层就不可能在内容变高时越过触发按钮往下压。
        expect(rule).toContain("calc(100vh - var(--panel-live-offset");
    });
});
