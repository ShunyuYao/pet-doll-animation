处理器来源：desktop_pet Test 提交 51dd3ccee85ef76953423dbf561ec60ce754f55b。

复用 stable-motion-v3/version2 的像素处理、布局分析、步态引导和请求模板。ai-motion-plan.js 仅保留坐标验证，去掉读图网络调用；ai-frames.js 去掉未调用的宿主专用 mirrorPng，避免宿主导入依赖。其余模块按原文件复制。运行工具不包含模型调用、网关地址、凭据或私人素材。

[本次打包验证](verification.md)记录工具执行证据与未覆盖范围。
