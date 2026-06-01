# LLM EvalFlow：大模型问答评测与 Badcase 归因分析平台

<!-- screenshots:start -->
## 页面预览

以下截图由本地“导出 GitHub 展示”流程自动生成，推送到 GitHub 后会同步显示在仓库首页。

### Dashboard 总览
展示题库规模、完成进度、模型平均分和 Badcase 分布。
![Dashboard 总览截图](docs/screenshots/dashboard.png)

### 模型对比
展示同一 Case 下不同模型的回答、自动评分和差异。
![模型对比截图](docs/screenshots/compare.png)

### Badcase 归因
展示低分样本、问题类型和优化建议。
![Badcase 归因截图](docs/screenshots/badcase.png)

### 评测报告
展示自动生成的 Markdown 评测报告。
![评测报告截图](docs/screenshots/report.png)
<!-- screenshots:end -->

这是一个面向 AI 产品经理、问答策略和 Agent 产品岗位的轻量评测平台，支持：

- 评测集管理
- 多模型回答生成与导入
- 六维评分
- Badcase 自动归因
- Prompt 迭代记录
- 评测报告生成
- GitHub Pages 静态展示

## 核心文档

- [评测方法说明](docs/evaluation_methodology.md)
- [产品方案 PRD](docs/PRD.txt)
- [功能更新说明](docs/功能更新说明.txt)

- 后端：FastAPI + SQLModel + SQLite
- 前端：React + Vite + Recharts
- 模型调用：OpenAI SDK 兼容接口

## 快速启动

以下命令已经更新为**项目相对路径写法**，不依赖某一台电脑上的绝对路径。

### 双击启动（最省事）

在 Finder 中直接双击项目根目录里的：

```text
启动项目.command
```

它会自动打开终端并执行一键启动脚本。

如果 macOS 第一次提示安全确认，可以右键 `启动项目.command` → 选择“打开”，确认一次后，后续通常就能直接双击运行。

### 一键启动（推荐）

在项目根目录执行：

```bash
bash start.sh
```

脚本会自动：

- 启动后端 `http://127.0.0.1:8000`
- 启动前端 `http://127.0.0.1:5173`
- 在按下 `Ctrl+C` 时一起停止前后端

### 停止方式

- 如果是通过 `bash start.sh` 启动：在当前终端按 `Ctrl+C`
- 如果是通过双击 `启动项目.command` 启动：在弹出的终端窗口按 `Ctrl+C`
- 停止后，`.command` 窗口会提示“按回车键关闭此窗口”

使用前请确认：

- `backend/.venv` 已创建并安装后端依赖
- 前端依赖已安装过，或者你已经能在 `frontend` 目录正常运行 `npm run dev`

### 手动启动

### 1. 安装后端依赖

```bash
cd backend
python -m pip install -r requirements.txt
```

如果你的环境里 `python` 指向的不是项目解释器，也可以改成你自己的 Python 可执行文件路径。

### 2. 配置模型接口

复制 `backend/.env.example` 为 `backend/.env`，填写：

```text
LIAOBOTS_API_KEY=你的 API Key
```

不配置也可以运行，系统会返回模拟回答，方便先看 Demo。

### 3. 启动后端

```bash
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。

## 数据是否会常驻

本地运行时，评测集、模型回答、评分和 Badcase 都保存在 `backend/llm_evalflow.db` 这个 SQLite 数据库里。电脑重启后数据不会丢，但需要重新启动后端和前端服务才能在浏览器里查看动态页面。

模型回答还会同步到本地回答存档 `backend/model_answer_archive.json`。生成回答时后端会先查这份存档，命中后直接复用历史回答，不再重复调用模型 API；只有新增问题或存档缺失时，才需要在前端「模型对比」页点击「回答新增问题」来调用全部模型生成新回答。批量回答完成后会自动补齐评分和 Badcase。

## 评测逻辑与公平性设计

### 1. “标准答案”并不是唯一文本答案

本项目里的 `expected_answer` 更准确地说是**期望行为 / 评分参考口径**，不是要求模型逐字匹配某一段标准文本。

例如，对于“查天气并提醒我带伞”这类问题，系统关注的不是模型是否复述某一句固定话术，而是：

- 是否识别出这是一个多步骤任务
- 是否知道需要实时天气查询能力
- 是否知道提醒创建也需要工具支持
- 没有工具时是否明确说明限制，而不是编造结果

因此，评测目标是衡量模型是否满足产品预期，而不是做机械文本比对。

### 2. 为什么这些期望行为可以作为评分标准

这些期望行为来自评测人员对真实产品场景的手工定义，依据主要包括：

- 用户任务是否完成
- 业务流程是否正确
- 是否覆盖关键步骤和前置条件
- 是否遵守安全与合规边界
- 是否避免编造实时信息或超出工具能力边界

也就是说，平台评估的是“这个回答是否符合一个 AI 产品应该给用户的结果”，而不是“它是否和某段参考答案长得像”。

### 3. 得分由谁来评判

自动评分不是让被评模型给自己打分，而是分成两层：

1. **硬规则层**：
   - 回答为空
   - 调用失败或超时
   - 只输出工具调用/XML/JSON
   - 需要实时工具却编造天气、票务、酒店等结果

   这些情况会被直接压低分数，并优先标记为 Badcase。

2. **独立评审模型层**：
   正常回答会交给独立评审模型，对照“用户问题 + 期望行为 + 模型回答”进行六维评分。

如果被评模型与评审模型相同，系统会自动切换备用评审模型，降低自评偏差。

### 4. 当前如何提升公平性

目前项目已经做了以下控制：

- 所有模型使用同一批 Case
- 所有回答使用同一套期望行为口径
- 统一采用六维评分标准
- 先规则后评审，避免明显错误被“语言流畅”掩盖
- 被评模型与评审模型相同时自动切换备用评审模型
- 每条评分保留原因和优化建议，便于复核

### 5. 当前局限与后续优化方向

为了保持 MVP 简洁，这个版本仍有局限：

- 期望行为仍由人工编写，存在一定主观性
- 当前默认主要依赖单一评审模型，仍可能有偏差
- 尚未加入人工复核流转
- 尚未按场景做维度权重区分
- 尚未引入多评审模型投票或黄金样本校准

如果继续迭代，优先会补：

- 把“标准答案”进一步结构化为“期望行为 + 关键评分点 + 常见扣分项”
- 为高风险或高分歧样本增加人工复核
- 对工具调用、安全合规等高风险场景引入差异化评分权重
- 增加多评审模型交叉评分和置信度提示

## 评分机制

自动评分不是让每个被评模型自己给自己打分。后端默认使用独立评审模型读取「用户问题、期望行为、模型回答」后输出六维评分；如果被评模型刚好等于评审模型，后端会自动切换备用评审模型，降低自评偏差。

评分链路分两层：

1. 先走确定性硬规则：调用失败、超时、空回答、只输出工具调用/XML/JSON、需要实时工具却编造结果等，会直接低分并标记 Badcase。
2. 再走评审模型：正常回答由评审模型按准确性、完整性、指令遵循、可执行性、格式稳定性、用户体验六个维度评分。

总分低于 3.5 或任一维度低于 3，会进入 Badcase。每条评分会保存评分原因和优化建议，前端「模型对比」页可展开查看。

`backend/model_answer_archive.json`、`backend/gemini_summary.json`、`backend/llm_evalflow.db` 都是本地运行产物，已被 `.gitignore` 排除，不会提交到 GitHub。

如果要上传到 GitHub 展示，不需要 GitHub 运行 FastAPI。点击左侧「导出 GitHub 展示」后，系统会把当前评测结果导出到：

- `frontend/public/demo-data.json`
- `docs/evaluation_report.md`
- `docs/screenshots/*.png`（README 顶部关键页面截图）

前端在没有后端 API 时会自动读取 `demo-data.json`，因此 GitHub Pages 也能常驻展示已经跑完的评测结果；README 也会同步显示最新截图。

## GitHub Pages 展示

你的 GitHub 仓库是：`https://github.com/maoqiu77/llm-evalflow`

上传本项目后，在本地构建静态页面：

```bash
cd frontend
npm install
npm run build
```

GitHub Pages 可以选择两种方式：

1. 用 GitHub Actions 自动构建 `frontend`。本项目已内置 `.github/workflows/deploy-pages.yml`。
2. 把 `frontend/dist` 的内容部署到 Pages 分支。

当前项目已设置 `vite.config.js` 的 `base: './'`，适合 GitHub Pages 的子路径部署。

启用 Actions 方式时，到仓库 Settings → Pages，把 Source 选择为 `GitHub Actions`。之后推送到 `main` 分支即可自动发布。

## 推荐演示流程

1. 点击左侧「导入示例数据」。
2. 进入「模型对比」，选择 Case 和模型，点击「生成回答」。
3. 对生成回答点击「自动评分」。
4. 进入「Badcase」查看归因。
5. 进入「Prompt 迭代」记录优化方案。
6. 进入「报告」查看自动生成的 Markdown 评测报告。
7. 点击「导出 GitHub 展示」，生成静态快照后上传 GitHub。

## Gemini 总览总结

总览页提供「Gemini 评测总结」区域。点击「生成 Gemini 总结」会调用 `gemini-3.5-flash` 汇总当前全部模型评分、各领域最佳模型、模型缺陷和 Badcase 归因，并把结果缓存到 `backend/gemini_summary.json`。再次打开后会优先读取缓存，只有手动点击按钮才重新调用模型。

## 可用模型

- deepseek-v4-pro
- glm-5.1
- gemini-3.5-flash
- kimi-k2.6
- minimax-m2.7
- gpt-5.4
- qwen3.7-max
- claude-sonnet-4-5-20250929-t
