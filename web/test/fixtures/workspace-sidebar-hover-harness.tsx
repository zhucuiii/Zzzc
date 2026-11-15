import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App as AntApp, ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { ZzzcConnectionProvider } from "@/components/layout/zzzc-connection-provider";
import "@/styles/globals.css";
import "@/styles/beeftv-local-overrides.css";

// 侧边栏悬停展开验收环境：真实 AppWorkspaceShell + 真实 globals.css。
// 探针暴露给测试脚本：收起/固定展开侧栏（真实按钮路径）。
const probe = (window as any).__sidebarHoverProbe = {
    collapse() {
        document.querySelector(".app-workspace-sidebar-collapse-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    toggleRail() {
        document.querySelector(".app-workspace-sidebar-rail-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
