import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

const noop = () => {};
// Stable identity keeps the overlay's layout effect from re-running each render.
const STATIC_VIEWPORT = { x: 0, y: 0, k: 1 };

/**
 * Mounts the real CanvasNode (selected, so its resize handles exist) next to
 * the real panel overlay. Lets browser tests drag a resize handle and observe
 * the viewport resize flag and both surfaces without faking either.
 */
export function mountPanelRealNodeHarness(host: HTMLElement) {
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [node, setNode] = useState<CanvasNodeData>({
            id: "resize-node",
            type: CanvasNodeType.Image,
            title: "画面",
            position: { x: 300, y: 180 },
            width: 480,
            height: 300,
            metadata: {},
        });
        const [panelOpen, setPanelOpen] = useState(false);
        // The canvas page hands CanvasNode a stable onNodeResize callback. Keep
        // the same identity here so a resize does not re-run the node's effect
        // cleanup, which is what production sees.
        const handleResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
            if (nodeId !== "resize-node") return;
            setNode((current) => ({ ...current, width, height, position: position || current.position }));
        }, []);

        useEffect(() => {
            setPanelOpen(true);
        }, []);

        return (
            <div
                ref={containerRef}
                data-canvas-viewport=""
                data-testid="canvas-container"
                style={{ position: "relative", width: 1400, height: 900, overflow: "hidden", background: "#111" }}
            >
                <div data-canvas-world-layer="" style={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}>
                    <CanvasNode
                        data={node}
                        scale={1}
                        isSelected
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        showImageInfo={false}
                        onMouseDown={noop}
                        onHoverStart={noop}
                        onHoverEnd={noop}
                        onConnectStart={noop}
                        onResize={handleResize}
                        onTitleChange={noop}
                        onContentChange={noop}
                        onContextMenu={noop}
                    />
                </div>
                {panelOpen ? (
                    <CanvasNodePanelOverlay node={node} viewport={STATIC_VIEWPORT} containerRef={containerRef} keepBelowNode panelHeight={120}>
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
