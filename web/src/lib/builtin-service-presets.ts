import type { ModelCapability } from "@/stores/use-config-store";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";

export type BuiltinModelProfile = {
    model: string;
    displayName?: string;
    capability?: string;
    protocol?: string;
    authType?: string;
    capabilityConfig?: unknown;
};

export type BuiltinPresetModel = {
    model: string;
    displayName?: string;
    capability?: string;
    protocol?: string;
    /** 预置模型自带的生成参数；写进渠道档案的 capabilityConfig。 */
    capabilityConfig?: unknown;
    /** 该模型的默认生成选项。 */
    defaultOptions?: Record<string, unknown>;
};

// 内置插件在设置页里的行为都从这里查表：归属判定、预置模型、协议可用性、
// 新建渠道和旧档案升级。加新的内置插件时只加一条，不用再改每个调用点。
export type BuiltinPresetPlugin = {
    /** 这个插件的协议都以这些前缀开头。 */
    protocolPrefixes: string[];
    hosts: string[];
    hostSuffixes: string[];
    /** 没有显式声明接口时，按能力给的默认协议。 */
    candidates: Partial<Record<ModelCapability, string>>;
    models: readonly BuiltinPresetModel[];
    /** 新建渠道时的默认名称，也是「选择服务商」里的显示名。 */
    presetName: string;
    /** 新建渠道时的默认服务地址。 */
    presetBaseUrl: string;
    /** 用在「已预置 N 款…模型及协议」的说明里。 */
    presetDescription: string;
    /** 插件自己在 manifest 里声明了素材怎么传时，设置页不再显示手填字段。 */
    declaresReferenceMediaTransport: boolean;
    buildChannel: (args: { apiKey: string; baseUrl: string; selectedModels?: string[]; existingChannel?: unknown }) => { models: string[]; modelProfiles: BuiltinModelProfile[] };
    upgradeProfile: <T>(profile: T) => T;
};

/** 没有显式声明接口时按能力补的默认协议。 */
export const TEXT_AUDIO_CANDIDATES: Partial<Record<ModelCapability, string>> = { text: "chat-completion", audio: "openai-audio" };
export const COMPATIBLE_CANDIDATES: Partial<Record<ModelCapability, string>> = { ...TEXT_AUDIO_CANDIDATES, image: "openai-image" };

// LL2 与银盛云枢壹算两个内置渠道插件已移除。表保持为空，调用方通过
// builtinPreset() 拿到 undefined 后走普通第三方渠道的路径。
export const BUILTIN_PRESETS: Record<string, BuiltinPresetPlugin> = {};

export function builtinPreset(id: string): BuiltinPresetPlugin | undefined {
    return BUILTIN_PRESETS[id];
}

/** 按协议反查它属于哪个内置插件。 */
export function builtinPresetForProtocol(protocol?: string): BuiltinPresetPlugin | undefined {
    if (!protocol) return undefined;
    return Object.values(BUILTIN_PRESETS).find((plugin) => plugin.protocolPrefixes.some((prefix) => protocol.startsWith(prefix)));
}

/** 把旧档案依次交给每个内置插件升级；不属于自己的档案原样返回。 */
export function upgradeBuiltinModelProfile<T>(profile: T): T {
    return Object.values(BUILTIN_PRESETS).reduce((next, plugin) => plugin.upgradeProfile(next), profile);
}

/** 插件声明的协议是否都已经加载；没加载时不让「一键保存并启用」。 */
export function builtinProtocolsAvailable(id: string, protocols: ModelProtocolDefinition[]): boolean {
    const models = builtinPreset(id)?.models;
    if (!models) return true;
    return models.every((item) =>
        protocols.some((protocol) => protocol.value === item.protocol && protocol.capability === item.capability && protocol.enabled !== false),
    );
}
