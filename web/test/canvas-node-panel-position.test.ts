import { describe, expect, test } from "bun:test";
import { createElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CANVAS_MAIN_DOCK_CLEARANCE, CanvasNodePanelOverlay, getNodePanelPosition } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const mediaNode = {
    id: "image-node",
    type: CanvasNodeType.Image,
    position: { x: 240, y: 580 },
    width: 480,
    height: 160,
} as CanvasNodeData;

describe("canvas media prompt panel placement", () => {
    test("keeps the panel below the node even when it extends past the viewport", () => {
        const position = getNodePanelPosition(
            mediaNode,
            { x: 0, y: 0, k: 1 },
            { width: 1200, height: 700 },
            660,
            190,
            undefined,
            true,
        );

        expect(position.placement).toBe("below");
        expect(position.top).toBe(756);
    });

    test("wires the fixed-below policy to all media prompt panels", async () => {
        const source = await Bun.file(new URL("../src/pages/canvas/project.tsx", import.meta.url)).text();

        expect(source).toContain("keepBelowNode={dialogNode.type === CanvasNodeType.Image || dialogNode.type === CanvasNodeType.Video || dialogNode.type === CanvasNodeType.Audio}");
    });

    test("never ships a (0,0) parked position and leaves geometry to the layout effect", () => {
        const node = {
            id: "image-ratio",
            type: CanvasNodeType.Image,
            position: { x: 240, y: 120 },
            width: 720,
            height: 405,
        } as CanvasNodeData;
        const containerRef = { current: { clientWidth: 1400, clientHeight: 900 } } as unknown as RefObject<HTMLDivElement | null>;
        const html = renderToStaticMarkup(
            createElement(CanvasNodePanelOverlay, { node, viewport: { x: 0, y: 0, k: 1 }, containerRef, keepBelowNode: true }, createElement("span")),
        );

        // 位置和宽度全部由 useLayoutEffect 在绘制前写入，渲染阶段不写。
        // 这也正是当初"面板从错误位置飞进来"的根因：渲染时 containerRef 还是
        // null，clientWidth 为 0，算出来是错的位置。
        expect(html).not.toContain("translate3d(0px, 0px, 0)");
        expect(html).not.toContain("width:920px");
        // 过渡只在首次绘制之后才打开，所以初始标记里不该有。
        expect(html).not.toContain("data-panel-animated");
        // 位置可以复现：目标位置与该节点在视口中的几何一致。
        const position = getNodePanelPosition(node, { x: 0, y: 0, k: 1 }, { width: 1400, height: 900 }, 920, 0, undefined, true);
        expect(position.left).toBe(140);
        expect(position.top).toBe(541);
    });

    test("video trim panel stays above the main dock without flipping over the node", () => {
        const videoNode = {
            id: "video-1790252932340-pga5v",
            type: CanvasNodeType.Video,
            position: { x: 200, y: 420 },
            width: 720,
            height: 360,
        } as CanvasNodeData;
        const position = getNodePanelPosition(
            videoNode,
            { x: 0, y: 0, k: 1 },
            { width: 1440, height: 900 },
            540,
            104,
            undefined,
            true,
            true,
        );

        expect(position.placement).toBe("below");
        expect(position.top).toBe(900 - 104 - CANVAS_MAIN_DOCK_CLEARANCE);
        expect(position.top + 104).toBeLessThanOrEqual(900 - CANVAS_MAIN_DOCK_CLEARANCE);
    });
});
