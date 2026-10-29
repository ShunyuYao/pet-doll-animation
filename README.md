# 桌宠角色制作 Skill / Pet Doll Animation Skill

从宠物照片或角色参考制作一致的 2D 毛绒角色、基础动作帧和可交互预览。技能包含本地 PNG 处理工具；生图由使用者在自己的环境中调用，仓库不包含模型凭据或角色素材。

Create a consistent 2D plush character, animation frames, and an interactive preview from pet photos or character references. Image generation runs in your own environment; this repository contains local frame-processing tools and no credentials or character assets.

## 安装 / Install

将仓库克隆到 Codex 的个人技能目录。已有同名目录时先备份自己的修改，再更新或另选安装位置。

```sh
git clone https://github.com/ShunyuYao/pet-doll-animation.git ~/.codex/skills/pet-doll-animation
cd ~/.codex/skills/pet-doll-animation/scripts
npm ci
```

Clone this repository into your personal Codex skills directory, then install the pinned local-tool dependencies in `scripts/`. If you already have a folder with that name, preserve your changes before updating it.

Use `$pet-doll-animation` in Codex with your reference photos. The workflow starts at [SKILL.md](SKILL.md). The tools require Node.js, Electron 43.8.4, and OpenCV.js 4.11.0-release.1; see [tool inputs and commands](references/tools.md). On a new platform, check Electron support before processing images.

## 交付流程 / Workflow

1. 确认角色基础图，再制作待机、走路、探头、抱起和带包裹移动。按 [动作策略](references/actions.md) 和 [画质验收](references/quality.md) 逐项检查。
2. 使用 `scripts/run.cjs` 准备请求、分析图集和生成透明帧；使用 `scripts/preview.cjs` 生成本地预览。详见 [工具契约](references/tools.md)。
3. 需要导入吐梨邦时，按 [产品导入说明](references/product-import.md) 转成目标产品接受的形象包，并在运行中的客户端验收。预览文件本身不是可导入形象包。

**导入位置：**把 `character.json` 和它引用的 PNG 放在同一个本地交付文件夹中（例如 `我的小猫/character.json`、`我的小猫/idle/frame00.png`）。文件夹可放在任意可读取的位置；从当前看板快捷栏「外观 → 导入形象」选择 `character.json`，产品会自行复制进「我的形象」。若已有 `.petappearance`，直接选择该文件。目录结构、文件命名和旧 `plugins` 路径的区别见[产品导入说明](references/product-import.md#素材放在哪里产品怎样找到)。

**交给 Agent：**如果你已要求制作并导入，Agent 会从成品目录找到 `character.json` 或 `.petappearance`，通过运行中产品的导入入口提交真实文件，核对「我的形象」中的结果；要求换上时还会应用并检查桌宠播放。你不需要自己在文件选择器里操作。完整步骤见[Agent 自动导入成品目录](references/product-import.md#agent-自动导入成品目录)。

**Import location:** Keep `character.json` and its referenced PNG frames together in any readable local folder, then select `character.json` through the current resident panel's **Appearance → Import Appearance** shortcut. The app copies valid frames into its own library. Alternatively, select an exported `.petappearance` file. See the [directory layout and import steps](references/product-import.md#素材放在哪里产品怎样找到).

**Agent handoff:** If you ask the agent to make and import a character, it selects the completed file from the output folder and imports it through the running app, then checks the library result. If you also ask to use the character, it applies it and checks desktop playback. You do not need to operate the file picker yourself.

确认基础形象和动作质量时，可参考已有公开作品 [刀盾小狗](https://github.com/ShunyuYao/pet-plugin-sword-shield) 的[动作表和预览](https://github.com/ShunyuYao/pet-plugin-sword-shield#11-个动作状态)：它展示了待机、移动、探头、收回和边缘停留等状态的最终效果与接缝。本技能的标准 2D 数据包流程与该作品的插件交付形式不同，需按目标产品实际导入契约转换。该项目的角色图片和音频有[独立来源与权利说明](https://github.com/ShunyuYao/pet-plugin-sword-shield/blob/main/ASSETS.md)；本仓库仅引用公开页面作参考，不复制素材。

For an example of finished character states and transitions, see the public [Sword & Shield Pup](https://github.com/ShunyuYao/pet-plugin-sword-shield) project. Its plugin packaging differs from the data-only appearance package described here. Its [asset provenance](https://github.com/ShunyuYao/pet-plugin-sword-shield/blob/main/ASSETS.md) applies to its character media; no media is copied into this repository.

## 范围 / Scope

默认制作 2D 帧，不执行 3D 建模或骨骼制作。输出的预览、动作帧和可导入形象包分别验收。用户照片、生成原图、处理结果及 API 凭据仅保存在使用者选择的本地位置，不提交到本仓库。

The default workflow creates 2D frames. Preview output, processed animation, and product import are separate deliverables. Keep private photos, generated images, output packages, and API credentials outside this repository.
