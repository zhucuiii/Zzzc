import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasPopoverLayer } from "@/lib/canvas/canvas-popover-layer";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import type { AiConfig } from "@/stores/use-config-store";
import { seedreamFamily } from "@/lib/seedream-image";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    showCount?: boolean;
    summaryOverride?: string;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", showCount = true, summaryOverride }: CanvasImageSettingsPopoverProps) {
    const theme = canvasThemes[useActiveTheme()];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const profile = modelCapabilityConfigFor(config, config.model || config.imageModel).image!;
    const normalized = normalizeImageValue(profile, config);
    const seedream = seedreamFamily(config.model || config.imageModel);
    const summaryParts = [
        ...(seedream && config.seedreamMode === "layers" ? ["图层拆分"] : []),
        ...(profile.size.parameter !== "none" ? [imageSizeLabel(normalized.size, profile)] : []),
        ...(profile.quality.supported ? [imageQualityLabel(normalized.quality)] : []),
        ...(seedream && seedream !== "pro" && seedream !== "flash" && Number(config.seedreamMaxImages) > 1 ? [`每批最多 ${config.seedreamMaxImages} 张`] : []),
        ...(showCount && profile.maxOutputs > 1 ? [`${normalized.count} ${seedream ? "批" : "张"}`] : []),
        ...(profile.transparentBackground.supported && normalized.transparentBackground === "true" ? ["透明"] : []),
    ];
    const summary = summaryOverride || summaryParts.join(" · ");
    const hasSettings = profile.size.parameter !== "none" || profile.quality.supported || profile.transparentBackground.supported || (showCount && profile.maxOutputs > 1);
    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        // 浮层向上展开时应避开整个输入框，而不是只避开触发按钮 —— 按钮在
        // 输入框内部，拿它当锚点会让浮层盖住输入框上沿。优先取外层容器。
        const anchorOf = (node: HTMLElement | null): Element | null =>
            node?.closest(".canvas-node-composer") ?? node;
        const syncPosition = () => {
            const box = anchorOf(buttonRef.current)?.getBoundingClientRect();
            if (!box) {
                setButtonRect(null);
                return;
            }
            // 锚点换成整个输入框后宽度会大很多；浮层仍贴输入框的右侧，
            // 保持它原来相对设置按钮的位置感，而不是被拉到输入框最左边。
            setButtonRect(box);
        };
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
            setOpen(false);
            onOpenChange?.(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);

        // 输入框自己会做尺寸过渡（展开/收起、改比例时高度变化），window
        // resize 收不到。ResizeObserver 只在尺寸"定下来"时报一次，过渡中间
        // 那几十毫秒仍然对不齐，所以额外挂一条 rAF 跟踪：只要触发按钮的
        // 位置变了就同步，浮层才能真正逐帧贴住它，中间不会露缝。
        const trigger = buttonRef.current;
        let observer: ResizeObserver | undefined;
        if (trigger && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(syncPosition);
            observer.observe(trigger);
        }

        let frame = 0;
        let lastKey = "";
        const track = () => {
            frame = requestAnimationFrame(track);
            const box = trigger?.getBoundingClientRect();
            if (!box) return;
            // 四舍五入到 0.5px，避免亚像素抖动导致的无谓 setState。
            const key = `${Math.round(box.top * 2)}|${Math.round(box.left * 2)}|${Math.round(box.width * 2)}|${Math.round(box.height * 2)}`;
            if (key === lastKey) return;
            lastKey = key;
            syncPosition();
        };
        frame = requestAnimationFrame(track);

        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            observer?.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [onOpenChange, open]);

    const panel = open && buttonRect ? <ImageSettingsPortal layer={canvasPopoverLayer(buttonRef.current)} buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} showCount={showCount} onConfigChange={onConfigChange} /> : null;

    if (!hasSettings) return null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button size="small" type="text" className={`canvas-generation-settings-trigger ${buttonClassName || "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"}`} style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} aria-expanded={open} aria-label={`高级设置：${summary}`} title={`高级设置 · ${summary}`} onClick={() => updateOpen(!open)}>
                    <span className="truncate">{summary}</span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function ImageSettingsPortal({
    layer,
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    showCount,
    onConfigChange,
}: {
    layer: number | string;
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    showCount: boolean;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
}) {
    const resetImageSettings = useCreationPreferencesStore((state) => state.resetImageSettings);
    const gap = 8;
    const margin = 12;
    const width = Math.min(420, window.innerWidth - margin * 2);
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    // 锚点是整个输入框时，"左对齐"会把浮层拉到输入框最左边，离设置按钮很远。
    // 贴着输入框右侧展开更贴近原来的视觉关系，也不会跨到画布另一侧。
    const left = alignCenter
        ? buttonRect.left + buttonRect.width / 2 - width / 2
        : alignRight || buttonRect.width > width * 1.5
            ? buttonRect.right - width
            : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: layer,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
        background: theme.canvas.background,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 10,
        boxShadow: `0 24px 72px ${theme.spatial.shadow}`,
        padding: 12,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            // 入场方向跟随浮层从触发按钮展开的那一侧，动画才和输入框的动作同源。
            data-side={topPlacement ? "top" : "bottom"}
            className="canvas-image-settings-popover aceternity-floating-panel backdrop-blur-2xl"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <ImageSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showCount={showCount} quickCount={3} className="space-y-3" />
            <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-[var(--fs-micro)]" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                <span className="truncate">当前参数已自动设为默认</span>
                <button
                    type="button"
                    className="shrink-0 cursor-pointer font-medium transition-opacity hover:opacity-80"
                    style={{ color: theme.accent.primary }}
                    onClick={() => resetImageSettings()}
                >
                    恢复初始默认
                </button>
            </div>
        </div>,
        document.body,
    );
}
