# LLM EvalFlow：大模型问答评测与 Badcase 归因分析平台

这是一个面向 AI 产品经理、问答策略和 Agent 产品岗位的轻量评测平台，支持：

- 评测集管理
- 多模型回答生成与导入
- 六维评分
- Badcase 自动归因
- Prompt 迭代记录
- 评测报告生成

## 技术栈

- 后端：FastAPI + SQLModel + SQLite
- 前端：React + Vite + Recharts
- 模型调用：OpenAI SDK 兼容接口

## 快速启动

1. 安装后端依赖

```powershell
cd D:\python\09-07-Albedo\venv\实习项目一\backend
D:\python\09-07-Albedo\venv\Scripts\python.exe -m pip install -r requirements.txt
```

2. 配置模型接口

复制 `backend\.env.example` 为 `backend\.env`，填写：

```text
LIAOBOTS_API_KEY=你的 API Key
```

不配置也可以运行，系统会返回模拟回答，方便先看 Demo。

3. 启动后端

```powershell
cd D:\python\09-07-Albedo\venv\实习项目一\backend
D:\python\09-07-Albedo\venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

4. 启动前端

```powershell
cd D:\python\09-07-Albedo\venv\实习项目一\frontend
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。

## 数据是否会常驻

本地运行时，评测集、模型回答、评分和 Badcase 都保存在 `backend/llm_evalflow.db` 这个 SQLite 数据库里。电脑重启后数据不会丢，但需要重新启动后端和前端服务才能在浏览器里查看动态页面。

模型回答还会同步到本地回答存档 `backend/model_answer_archive.json`。生成回答时后端会先查这份存档，命中后直接复用历史回答，不再重复调用模型 API；只有新增问题或存档缺失时，才需要在前端「模型对比」页点击「回答新增问题」来调用全部模型生成新回答。批量回答完成后会自动补齐评分和 Badcase。

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

前端在没有后端 API 时会自动读取 `demo-data.json`，因此 GitHub Pages 也能常驻展示已经跑完的评测结果。

## GitHub Pages 展示

你的 GitHub 主页是 `https://github.com/maoqiu77`。建议新建仓库，例如：

```text
llm-evalflow
```

上传本项目后，在本地构建静态页面：

```powershell
cd D:\python\09-07-Albedo\venv\实习项目一\frontend
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
