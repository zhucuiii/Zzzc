import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { applyCanvasLiveViewport, applyCanvasNodeDragPreview, type CanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { applyNodeConfigPatch } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData, type Position, type ViewportTransform } from "@/types/canvas";

export type PanelHarnessOptions = {
    node?: Partial<CanvasNodeData>;
    viewport?: ViewportTransform;
    containerSize?: { width: number; height: number };
};

export type PanelHarnessApi = {
    patchNode: (patch: Partial<CanvasNodeData["metadata"]>) => void;
    setNodeGeometry: (geometry: { width: number; height: number; position: Position }) => void;
    setContainerSize: (size: { width: number; height: number }) => void;
    setViewport: (viewport: ViewportTransform) => void;
    setViewportInteracting: (active: boolean) => void;
    setNodeResizing: (active: boolean) => void;
    applyDrag: (preview: CanvasNodeDragPreview | null) => void;
    applyLiveViewport: (viewport: ViewportTransform) => void;
};

/**
 * Mounts the real node-panel overlay next to a plain node element so browser
 * tests can drive node geometry, drag previews and live viewport events the
 * same way the canvas page does. No account, storage or model calls.
 */
export function mountNodePanelHarness(host: HTMLElement, options: PanelHarnessOptions = {}) {
    const initialNode: CanvasNodeData = {
        id: "panel-node",
        type: CanvasNodeType.Image,
        title: "画面",
        width: 720,
        height: 405,
        metadata: {},
        ...options.node,
        position: options.node?.position ?? { x: 240, y: 120 },
    };
    const initialViewport = options.viewport ?? { x: 0, y: 0, k: 1 };
    const initialSize = options.containerSize ?? { width: 1400, height: 900 };

    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [node, setNode] = useState<CanvasNodeData>(initialNode);
        const [viewport, setViewport] = useState<ViewportTransform>(initialViewport);
        const [containerSize, setContainerSize] = useState(initialSize);
        // Like a node click in the canvas: the viewport (and its ref) is already
        // committed before the panel mounts in a later commit.
        const [panelOpen, setPanelOpen] = useState(false);

        useEffect(() => {
            setPanelOpen(true);
        }, []);

        useEffect(() => {
            const api: PanelHarnessApi = {
                patchNode: (patch) => flushSync(() => setNode((current) => applyNodeConfigPatch(current, patch))),
                // Canvas pointer handlers flush their state synchronously; match
                // that so transition-start frames are deterministic in tests.
                setNodeGeometry: (geometry) => flushSync(() => setNode((current) => ({ ...current, width: geometry.width, height: geometry.height, position: geometry.position }))),
                setContainerSize,
                setViewport,
                setViewportInteracting: (active) => {
                    const container = containerRef.current;
                    if (!container) return;
                    if (active) container.dataset.canvasViewportInteracting = "true";
                    else delete container.dataset.canvasViewportInteracting;
                },
                setNodeResizing: (active) => {
                    const container = containerRef.current;
                    if (!container) return;
                    if (active) container.dataset.canvasNodeResizing = "true";
                    else delete container.dataset.canvasNodeResizing;
                },
                applyDrag: (preview) => applyCanvasNodeDragPreview(containerRef.current, preview),
                applyLiveViewport: (next) => applyCanvasLiveViewport(containerRef.current, next, false),
            };
            (window as unknown as { panelHarness?: PanelHarnessApi }).panelHarness = api;
            return () => {
                delete (window as unknown as { panelHarness?: PanelHarnessApi }).panelHarness;
            };
        }, []);

        return (
            <div
                ref={containerRef}
                data-canvas-viewport=""
                data-testid="canvas-container"
                style={{
                    position: "relative",
                    width: containerSize.width,
                    height: containerSize.height,
                    overflow: "hidden",
                    background: "#111",
                    // Mirrors the committed camera scale the canvas keeps on its viewport element.
                    ["--canvas-committed-scale" as string]: String(initialViewport.k),
                }}
            >
                <div
                    id="world"
                    data-canvas-world-layer=""
                    style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})` }}
                >
                    <div
                        data-node-id={node.id}
                        data-testid="canvas-node"
                        data-canvas-node-type={node.type}
                        data-node-selected="true"
                        className="node-element"
                        style={{ position: "absolute", left: 0, top: 0, transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height, background: "#2b2b2b" }}
                    />
                </div>
                {panelOpen ? (
                    <CanvasNodePanelOverlay node={node} viewport={viewport} containerRef={containerRef} keepBelowNode panelHeight={120}>
                        <div data-testid="panel-body" style={{ height: 120, background: "#202020" }} />
                    </CanvasNodePanelOverlay>
                ) : null}
            </div>
        );
    }

    const root = createRoot(host);
    root.render(<Harness />);
    return () => root.unmount();
}
