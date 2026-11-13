import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App as AntApp, ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { ZzzcConnectionProvider } from "@/components/layout/zzzc-connection-provider";
import "@/styles/globals.css";
import "@/styles/beeftv-local-overrides.css";

// 侧边栏悬浮展开验收环境：真实 AppWorkspaceShell + 真实 globals.css。
// 探针暴露给测试脚本：读取浮层状态与几何，收起/展开侧栏，统计浮层实例。
const probe = (window as any).__sidebarHoverProbe = {
    layerState(): Record<string, unknown> {
        const layer = document.querySelector(".app-workspace-sidebar-hover-layer");
        if (!layer) return { exists: false };
        const style = getComputedStyle(layer);
        const slot = document.querySelector(".app-workspace-sidebar-slot");
        return {
            exists: true,
            state: layer.getAttribute("data-state"),
            hidden: layer.getAttribute("aria-hidden"),
            pointerEvents: style.pointerEvents,
            opacity: style.opacity,
            clipPath: style.clipPath,
            width: Math.round(layer.getBoundingClientRect().width),
            x: Math.round(layer.getBoundingClientRect().x),
            slotWidth: Math.round(slot?.getBoundingClientRect().width ?? 0),
        };
    },
    railState(): Record<string, unknown> {
        const rail = document.querySelector(".app-workspace-sidebar");
        const slot = document.querySelector(".app-workspace-sidebar-slot");
        const layer = document.querySelector(".app-workspace-sidebar-hover-layer");
        return {
            collapsed: slot?.classList.contains("is-collapsed") ?? null,
            railWidth: Math.round(rail?.getBoundingClientRect().width ?? 0),
            layerCount: document.querySelectorAll(".app-workspace-sidebar-hover-layer").length,
            layerIdentity: layer ? (layer.dataset.probeId = layer.dataset.probeId || Math.random().toString(36).slice(2)) : null,
        };
    },
    collapse() {
        document.querySelector(".app-workspace-sidebar-collapse-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    expandViaPin() {
        const layer = document.querySelector(".app-workspace-sidebar-hover-layer");
        layer?.querySelector(".app-workspace-sidebar-collapse-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    openMenuTitles(): string[] {
        const layer = document.querySelector(".app-workspace-sidebar-hover-layer");
        return layer ? [...layer.querySelectorAll(".app-workspace-nav-title")].map((el) => el.textContent || "") : [];
    },
};

function Harness() {
    return (
        <ConfigProvider theme={{ algorithm: undefined }}>
            <AntApp>
                <MemoryRouter initialEntries={["/"]}>
                    <ZzzcConnectionProvider>
                        <div style={{ height: "100dvh" }}>
                            <AppWorkspaceShell>
                                <div style={{ padding: 40 }}>工作区主体占位</div>
                            </AppWorkspaceShell>
                        </div>
                    </ZzzcConnectionProvider>
                </MemoryRouter>
            </AntApp>
        </ConfigProvider>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
