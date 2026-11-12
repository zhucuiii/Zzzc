# Zzzc

基于 [BeefTV](https://github.com/glanderness/BeefTV) v2.2.1 二次开发的 AI 视频创作工作台。

## 本地运行

```bash
docker compose -f docker-compose.dev.yml up -d
```

前端 `http://localhost:3000`，后端 `http://127.0.0.1:8080`。

注意：Windows 挂载卷下 `air` 和 `vite` 收不到文件变更通知，改完代码需要手动重启：

```bash
docker compose -f docker-compose.dev.yml restart backend web
```

## 相对上游的主要改动

**界面与品牌**
- 所有用户可见文案替换为 Zzzc
- 连接模块整体重构：`beeftv-connection` → `zzzc-connection`
- 移除「登录 BeefTV」入口与官方算力渠道
- 移除 LL2 (DMC)、银盛云枢算两个服务商入口（插件包保留）

**画布交互**
- 切换宽高比时，节点框与下方输入面板平滑联动，中心点不漂移
- 拖动节点时输入面板跟随，不再卸载重建
- 拖拽与画布缩放期间关闭过渡，保持 60fps 跟手
- 图像设置面板隐藏滚动条
- 模型服务弹窗固定高度，切换服务商不再跳动

详细逐条改动见各文件的 `二次开发：` 注释。
