# 运行工具与数据契约

依赖 Node、Electron43.8.4 和 OpenCV4.11.0-release.1。在 scripts 目录安装 package.json 的依赖；本机已有这些版本时可设置 PET_DOLL_NODE_MODULES 为对应 node_modules 绝对路径，免重复安装。运行工具不打开窗口、不调用生图服务，采用独立临时 Electron profile。首次跨平台使用需检查 Electron 支持条件。

所有输入用 JSON 文件，路径相对该 JSON；output 必须新建或为空。命令：

```text
node <skill>/scripts/run.cjs prepare job.json
node <skill>/scripts/run.cjs compile job.json
node <skill>/scripts/run.cjs analyze job.json
node <skill>/scripts/preview.cjs <作品目录>
```

基础 compile 输入：
```json
{"action":"base","sources":["raw/base.png"],"output":"result/base"}
```

动作 compile 输入结构（以下路径需替换；plan 必须来自实际标准化图）：
```json
{
  "action":"walk", "base":"result/base/01.png",
  "plan":{"bodyPlan":"quadruped","idleMode":"static","idleBreathing":true,"activeRegions":[]},
  "sources":["raw/walk.png"], "output":"result/walk"
}
```
该 plan 是无眨眼的结构示例，不能为了避开眼睛定位把有眼角色都改成 static。local-blink 须增加 faceBox 和两个 activeRegions。坐标均为基础图完整512画布的 [left,top,right,bottom]，0..1；眼区严格在 faceBox 内，总面积不超过全图6%，faceBox面积不超过50%。先看整图定位脸，再裁脸定位眼，裁剪坐标映射回整图；保存带框检查图。bodyPlan 可为 quadruped、biped、rigid-biped、legless、other；idleMode 为 local-blink/local-signal/static。rigid-biped 不允许呼吸。

prepare 同样提供 action/base/plan/output，额外增加：
```json
{
  "text":"此动作的用户意图或基础生成完整提示词",
  "brief":{"identity":"白色短毛黄绿色眼睛猫","style":"柔软真实毛绒","adaptations":{"idle":"微呼吸眨眼","walk":"四脚循环走路","peek":"侧面好奇弹出","drag":"自然抱起","send":"小包裹挂带携带"}},
  "refs":[{"file":"result/base/01.png","mime":"image/png","role":"confirmed-base"}],
  "model":"gpt-image-2","quality":"high"
}
```
这些字段合入同一 job，而非独立提交此片段。prepare 写出 requests.json、文本 prompt 和实际参考图（含步态/布局引导），生图时按顺序发送。基础 prepare 不需要 plan/base；refs 放原始身份照片。

compile 来源数量：base/peek/drag/眨眼各1张；四足 walk/send 各1张图集；双足各12张单姿势；static/signal idle 和 legless walk 为0张。来源 PNG，须先把 HEIC/JPEG 等实际解码转 PNG，禁止改扩展名假装转换。输入限制64MB/张、8192边长、32MP；输出512方形，原始输入保存 source-XX.png，clip.json 含实际尺寸/流程/播放元数据。自己的生成回执须另外记录模型、quality、prompt摘要、开始结束时间及重试原因，处理耗时不能代替生图耗时。

analyze 输入 {sources:[图集路径],output:诊断目录}，产出 layout.json 及有效 pose-XX.png；single:true 分析单图。rejected 是从0开始的坏相位。prepare 可加 repairPhase（0..11）与 neighbor（相邻有效PNG）生成单格补图请求。补好后再次 analyze single:true，确认身份/比例，将12张有效姿势按序放入 compile 的 poseSources，sources 仍保留原始图集。最多3格，每格一次；保留诊断和失败原图，不重做整套。

result 下按 base/idle/walk/peek/drag/send 存 clip.json 和 PNG。preview.cjs 生成 index.html 和 manifest.json，自动衍生缩回、边缘停留、说话。可直接本地打开 HTML，或用仅绑定127.0.0.1的静态服务打开；全部图片预加载后播放，支持动作切换、暂停、逐帧。该 manifest 不是宿主导入包。宿主若要求反向边缘坐标，应在明确的适配层镜像PNG并实测探头，不更改 canonical 原图。
