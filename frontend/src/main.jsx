import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  ClipboardList,
  Database,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  GitCompare,
  ListChecks,
  Pencil,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './styles.css';

const API = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';
const SHOULD_TRY_LIVE_API = Boolean(import.meta.env.VITE_API_BASE) || import.meta.env.DEV;
const SCENARIOS = ['通用问答', '手机系统使用', '智能家居', '车载语音', '内容生成', '工具调用', '安全合规'];
const DIFFICULTIES = ['低', '中', '高'];
const COLORS = ['#2563eb', '#f97316', '#14b8a6', '#a855f7', '#ef4444', '#64748b', '#0f766e', '#c2410c'];
const MODEL_ALIASES = {
  'deepseek-v4-pro': 'deepseek',
  'glm-5.1': 'glm',
  'gemini-3.5-flash': 'gemini',
  'kimi-k2.6': 'kimi',
  'minimax-m2.7': 'minimax',
  'gpt-5.4': 'gpt',
  'qwen3.7-max': 'qwen',
  'claude-sonnet-4-5-20250929-t': 'claude',
};

const scoreFields = [
  ['accuracy', '准确性'],
  ['completeness', '完整性'],
  ['instruction_following', '指令遵循'],
  ['actionability', '可执行性'],
  ['format_stability', '格式稳定性'],
  ['user_experience', '用户体验'],
];

const guideSteps = [
  ['1', '评测集', '每条 Case 包含用户问题、场景、难度、标准答案/期望行为和评分维度。'],
  ['2', '模型回答', '选择单个模型或批量模型生成回答，结果写入本地 SQLite。'],
  ['3', '自动评分', '独立评审模型对照问题、期望行为和模型回答打分；明显失败先走硬规则扣分。'],
  ['4', 'Badcase 归因', '低总分或任一关键维度低分会进入 Badcase，并记录原因和优化建议。'],
  ['5', '报告导出', '本地结果可导出为 demo-data.json 和 Markdown 报告，用于 GitHub Pages 静态展示。'],
];

const guideDimensions = [
  ['准确性', '是否符合事实和业务约束，是否避免编造实时数据。'],
  ['完整性', '是否覆盖标准答案中的关键步骤、前置条件和限制。'],
  ['指令遵循', '是否按用户问题完成任务，没有跑题或擅自改需求。'],
  ['可执行性', '是否给出用户能实际操作的路径、步骤或下一步。'],
  ['格式稳定性', '结构是否清晰，批量评测时输出是否便于比较。'],
  ['用户体验', '语气、风险提示和澄清问题是否符合产品体验。'],
];

const emptyData = {
  cases: [],
  answers: [],
  scores: [],
  badcases: [],
  prompts: [],
  models: [],
  dashboard: null,
  analysis_summary: null,
  report: '',
  snapshot_at: '',
};

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function normalizeSnapshot(snapshot) {
  return {
    cases: snapshot.cases || [],
    answers: snapshot.answers || [],
    scores: snapshot.scores || [],
    badcases: snapshot.badcases || [],
    prompts: snapshot.prompts || [],
    models: snapshot.models || [],
    dashboard: snapshot.dashboard || null,
    analysis_summary: snapshot.analysis_summary || null,
    report: snapshot.report || '',
    snapshot_at: snapshot.snapshot_at || '',
  };
}

function modelLabel(name) {
  return MODEL_ALIASES[name] || name;
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState(emptyData);
  const [mode, setMode] = useState('live');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadSnapshot() {
    const res = await fetch('demo-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('没有找到 demo-data.json，请先在本地导出 GitHub 展示快照');
    const snapshot = await res.json();
    setData(normalizeSnapshot(snapshot));
    setMode('static');
    setMessage(`静态快照：${snapshot.snapshot_at || '已加载'}`);
  }

  async function loadAll() {
    setLoading(true);
    try {
      if (!SHOULD_TRY_LIVE_API) {
        await loadSnapshot();
        return;
      }
      const [cases, answers, scores, badcases, prompts, models, dashboard, analysisSummary, report] = await Promise.all([
        request('/api/cases'),
        request('/api/answers'),
        request('/api/scores'),
        request('/api/badcases'),
        request('/api/prompts'),
        request('/api/models'),
        request('/api/dashboard'),
        request('/api/analysis/summary'),
        request('/api/report'),
      ]);
      setData({ cases, answers, scores, badcases, prompts, models: models.models, dashboard, analysis_summary: analysisSummary, report: report.markdown, snapshot_at: '' });
      setMode('live');
      setMessage('实时 API 数据');
    } catch (err) {
      try {
        await loadSnapshot();
      } catch (snapshotErr) {
        setData(emptyData);
        setMessage(`加载失败：${err.message || snapshotErr.message}`);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function seed() {
    await request('/api/seed', { method: 'POST' });
    setMessage('已写入示例评测集');
    loadAll();
  }

  async function exportSnapshot() {
    if (mode !== 'live') {
      setMessage('静态模式不能写入文件，请在本地启动 FastAPI 后导出');
      return;
    }
    const result = await request('/api/export/github-snapshot', { method: 'POST', body: JSON.stringify({ write_files: true }) });
    setMessage(`已导出 GitHub 展示数据：${result.answer_count} 条回答，${result.score_count} 条评分`);
  }

  const ctx = { data, mode, setMessage, loadAll };
  const tabs = [
    ['dashboard', BarChart3, '总览'],
    ['guide', BookOpen, '项目逻辑'],
    ['cases', ClipboardList, '评测集'],
    ['compare', GitCompare, '模型对比'],
    ['badcase', FlaskConical, 'Badcase'],
    ['prompt', Settings2, 'Prompt 迭代'],
    ['report', FileText, '报告'],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">E</div>
          <div>
            <h1>LLM EvalFlow</h1>
            <p>问答评测与归因平台</p>
          </div>
        </div>
        <nav>
          {tabs.map(([id, Icon, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <button className="secondary" onClick={seed} disabled={mode !== 'live'}><Upload size={16} /> 导入示例数据</button>
        <button className="secondary" onClick={exportSnapshot} disabled={mode !== 'live'}><Download size={16} /> 导出 GitHub 展示</button>
        <button className="secondary" onClick={loadAll}><RefreshCw size={16} /> 刷新数据</button>
      </aside>
      <main className="main">
        <header>
          <div>
            <p className="eyebrow">AI Product Workflow</p>
            <h2>{tabs.find((x) => x[0] === tab)?.[2]}</h2>
          </div>
          <div className={`status ${mode === 'static' ? 'snapshot' : ''}`}>
            {loading ? '同步中...' : message || 'FastAPI + React + SQLite'}
          </div>
        </header>
        {mode === 'static' && <div className="notice">当前为 GitHub 静态展示模式：结果来自已导出的快照，不能新增问题或重新调用模型。</div>}
        {tab === 'dashboard' && <Dashboard {...ctx} />}
        {tab === 'guide' && <ProjectGuide data={data} />}
        {tab === 'cases' && <Cases {...ctx} />}
        {tab === 'compare' && <Compare {...ctx} />}
        {tab === 'badcase' && <Badcase {...ctx} />}
        {tab === 'prompt' && <Prompt {...ctx} />}
        {tab === 'report' && <Report {...ctx} />}
      </main>
    </div>
  );
}

function Dashboard({ data, mode, setMessage, loadAll }) {
  const [summarizing, setSummarizing] = useState(false);
  const d = data.dashboard || {};
  const kpis = [
    ['题库 Case', d.case_count || 0],
    ['已完成 Case', d.completed_case_count || 0],
    ['模型回答', d.answer_count || 0],
    ['已评分', d.score_count || 0],
    ['待评分', d.unscored_answer_count || 0],
    ['Badcase', d.badcase_count || 0],
    ['平均分', d.avg_score || 0],
  ];

  async function refreshSummary() {
    if (mode !== 'live') {
      setMessage('静态模式不能调用 Gemini，请在本地启动 FastAPI 后生成总结');
      return;
    }
    setSummarizing(true);
    try {
      const result = await request('/api/analysis/summary', { method: 'POST', body: JSON.stringify({ force_refresh: true }) });
      setMessage(`已生成 ${result.model} 总结`);
      loadAll();
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <section className="grid">
      <div className="kpis">
        {kpis.map(([k, v]) => <div className="card metric" key={k}><span>{k}</span><strong>{v}</strong></div>)}
      </div>
      <div className="card summaryCard">
        <div className="summaryHead">
          <h3><BrainCircuit size={18} /> Gemini 评测总结</h3>
          <button className="secondary importantAction" onClick={refreshSummary} disabled={summarizing || mode !== 'live'}>
            {summarizing ? '生成中...' : '生成 Gemini 总结'}
          </button>
        </div>
        <p className="summaryMeta">
          {data.analysis_summary?.model || 'local-fallback'} / {data.analysis_summary?.generated_at || '未生成'}
        </p>
        <pre>{data.analysis_summary?.summary || '暂无总结。点击按钮后会调用 gemini-3.5-flash 分析全部评分、领域表现和 Badcase。'}</pre>
      </div>
      <ChartCard title="各模型平均分" data={d.model_scores || []} useModelAlias />
      <ChartCard title="各场景平均分" data={d.scenario_scores || []} />
      <div className="card chart">
        <h3>Badcase 类型分布</h3>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={d.badcase_types || []} dataKey="count" nameKey="name" outerRadius={92} label>
              {(d.badcase_types || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ChartCard({ title, data, useModelAlias = false }) {
  const chartData = data.map((item, i) => ({
    ...item,
    shortName: useModelAlias ? modelLabel(item.name) : item.name,
    color: COLORS[i % COLORS.length],
  }));
  return (
    <div className="card chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 12, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="shortName" interval={0} tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 5]} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="score" radius={[5, 5, 0, 0]}>
            {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="tooltip">
      <b>{item.name}</b>
      <span>平均分：{item.score}</span>
    </div>
  );
}

function ProjectGuide({ data }) {
  const scenarioCounts = data.cases.reduce((acc, item) => {
    acc[item.scenario] = (acc[item.scenario] || 0) + 1;
    return acc;
  }, {});
  const coreScenarios = ['手机系统使用', '智能家居', '车载语音', '内容生成', '工具调用', '安全合规'];

  return (
    <section className="guide">
      <div className="guideHero">
        <div>
          <p className="eyebrow">Project Map</p>
          <h3>这个项目如何运行、评测和展示</h3>
          <p>本项目是一个本地优先的大模型问答评测台：FastAPI 负责评测数据、模型调用和导出，React 负责配置 Case、对比回答、查看 Badcase 和报告。</p>
        </div>
        <div className="runBox">
          <div><PlayCircle size={18} /> 后端入口</div>
          <code>uvicorn app.main:app --reload --host 127.0.0.1 --port 8000</code>
          <small>加载的是 backend/app/main.py 里的 FastAPI app，不是直接 python main.py。</small>
        </div>
      </div>

      <div className="guideGrid">
        <div className="panel">
          <h3><Database size={18} /> 数据从哪里来</h3>
          <p>评测集保存在本地 SQLite：backend/llm_evalflow.db。内置示例由 seed 接口写入，也可以在“评测集”页面手动新增或上传 CSV。</p>
          <div className="scenarioPills">
            {coreScenarios.map((name) => (
              <span key={name}>{name}<b>{scenarioCounts[name] || 0}</b></span>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3><ListChecks size={18} /> 标准答案怎么来的</h3>
          <p>标准答案不是模型自动生成的结论，而是评测人员按产品预期手工写出的“期望行为”：应包含哪些步骤、哪些限制不能越界、遇到实时数据或高风险问题时应该如何处理。</p>
          <p>新增 Case 时，前端的“标准答案或期望行为”字段就是评分参考答案；CSV 导入时对应 expected_answer 列。</p>
        </div>
        <div className="panel">
          <h3><ShieldCheck size={18} /> 如何评估规范性</h3>
          <p>自动评分不是让每个模型自己给自己打分。后端默认用独立评审模型读取用户问题、期望行为和模型回答；如果被评模型与评审模型相同，会自动切换备用评审模型，降低自评偏差。</p>
          <p>评分前先执行硬规则：调用失败、超时、空回答、只输出工具调用/XML/JSON、需要实时工具却编造结果等，会直接被压低到 1-2 分并标记 Badcase。</p>
        </div>
        <div className="panel">
          <h3><GitBranch size={18} /> GitHub 展示逻辑</h3>
          <p>本地调试读实时 API；GitHub Pages 没有后端，所以读取 frontend/public/demo-data.json。点击“导出 GitHub 展示”会同步更新静态快照和 docs/evaluation_report.md。</p>
        </div>
      </div>

      <div className="panel flowPanel">
        <h3>完整流程</h3>
        <div className="flowSteps">
          {guideSteps.map(([num, title, text]) => (
            <div className="flowStep" key={num}>
              <span>{num}</span>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel dimensionPanel">
        <h3>六维评分口径</h3>
        <div className="dimensionGrid">
          {guideDimensions.map(([name, text]) => (
            <div key={name}>
              <b>{name}</b>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cases({ data, mode, loadAll, setMessage }) {
  const [form, setForm] = useState({ question: '', scenario: '手机系统使用', difficulty: '中', expected_answer: '', notes: '' });
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState('');
  const [scenario, setScenario] = useState('全部');
  const answersByCase = useMemo(() => {
    const map = {};
    data.answers.forEach((a) => {
      map[a.case_id] ||= new Set();
      map[a.case_id].add(a.model_name);
    });
    return map;
  }, [data.answers]);
  const scoresByAnswer = useMemo(() => new Set(data.scores.map((s) => s.answer_id)), [data.scores]);
  const filtered = data.cases.filter((c) => {
    const matchText = `${c.question} ${c.expected_answer}`.toLowerCase().includes(query.toLowerCase());
    const matchScenario = scenario === '全部' || c.scenario === scenario;
    return matchText && matchScenario;
  });

  async function submit(e) {
    e.preventDefault();
    if (mode !== 'live') return;
    const path = editingId ? `/api/cases/${editingId}` : '/api/cases';
    const method = editingId ? 'PUT' : 'POST';
    await request(path, { method, body: JSON.stringify(form) });
    setForm({ question: '', scenario: '手机系统使用', difficulty: '中', expected_answer: '', notes: '' });
    setEditingId(null);
    setMessage(editingId ? '已更新 Case' : '已新增 Case');
    loadAll();
  }

  async function upload(e) {
    if (mode !== 'live') return;
    const file = e.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    await request('/api/cases/import', { method: 'POST', body });
    setMessage('CSV 导入完成');
    loadAll();
  }

  async function removeCase(caseId) {
    if (mode !== 'live') return;
    await request(`/api/cases/${caseId}`, { method: 'DELETE' });
    setMessage('已删除 Case 及关联回答/评分');
    loadAll();
  }

  function editCase(c) {
    setEditingId(c.id);
    setForm({
      question: c.question,
      scenario: c.scenario,
      difficulty: c.difficulty,
      expected_answer: c.expected_answer,
      notes: c.notes || '',
    });
  }

  return (
    <section className="two">
      <form className="panel" onSubmit={submit}>
        <h3>{editingId ? `编辑 Case #${editingId}` : '新增评测 Case'}</h3>
        <input placeholder="用户问题" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required disabled={mode !== 'live'} />
        <div className="row">
          <select value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} disabled={mode !== 'live'}>
            {SCENARIOS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} disabled={mode !== 'live'}>
            {DIFFICULTIES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <textarea placeholder="标准答案或期望行为" value={form.expected_answer} onChange={(e) => setForm({ ...form, expected_answer: e.target.value })} required disabled={mode !== 'live'} />
        <input placeholder="备注，可选" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={mode !== 'live'} />
        <button disabled={mode !== 'live'}><Send size={16} /> {editingId ? '保存修改' : '保存 Case'}</button>
        {editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm({ question: '', scenario: '手机系统使用', difficulty: '中', expected_answer: '', notes: '' }); }}>取消编辑</button>}
        <label className={`file ${mode !== 'live' ? 'disabled' : ''}`}><Upload size={16} /> 上传 CSV<input type="file" accept=".csv" onChange={upload} disabled={mode !== 'live'} /></label>
      </form>
      <div className="card table">
        <div className="tableHead">
          <h3>评测集列表</h3>
          <span>{filtered.length} / {data.cases.length}</span>
        </div>
        <div className="filters">
          <label><Search size={16} /><input placeholder="搜索问题或标准答案" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {['全部', ...SCENARIOS].map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        {filtered.map((c) => {
          const answerCount = answersByCase[c.id]?.size || 0;
          const caseAnswerIds = data.answers.filter((a) => a.case_id === c.id).map((a) => a.id);
          const scoreCount = caseAnswerIds.filter((id) => scoresByAnswer.has(id)).length;
          return (
            <div className="case" key={c.id}>
              <div className="caseTop">
                <b>#{c.id} {c.scenario} / {c.difficulty}</b>
                <div className="actions">
                  <button className="iconBtn" onClick={() => editCase(c)} disabled={mode !== 'live'} title="编辑"><Pencil size={15} /></button>
                  <button className="iconBtn dangerBtn" onClick={() => removeCase(c.id)} disabled={mode !== 'live'} title="删除"><Trash2 size={15} /></button>
                </div>
              </div>
              <p>{c.question}</p>
              <small>{c.expected_answer}</small>
              <div className="progressLine">
                <span>回答覆盖 {answerCount}/{data.models.length || 8}</span>
                <span>评分 {scoreCount}/{answerCount}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Compare({ data, mode, loadAll, setMessage }) {
  const [caseId, setCaseId] = useState('');
  const [model, setModel] = useState('gpt-5.4');
  const [batching, setBatching] = useState(false);
  const selected = data.cases.find((c) => c.id === Number(caseId)) || data.cases[0];
  const answers = data.answers.filter((a) => selected && a.case_id === selected.id);
  const scoresByAnswer = useMemo(() => Object.fromEntries(data.scores.map((s) => [s.answer_id, s])), [data.scores]);
  const answeredCaseIds = useMemo(() => new Set(data.answers.map((a) => a.case_id)), [data.answers]);
  const unansweredCaseCount = data.cases.filter((c) => !answeredCaseIds.has(c.id)).length;

  async function generate() {
    if (!selected || mode !== 'live') return;
    await request('/api/answers/generate', { method: 'POST', body: JSON.stringify({ case_id: selected.id, model_name: model, prompt_version: 'v1.0' }) });
    setMessage('模型回答已生成');
    loadAll();
  }

  async function autoJudge(answerId) {
    if (mode !== 'live') return;
    await request('/api/scores/auto', { method: 'POST', body: JSON.stringify({ answer_id: answerId, judge_model: 'gpt-5.4' }) });
    setMessage('已完成自动评分与 Badcase 判断');
    loadAll();
  }

  async function batchGenerate() {
    if (mode !== 'live') return;
    setBatching(true);
    try {
      const result = await request('/api/answers/batch-generate', {
        method: 'POST',
        body: JSON.stringify({
          model_names: data.models,
          replace_mock: true,
          auto_score: true,
          judge_model: 'gpt-5.4',
          max_workers: 4,
        }),
      });
      const scores = result.scores || {};
      setMessage(`批量生成完成：新增 ${result.created}，替换 ${result.replaced}，跳过 ${result.skipped}，失败 ${result.failed}；评分新增 ${scores.created || 0}，待评分跳过 ${scores.skipped || 0}，Badcase ${scores.badcases || 0}`);
      loadAll();
    } finally {
      setBatching(false);
    }
  }

  async function batchGenerateNewCases() {
    if (mode !== 'live') return;
    if (unansweredCaseCount === 0) {
      setMessage('没有回答覆盖为 0 的新增问题');
      return;
    }
    setBatching(true);
    try {
      const result = await request('/api/answers/batch-generate', {
        method: 'POST',
        body: JSON.stringify({
          model_names: data.models,
          replace_mock: false,
          only_unanswered_cases: true,
          auto_score: true,
          judge_model: 'gpt-5.4',
          max_workers: 4,
        }),
      });
      const scores = result.scores || {};
      setMessage(`新增问题回答完成：处理 ${result.target_case_count} 个问题，新增 ${result.created} 条回答，跳过旧问题 ${result.skipped_cases} 个，失败 ${result.failed}；评分新增 ${scores.created || 0}，Badcase ${scores.badcases || 0}`);
      loadAll();
    } finally {
      setBatching(false);
    }
  }

  return (
    <section>
      <div className="toolbar">
        <label className="fieldControl wide">
          <span>评测问题</span>
          <select value={selected?.id || ''} onChange={(e) => setCaseId(e.target.value)}>
            {data.cases.map((c) => <option value={c.id} key={c.id}>#{c.id} {c.question}</option>)}
          </select>
        </label>
        <label className="fieldControl modelControl">
          <span>回答模型</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>{data.models.map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <button onClick={generate} disabled={mode !== 'live'}><Send size={16} /> 生成回答</button>
        <button className="secondary importantAction" onClick={batchGenerateNewCases} disabled={batching || mode !== 'live' || unansweredCaseCount === 0}>回答新增问题 {unansweredCaseCount}</button>
        <button className="secondary" onClick={batchGenerate} disabled={batching || mode !== 'live'}>全部模型回答</button>
      </div>
      <div className="helperBar">
        “回答新增问题”只处理回答覆盖为 0 的 Case；旧问题继续使用已有答案，不会被重新生成。批量回答完成后会自动补齐未评分回答并刷新 Badcase，请先确认 API Key 和额度。
      </div>
      {selected && <div className="reference"><b>期望行为：</b>{selected.expected_answer}</div>}
      <div className="answerGrid">
        {answers.map((a) => <div className="card answer" key={a.id}>
          <h3>{modelLabel(a.model_name)} <small>{a.model_name}</small></h3>
          <small>{a.prompt_version} / {a.response_time_ms || '-'} ms</small>
          <p>{a.answer}</p>
          {scoresByAnswer[a.id] ? <ScoreView score={scoresByAnswer[a.id]} /> : <button className="secondary" onClick={() => autoJudge(a.id)} disabled={mode !== 'live'}>自动评分</button>}
        </div>)}
      </div>
    </section>
  );
}

function ScoreView({ score }) {
  return (
    <div className="scoreBlock">
      <div className="scores">
        {scoreFields.map(([k, label]) => <span key={k}>{label} {score[k]}</span>)}
        <strong>总分 {score.total_score}</strong>
        {score.is_badcase && <b className="danger">Badcase</b>}
      </div>
      {(score.reason || score.suggestion) && (
        <details className="scoreReason">
          <summary>评分依据</summary>
          {score.reason && <p><b>原因：</b>{score.reason}</p>}
          {score.suggestion && <p><b>建议：</b>{score.suggestion}</p>}
        </details>
      )}
    </div>
  );
}

function Badcase({ data }) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const answerById = Object.fromEntries(data.answers.map((a) => [a.id, a]));
  return (
    <section className="card table">
      <h3>Badcase 归因列表</h3>
      {data.badcases.map((b) => <div className="case" key={b.id}><b>{b.badcase_type} / {b.severity}</b><p>{caseById[b.case_id]?.question}</p><small>{answerById[b.answer_id]?.model_name}：{b.root_cause}</small><em>{b.optimization}</em></div>)}
    </section>
  );
}

function Prompt({ data, mode, loadAll, setMessage }) {
  const [form, setForm] = useState({ version: 'v1.1', content: '', change_reason: '', related_badcase: '', conclusion: '' });
  async function submit(e) {
    e.preventDefault();
    if (mode !== 'live') return;
    await request('/api/prompts', { method: 'POST', body: JSON.stringify(form) });
    setMessage('Prompt 版本已记录');
    loadAll();
  }
  return (
    <section className="two">
      <form className="panel" onSubmit={submit}>
        <h3>记录 Prompt 迭代</h3>
        <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} disabled={mode !== 'live'} />
        <input placeholder="修改原因" value={form.change_reason} onChange={(e) => setForm({ ...form, change_reason: e.target.value })} disabled={mode !== 'live'} />
        <textarea placeholder="Prompt 内容" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required disabled={mode !== 'live'} />
        <input placeholder="关联 Badcase" value={form.related_badcase} onChange={(e) => setForm({ ...form, related_badcase: e.target.value })} disabled={mode !== 'live'} />
        <textarea placeholder="效果结论" value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} disabled={mode !== 'live'} />
        <button disabled={mode !== 'live'}>保存版本</button>
      </form>
      <div className="card table">{data.prompts.map((p) => <div className="case" key={p.id}><b>{p.version}</b><p>{p.change_reason}</p><small>{p.content}</small><em>{p.conclusion}</em></div>)}</div>
    </section>
  );
}

function Report({ data }) {
  return <section className="card report"><h3>Markdown 评测报告</h3><pre>{data.report}</pre></section>;
}

createRoot(document.getElementById('root')).render(<App />);
