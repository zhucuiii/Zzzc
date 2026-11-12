import { LoaderCircle, UserRound } from "lucide-react";
import { useState } from "react";

import { useZzzcConnection } from "@/components/layout/zzzc-connection-provider";
import { AccountSettingsModal } from "@/components/account-settings/account-settings-modal";
import { cn } from "@/lib/utils";
import { isZzzcAuthenticated } from "@/services/api/zzzc-connection";

export function WorkspaceSidebarAccount({ collapsed }: { collapsed: boolean }) {
    const [open, setOpen] = useState(false);
    const account = useZzzcConnection();
    const { connection, loading } = account;
    const connected = isZzzcAuthenticated(connection);
    const pending = connection?.state === "pending" || connection?.state === "connecting";
    const name = connection?.account?.display_name || connection?.account?.username || connection?.account?.email || "Zzzc 账户";
    const label = loading ? "正在读取账户" : connected ? name : pending ? "等待登录确认" : "登录 Zzzc";

    return <>
        <button
            type="button"
            className={cn("app-workspace-nav-link app-workspace-official-account group relative flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] text-foreground/62 hover:bg-surface-hover hover:text-foreground", collapsed && "is-collapsed")}
            style={collapsed ? undefined : { paddingLeft: 10 }}
            disabled={loading}
            aria-label={connected ? `Zzzc 账户：${name}` : label}
            title={connected ? `Zzzc 账户：${name}` : label}
            onClick={() => setOpen(true)}
        >
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                <span className="app-workspace-nav-icon" aria-hidden="true">
                    {pending ? <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.8} /> : <UserRound className="size-4" strokeWidth={1.8} />}
                </span>
                {!collapsed ? <span className="app-workspace-nav-title truncate">{label}</span> : null}
            </span>
        </button>
        <AccountSettingsModal open={open} onClose={() => setOpen(false)} />
    </>;
}
