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
    // 面板横向定位与浮层里用的是同一套规则；抽出来供逐帧跟随复用，
    // 宽度用固定值而不是读 DOM，避免每帧强制重排。
    const panelWidthValue = Math.min(420, window.innerWidth - 24);
    const leftOf = (box: DOMRect) => Math.max(
        12,
        Math.min(
            window.innerWidth - panelWidthValue - 12,
            placement?.endsWith("Right")
                ? box.right - panelWidthValue
                : placement === "top" || placement === "bottom"
                    ? box.left + box.width / 2 - panelWidthValue / 2
                    : box.left,
        ),
    );

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
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

        // 输入框自己会做尺寸过渡（展开/收起、改比例时高度变化），
        // 光监听 window resize 收不到，浮层就会停在旧位置。用 ResizeObserver
        // 跟着触发按钮的盒模型走，浮层才能始终贴着它一起动。
        const trigger = buttonRef.current;
        let observer: ResizeObserver | undefined;
        if (trigger && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(syncPosition);
            observer.observe(trigger);
        }

        // 逐帧跟随：ResizeObserver 只在尺寸变化"落定"时报一次，加上 React
        // 需要一次渲染才写进 DOM，两段延迟叠起来就是看到的"慢半拍"。
        // 这里每帧读一次锚点，直接把定位值写成 CSS 变量；浮层用该变量定位，
        // 于是位置在同一帧就跟上，不经过 React 渲染周期。
        //
        // 但"同帧跟死"本身也会显得顿：节点几何（切比例）走的是
        // --canvas-geometry-motion 的 340ms 过渡，浮层如果每帧瞬贴，
        // 就变成节点在缓动、浮层在硬跟。所以变量由 CSS 过渡消费，
        // 时长与节点几何完全一致，两者才是同一种运动。
        let frame = 0;
        let lastTop = Number.NaN;
        let lastLeft = Number.NaN;
        const track = () => {
            frame = requestAnimationFrame(track);
            const panel = panelRef.current;
            const box = buttonRef.current?.getBoundingClientRect();
            if (!panel || !box) return;
            // 用浮点比较而非取整成 key：取整会把位移量化，慢速过渡时
            // 浮层要等位移动满一格才更新一次，表现为一顿一顿地追。
            if (box.top === lastTop && box.left === lastLeft) return;
            lastTop = box.top;
            lastLeft = box.left;
            const topPlacement = placement?.startsWith("top");
            panel.style.setProperty(
                "--panel-live-offset",
                topPlacement
                    ? `${window.innerHeight - box.top + 8}px`
                    : `${box.bottom + 8}px`,
            );
            // 横向也要逐帧跟：切比例时触发按钮会随节点宽度改变横坐标，
            // 只同步纵向会让浮层在水平方向滞后于按钮，看起来就是"滑一下才到"。
            // 宽度取面板自身定值（420 或窗口可用宽），不读 offsetWidth ——
            // 每帧读取布局属性会强制同步重排，反而更卡。
            panel.style.setProperty("--panel-live-left", `${leftOf(box)}px`);
            // 注意：这里不再逐帧更新高度上限。内容高度贴着上限时，上限每帧
            // 变动会让浮层自身高度跟着抖，产生肉眼可见的顿挫；而位置跟随
            // 已经足够，高度交给打开时确定的上限即可。
        };
        frame = requestAnimationFrame(track);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            observer?.disconnect();
        };
    }, [onOpenChange, open, placement]);

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
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
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
