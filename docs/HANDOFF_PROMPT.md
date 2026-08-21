# 🔁 新对话交接提示词（跨会话继续开发的正确姿势）

> 对话有上下文限制，但**项目不会失忆**：代码在磁盘 + GitHub，知识在文档。
> 新开一个对话时，把下面的提示词整段粘贴给 AI，它读文件后就能无缝接手。
> 用法：复制「通用模板」，把【】里的内容替换成你要做的任务。

---

## 通用模板（复制这段）

```
我在继续开发一个已有项目「找眼镜助手」（帮人找回丢失眼镜的智能助手）。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读这些文件了解现状（用 read 工具按顺序读）：
1. docs/PROJECT_PROGRESS.md —— 项目进度、目录结构、任务池
2. DEVELOPMENT.md —— 协作规范（模块边界/命名/测试要求）
3. docs/SDD.md —— 架构与全部接口契约
4. docs/SURVEY.md —— 调查问卷设计与结论（如任务与问卷有关）
5. miniprogram/README.md —— 小程序开发约定（如任务涉及小程序）

本次任务：【用一句话写清楚要做什么】

要求：
1. 严格遵守 DEVELOPMENT.md 规范，不越界改别人的模块
2. 后端改接口要同步更新 docs/SDD.md 接口表
3. 改完必须运行 node --test，全绿才算完成
4. 提交信息格式：feat(模块): 中文说明（用 git 提交）
5. 绝不改动 .env；绝不把 .env 内容粘贴出来
6. 先读文档和现有代码，再动手；拿不准的地方先问
```

## 示例：成员 A 的任务（已填好，直接复制可用）

```
我在继续开发一个已有项目「找眼镜助手」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读：
1. docs/PROJECT_PROGRESS.md（重点看第 7 节任务池中"成员 A"的待办）
2. DEVELOPMENT.md
3. docs/SDD.md
4. docs/SURVEY.md（问卷第 10/11/14 题结论会影响画像页设计）
5. miniprogram/README.md

本次任务：完成成员 A 的待办——微信小程序「个性化智能体」页
（miniprogram/pages/profile/，当前是占位页）。
功能对齐 Web 版 public/js/views/profile.view.js：
- 智能体昵称/风格/生活习惯/常用地点/备注 的表单编辑（调 PUT /api/auth/profile）
- 家庭布局编辑器：房间增删改 + 6×6 户型图拖拽摆放
  （小程序用 movable-area/movable-view 实现拖拽，坐标 x/y 与 Web 版一致）
- 户型预览网格 + 保存
- 若问卷第 14 题隐私接受度低，页面底部加一句"数据仅用于本地推理"说明
接口参考：PUT /api/auth/profile（homeLayout 支持 x/y），见 docs/SDD.md。
要求：
1. 每页四件套 js/wxml/wxss/json；样式风格参考 pages/home/home.wxss
2. 后端零改动（接口已就绪）；不改其他页面
3. 完成后运行 node --test（后端测试应 55 项全绿，小程序页无测试但需 node --check 语法通过）
4. git 提交：feat(mp): 小程序画像页（表单+movable-view户型拖拽）
5. 给出"我怎么在微信开发者工具里验证"的步骤清单
```

---

## 三个注意事项

1. **新对话没有记忆**：AI 不会自动知道我们聊过什么，一切以仓库文档为准——所以重要决定都要落到文档里（这也是本文件存在的原因）。
2. **调查问卷的数据**：回收后把结论填进 `docs/SURVEY.md` 第四节，任何新对话读它就能用上（例如"60% 受访者选小程序"）。
3. **安全红线照样适用**：新对话里同样不要粘贴 `.env` 内容；新 AI 若要读取项目文件，提醒它跳过 `.env` 和 `data/`。
