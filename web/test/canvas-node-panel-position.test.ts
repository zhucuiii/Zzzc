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

    test("computes the first-selection position during render instead of relying on a (0,0) default", () => {
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

        // 920px panel centered under the 720px node at (240,120).
        expect(html).toContain("transform:translate3d(140px, 541px, 0)");
        expect(html).toContain("width:920px");
        expect(html).not.toContain("translate3d(0px, 0px, 0)");
        // The geometry transition is enabled only after the first paint.
        expect(html).not.toContain("data-panel-animated");
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
