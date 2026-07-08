import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckSquare,
  ClipboardList,
  Database,
  Eye,
  FileText,
  FlaskConical,
  FolderOpen,
  GitBranch,
  GitCompare,
  KeyRound,
  ListChecks,
  Pencil,
  Plus,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
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
  ['1', '评测集', '每条 Case 包含用户问题、场景、难度、期望行为/评分参考口径和评分维度。'],
  ['2', '模型回答', '选择单个模型或批量模型生成回答，结果写入本地 SQLite。'],
  ['3', '自动评分', '独立评审模型对照问题、期望行为和模型回答打分；明显失败先走硬规则扣分。'],
  ['4', 'Badcase 归因', '低总分或任一关键维度低分会进入 Badcase，并记录原因和优化建议。'],
  ['5', '报告导出', '本地结果可导出为 demo-data.json 和 Markdown 报告，用于 GitHub Pages 静态展示。'],
];

const guideDimensions = [
  ['准确性', '是否符合事实和业务约束，是否避免编造实时数据。'],
  ['完整性', '是否覆盖期望行为中的关键步骤、前置条件和限制。'],
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
  selection: null,
  config_summary: null,
};

const emptyConfig = {
  base_url: 'https://ai.liaobots.work/v1',
  has_api_key: false,
  api_key_mask: '',
  models: [],
  default_answer_models: [],
  default_judge_model: '',
  summary_model: '',
  max_workers: 4,
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
  const cases = snapshot.cases || [];
  const answers = snapshot.answers || [];
  const scores = snapshot.scores || [];
  const badcases = snapshot.badcases || [];
  const models = snapshot.models?.length ? snapshot.models : inferModels(answers);
  return {
    cases,
    answers,
    scores,
    badcases,
    prompts: snapshot.prompts || [],
    models,
    dashboard: snapshot.dashboard || buildDashboardFromSnapshot(cases, answers, scores, badcases, models),
    analysis_summary: snapshot.analysis_summary || null,
    report: snapshot.report || '',
    snapshot_at: snapshot.snapshot_at || '',
    selection: snapshot.selection || null,
    config_summary: snapshot.config_summary || null,
  };
}

function inferModels(answers) {
  return [...new Set(answers.map((answer) => answer.model_name).filter(Boolean))];
}

function numericScore(score, key) {
  const value = Number(score?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function totalScore(score) {
  const direct = Number(score?.total_score);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const values = scoreFields.map(([key]) => numericScore(score, key)).filter((value) => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100 : 0;
}

function countBy(items, getKey) {
  const counts = {};
  items.forEach((item) => {
    const key = getKey(item);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}

function buildDashboardFromSnapshot(cases, answers, scores, badcases, models) {
  const caseById = Object.fromEntries(cases.map((item) => [item.id, item]));
  const scoreByAnswer = Object.fromEntries(scores.map((item) => [item.answer_id, item]));
  const scoredAnswerIds = new Set(scores.map((item) => item.answer_id));
  const answersByCase = {};
  const modelScores = {};
  const scenarioScores = {};

  answers.forEach((answer) => {
    answersByCase[answer.case_id] ||= [];
    answersByCase[answer.case_id].push(answer);
    const score = scoreByAnswer[answer.id];
    const scoreValue = totalScore(score);
    if (!score || !scoreValue) return;
    modelScores[answer.model_name] ||= [];
    modelScores[answer.model_name].push(scoreValue);
    const scenario = caseById[answer.case_id]?.scenario;
    if (scenario) {
      scenarioScores[scenario] ||= [];
      scenarioScores[scenario].push(scoreValue);
    }
  });

  const expectedModelCount = models.length || inferModels(answers).length;
  const completedCaseCount = cases.filter((item) => {
    const caseAnswers = answersByCase[item.id] || [];
    if (!caseAnswers.length) return false;
    const answeredModels = new Set(caseAnswers.map((answer) => answer.model_name));
    return answeredModels.size >= expectedModelCount && caseAnswers.every((answer) => scoredAnswerIds.has(answer.id));
  }).length;

  return {
    case_count: cases.length,
    completed_case_count: completedCaseCount,
    incomplete_case_count: cases.length - completedCaseCount,
    unanswered_case_count: cases.filter((item) => !(answersByCase[item.id] || []).length).length,
    answer_count: answers.length,
    score_count: scoredAnswerIds.size,
    score_record_count: scores.length,
    unscored_answer_count: Math.max(0, answers.length - scoredAnswerIds.size),
    expected_score_count: cases.length * expectedModelCount,
    badcase_count: badcases.length,
    avg_score: average(scores.map(totalScore)),
    model_scores: Object.entries(modelScores).map(([name, values]) => ({ name, score: average(values) })),
    scenario_scores: Object.entries(scenarioScores).map(([name, values]) => ({ name, score: average(values) })),
    badcase_types: countBy(badcases, (item) => item.badcase_type),
  };
}

function configFromSnapshot(normalized) {
  return {
    ...emptyConfig,
    models: normalized.models,
    default_answer_models: normalized.models.slice(0, 2),
    default_judge_model: normalized.selection?.judge_model || normalized.models[0] || '',
  };
}

function modelLabel(name) {
  return MODEL_ALIASES[name] || name;
}

function App() {
  const [tab, setTab] = useState('dashboard');
  const [data, setData] = useState(emptyData);
  const [config, setConfig] = useState(emptyConfig);
  const [lastRun, setLastRun] = useState(null);
  const [mode, setMode] = useState('live');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function loadSnapshot() {
    const res = await fetch('demo-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('没有找到 demo-data.json，请上传评测结果 snapshot.json');
    const snapshot = await res.json();
    const normalized = normalizeSnapshot(snapshot);
    setData(normalized);
    setConfig(configFromSnapshot(normalized));
    setLastRun(null);
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
      const [configResult, cases, answers, scores, badcases, prompts, dashboard, analysisSummary, report] = await Promise.all([
        request('/api/config'),
        request('/api/cases'),
        request('/api/answers'),
        request('/api/scores'),
        request('/api/badcases'),
        request('/api/prompts'),
        request('/api/dashboard'),
        request('/api/analysis/summary'),
        request('/api/report'),
      ]);
      setConfig(configResult);
      setData({ cases, answers, scores, badcases, prompts, models: configResult.models || [], dashboard, analysis_summary: analysisSummary, report: report.markdown, snapshot_at: '', selection: null, config_summary: null });
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

  function applyUploadedSnapshot(snapshot, filename = 'snapshot.json') {
    if (!Array.isArray(snapshot.cases) || !Array.isArray(snapshot.answers)) {
      throw new Error('不是有效的评测结果 snapshot.json');
    }
    const normalized = normalizeSnapshot(snapshot);
    setData(normalized);
    setConfig(configFromSnapshot(normalized));
    setMode('uploaded');
    setLastRun(null);
    setTab('dashboard');
    setMessage(`已加载评测结果：${filename}`);
  }

  async function uploadResultFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      applyUploadedSnapshot(JSON.parse(await file.text()), file.name);
    } catch (err) {
      setMessage(`上传失败：${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  const ctx = { data, config, mode, lastRun, setConfig, setMessage, setLastRun, setTab, loadAll, applyUploadedSnapshot };
  const tabs = [
    ['dashboard', BarChart3, '总览'],
    ['config', KeyRound, '配置'],
    ['run', PlayCircle, '运行评测'],
    ['results', FolderOpen, '结果中心'],
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
        <label className={`secondary file sidebarUpload ${loading ? 'disabled' : ''}`}><Upload size={16} /> 上传评测结果<input type="file" accept=".json,application/json" onChange={uploadResultFile} disabled={loading} /></label>
        <button className="secondary" onClick={loadAll}><RefreshCw size={16} /> 刷新数据</button>
      </aside>
      <main className="main">
        <header>
          <div>
            <p className="eyebrow">AI Product Workflow</p>
            <h2>{tabs.find((x) => x[0] === tab)?.[2]}</h2>
          </div>
          <div className={`status ${mode !== 'live' ? 'snapshot' : ''}`}>
            {loading ? '同步中...' : message || 'FastAPI + React + SQLite'}
          </div>
        </header>
        {mode !== 'live' && <div className="notice">当前为只读快照模式：结果来自已导出的文件，不能新增问题或重新调用模型。</div>}
        {tab === 'dashboard' && <Dashboard {...ctx} />}
        {tab === 'config' && <ConfigPanel {...ctx} />}
        {tab === 'run' && <RunEvaluation {...ctx} />}
        {tab === 'results' && <ResultsCenter {...ctx} />}
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

function ConfigPanel({ config, mode, setConfig, setMessage }) {
  const [baseUrl, setBaseUrl] = useState(config.base_url || '');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [models, setModels] = useState(config.models || []);
  const [newModel, setNewModel] = useState('');
  const [defaultAnswerModels, setDefaultAnswerModels] = useState(config.default_answer_models || []);
  const [defaultJudgeModel, setDefaultJudgeModel] = useState(config.default_judge_model || '');
  const [summaryModel, setSummaryModel] = useState(config.summary_model || '');
  const [maxWorkers, setMaxWorkers] = useState(config.max_workers || 4);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setBaseUrl(config.base_url || '');
    setModels(config.models || []);
    setDefaultAnswerModels(config.default_answer_models || []);
    setDefaultJudgeModel(config.default_judge_model || '');
    setSummaryModel(config.summary_model || '');
    setMaxWorkers(config.max_workers || 4);
  }, [config.base_url, config.models, config.default_answer_models, config.default_judge_model, config.summary_model, config.max_workers]);

  function addModel() {
    const model = newModel.trim();
    if (!model || models.includes(model)) return;
    setModels((items) => [...items, model]);
    setDefaultAnswerModels((items) => items.length ? items : [model]);
    if (!defaultJudgeModel) setDefaultJudgeModel(model);
    if (!summaryModel) setSummaryModel(model);
    setNewModel('');
  }

  function removeModel(model) {
    if (models.length <= 1) return;
    const nextModels = models.filter((item) => item !== model);
    setModels(nextModels);
    setDefaultAnswerModels((items) => items.filter((item) => item !== model));
    if (defaultJudgeModel === model) setDefaultJudgeModel(nextModels[0] || '');
    if (summaryModel === model) setSummaryModel(nextModels[0] || '');
  }

  function toggleDefaultAnswer(model) {
    setDefaultAnswerModels((items) => items.includes(model) ? items.filter((item) => item !== model) : [...items, model]);
  }

  async function saveConfig(e) {
    e.preventDefault();
    if (mode !== 'live') return;
    const payload = {
      base_url: baseUrl,
      clear_api_key: clearApiKey,
      models,
      default_answer_models: defaultAnswerModels,
      default_judge_model: defaultJudgeModel,
      summary_model: summaryModel,
      max_workers: Number(maxWorkers) || 4,
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    const saved = await request('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
    setConfig(saved);
    setApiKey('');
    setClearApiKey(false);
    setMessage(`配置已保存到本地：${saved.api_key_mask ? `密钥 ${saved.api_key_mask}` : '未保存密钥'}`);
  }

  async function testConnection() {
    if (mode !== 'live') return;
    setTesting(true);
    try {
      const result = await request('/api/config/test', {
        method: 'POST',
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: apiKey.trim() || undefined,
          model: defaultJudgeModel || models[0] || '',
        }),
      });
      setMessage(`连接成功：${result.model} ${result.message || ''}`);
    } catch (err) {
      setMessage(`连接失败：${err.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="configGrid">
      <form className="panel configPanel" onSubmit={saveConfig}>
        <h3><KeyRound size={18} /> 接口配置</h3>
        <label className="fieldControl">
          <span>Base URL</span>
          <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={mode !== 'live'} required />
        </label>
        <label className="fieldControl">
          <span>API Key {config.has_api_key && config.api_key_mask ? `（已保存 ${config.api_key_mask}）` : ''}</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config.has_api_key ? '留空则继续使用已保存密钥' : '输入后保存到 backend/.env'} disabled={mode !== 'live'} />
        </label>
        <label className="checkLine">
          <input type="checkbox" checked={clearApiKey} onChange={(e) => setClearApiKey(e.target.checked)} disabled={mode !== 'live'} />
          <span>保存时清除已保存密钥</span>
        </label>
        <div className="buttonRow">
          <button disabled={mode !== 'live'}><Save size={16} /> 保存配置</button>
          <button type="button" className="secondary" onClick={testConnection} disabled={testing || mode !== 'live'}><ShieldCheck size={16} /> {testing ? '测试中...' : '测试连接'}</button>
        </div>
      </form>

      <div className="panel configPanel">
        <h3><Settings2 size={18} /> 模型收藏</h3>
        <div className="modelAdd">
          <input placeholder="输入模型名" value={newModel} onChange={(e) => setNewModel(e.target.value)} disabled={mode !== 'live'} />
          <button type="button" onClick={addModel} disabled={mode !== 'live'}><Plus size={16} /> 添加</button>
        </div>
        <div className="modelList">
          {models.map((model) => (
            <div className="modelChip" key={model}>
              <span>{model}</span>
              <button type="button" className="iconBtn dangerBtn" onClick={() => removeModel(model)} disabled={mode !== 'live' || models.length <= 1} title="删除模型"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <form className="panel configPanel wideConfig" onSubmit={saveConfig}>
        <h3><ListChecks size={18} /> 默认运行参数</h3>
        <div className="checkboxGrid">
          {models.map((model) => (
            <label key={model} className="checkLine">
              <input type="checkbox" checked={defaultAnswerModels.includes(model)} onChange={() => toggleDefaultAnswer(model)} disabled={mode !== 'live'} />
              <span>{model}</span>
            </label>
          ))}
        </div>
        <div className="row">
          <label className="fieldControl">
            <span>默认评审模型</span>
            <select value={defaultJudgeModel} onChange={(e) => setDefaultJudgeModel(e.target.value)} disabled={mode !== 'live'}>
              {models.map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
          <label className="fieldControl">
            <span>总结模型</span>
            <select value={summaryModel} onChange={(e) => setSummaryModel(e.target.value)} disabled={mode !== 'live'}>
              {models.map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
          <label className="fieldControl smallControl">
            <span>并发数</span>
            <input type="number" min="1" max="8" value={maxWorkers} onChange={(e) => setMaxWorkers(e.target.value)} disabled={mode !== 'live'} />
          </label>
        </div>
        <button disabled={mode !== 'live'}><Save size={16} /> 保存默认参数</button>
      </form>
    </section>
  );
}

function RunEvaluation({ data, config, mode, loadAll, setMessage, setLastRun, setTab }) {
  const [query, setQuery] = useState('');
  const [scenario, setScenario] = useState('全部');
  const [difficulty, setDifficulty] = useState('全部');
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [answerModels, setAnswerModels] = useState([]);
  const [judgeModel, setJudgeModel] = useState('');
  const [running, setRunning] = useState(false);
  const [newCase, setNewCase] = useState({ question: '', scenario: '通用问答', difficulty: '中', expected_answer: '', notes: '' });

  const modelKey = (config.models || []).join('|');
  const defaultAnswerKey = (config.default_answer_models || []).join('|');

  useEffect(() => {
    const available = config.models || [];
    setAnswerModels((items) => {
      const valid = items.filter((item) => available.includes(item));
      if (valid.length) return valid;
      return (config.default_answer_models || []).filter((item) => available.includes(item));
    });
    setJudgeModel((current) => current && available.includes(current) ? current : (config.default_judge_model || available[0] || ''));
  }, [modelKey, defaultAnswerKey, config.default_judge_model]);

  const filteredCases = useMemo(() => data.cases.filter((item) => {
    const text = `${item.question} ${item.expected_answer}`.toLowerCase();
    const matchText = text.includes(query.toLowerCase());
    const matchScenario = scenario === '全部' || item.scenario === scenario;
    const matchDifficulty = difficulty === '全部' || item.difficulty === difficulty;
    return matchText && matchScenario && matchDifficulty;
  }), [data.cases, query, scenario, difficulty]);

  const selectedSet = useMemo(() => new Set(selectedCaseIds), [selectedCaseIds]);

  function toggleCase(caseId) {
    setSelectedCaseIds((items) => items.includes(caseId) ? items.filter((id) => id !== caseId) : [...items, caseId]);
  }

  function toggleAnswerModel(model) {
    setAnswerModels((items) => items.includes(model) ? items.filter((item) => item !== model) : [...items, model]);
  }

  async function addCustomCase(e) {
    e.preventDefault();
    if (mode !== 'live') return;
    const created = await request('/api/cases', { method: 'POST', body: JSON.stringify(newCase) });
    setSelectedCaseIds((items) => [...new Set([...items, created.id])]);
    setNewCase({ question: '', scenario: '通用问答', difficulty: '中', expected_answer: '', notes: '' });
    setMessage(`已新增并选中 Case #${created.id}`);
    loadAll();
  }

  async function runEvaluation() {
    if (mode !== 'live') return;
    if (!selectedCaseIds.length) {
      setMessage('请至少选择一个评测问题');
      return;
    }
    if (!answerModels.length) {
      setMessage('请至少选择一个回答模型');
      return;
    }
    if (!judgeModel) {
      setMessage('请先选择评审模型');
      return;
    }
    setRunning(true);
    try {
      const result = await request('/api/answers/batch-generate', {
        method: 'POST',
        body: JSON.stringify({
          case_ids: selectedCaseIds,
          model_names: answerModels,
          replace_mock: true,
          auto_score: true,
          judge_model: judgeModel,
          max_workers: config.max_workers || 4,
        }),
      });
      const run = {
        case_ids: selectedCaseIds,
        model_names: answerModels,
        judge_model: judgeModel,
        result,
        finished_at: new Date().toISOString(),
      };
      setLastRun(run);
      await loadAll();
      const scores = result.scores || {};
      setMessage(`评测完成：回答新增 ${result.created}，替换 ${result.replaced}，失败 ${result.failed}；评分新增 ${scores.created || 0}，Badcase ${scores.badcases || 0}`);
      setTab('results');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="runLayout">
      <div className="panel runPanel">
        <div className="tableHead">
          <h3><ClipboardList size={18} /> 选择问题</h3>
          <span>{selectedCaseIds.length} / {data.cases.length}</span>
        </div>
        <div className="filters tripleFilters">
          <label><Search size={16} /><input placeholder="搜索问题或期望行为" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {['全部', ...SCENARIOS].map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {['全部', ...DIFFICULTIES].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="buttonRow">
          <button type="button" className="secondary" onClick={() => setSelectedCaseIds(data.cases.map((item) => item.id))}><CheckSquare size={16} /> 全部</button>
          <button type="button" className="secondary" onClick={() => setSelectedCaseIds(filteredCases.map((item) => item.id))}><Eye size={16} /> 当前筛选</button>
          <button type="button" className="secondary" onClick={() => setSelectedCaseIds([])}><Square size={16} /> 清空</button>
        </div>
        <div className="casePicker">
          {filteredCases.map((item) => (
            <button type="button" className={`casePick ${selectedSet.has(item.id) ? 'selected' : ''}`} key={item.id} onClick={() => toggleCase(item.id)}>
              <span>#{item.id} {item.scenario} / {item.difficulty}</span>
              <b>{item.question}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="sideStack">
        <form className="panel runPanel" onSubmit={addCustomCase}>
          <h3><Plus size={18} /> 自创问题</h3>
          <input placeholder="用户问题" value={newCase.question} onChange={(e) => setNewCase({ ...newCase, question: e.target.value })} required disabled={mode !== 'live'} />
          <div className="row">
            <select value={newCase.scenario} onChange={(e) => setNewCase({ ...newCase, scenario: e.target.value })} disabled={mode !== 'live'}>
              {SCENARIOS.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={newCase.difficulty} onChange={(e) => setNewCase({ ...newCase, difficulty: e.target.value })} disabled={mode !== 'live'}>
              {DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <textarea placeholder="期望行为或评分参考口径" value={newCase.expected_answer} onChange={(e) => setNewCase({ ...newCase, expected_answer: e.target.value })} required disabled={mode !== 'live'} />
          <button disabled={mode !== 'live'}><Send size={16} /> 新增并选中</button>
        </form>

        <div className="panel runPanel">
          <h3><BrainCircuit size={18} /> 选择模型</h3>
          <div className="checkboxGrid compactChecks">
            {(config.models || []).map((model) => (
              <label className="checkLine" key={model}>
                <input type="checkbox" checked={answerModels.includes(model)} onChange={() => toggleAnswerModel(model)} disabled={mode !== 'live'} />
                <span>{model}</span>
              </label>
            ))}
          </div>
          <label className="fieldControl">
            <span>评审模型</span>
            <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} disabled={mode !== 'live'}>
              {(config.models || []).map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
          <button className="runButton" onClick={runEvaluation} disabled={running || mode !== 'live'}><PlayCircle size={17} /> {running ? '评测中...' : '开始评测'}</button>
        </div>
      </div>
    </section>
  );
}

function ResultsCenter({ data, config, mode, lastRun, setMessage, applyUploadedSnapshot }) {
  const [saving, setSaving] = useState(false);
  const selection = lastRun || data.selection || null;
  const selectedCaseCount = selection?.case_ids?.length || data.cases.length;
  const selectedModelCount = selection?.model_names?.length || data.models.length;
  const visibleAnswers = useMemo(() => {
    if (!selection?.case_ids?.length && !selection?.model_names?.length) return data.answers;
    const caseSet = new Set(selection.case_ids || []);
    const modelSet = new Set(selection.model_names || []);
    return data.answers.filter((answer) => (
      (!caseSet.size || caseSet.has(answer.case_id)) &&
      (!modelSet.size || modelSet.has(answer.model_name))
    ));
  }, [data.answers, selection]);
  const visibleAnswerIds = useMemo(() => new Set(visibleAnswers.map((answer) => answer.id)), [visibleAnswers]);
  const visibleScores = useMemo(() => data.scores.filter((score) => visibleAnswerIds.has(score.answer_id)), [data.scores, visibleAnswerIds]);
  const visibleBadcases = useMemo(() => data.badcases.filter((badcase) => visibleAnswerIds.has(badcase.answer_id)), [data.badcases, visibleAnswerIds]);

  async function saveResult() {
    if (mode !== 'live') return;
    const target = lastRun || {
      case_ids: data.cases.map((item) => item.id),
      model_names: data.models,
      judge_model: config.default_judge_model,
      result: {},
    };
    setSaving(true);
    try {
      const result = await request('/api/results/save', {
        method: 'POST',
        body: JSON.stringify({
          case_ids: target.case_ids,
          model_names: target.model_names,
          judge_model: target.judge_model,
          run_result: target.result || {},
        }),
      });
      setMessage(`已保留到本地：${result.files.dir_path}`);
    } finally {
      setSaving(false);
    }
  }

  async function uploadSnapshot(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      applyUploadedSnapshot(JSON.parse(await file.text()), file.name);
    } catch (err) {
      setMessage(`上传失败：${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  return (
    <section className="resultsGrid">
      <div className="panel resultPanel">
        <h3><Save size={18} /> 保留本次结果</h3>
        <div className="resultStats">
          <span>问题 <b>{selectedCaseCount}</b></span>
          <span>模型 <b>{selectedModelCount}</b></span>
          <span>回答 <b>{visibleAnswers.length}</b></span>
          <span>评分 <b>{visibleScores.length}</b></span>
          <span>Badcase <b>{visibleBadcases.length}</b></span>
        </div>
        {selection?.judge_model && <p className="helperBar">评审模型：{selection.judge_model}</p>}
        <button onClick={saveResult} disabled={saving || mode !== 'live'}><FolderOpen size={16} /> {saving ? '保存中...' : '保留到本地'}</button>
      </div>

      <div className="panel resultPanel">
        <h3><Upload size={18} /> 上传评测结果</h3>
        <label className="file uploadResult"><Upload size={16} /> 选择 snapshot.json<input type="file" accept=".json,application/json" onChange={uploadSnapshot} /></label>
        <p className="summaryMeta">当前快照：{data.snapshot_at || (mode === 'live' ? '实时数据库' : '已加载文件')}</p>
      </div>

      <div className="card report resultReport">
        <h3>当前报告预览</h3>
        <pre>{data.report || '暂无报告'}</pre>
      </div>
    </section>
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
      setMessage('只读快照模式不能调用模型，请在本地启动 FastAPI 后生成总结');
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
          <h3><BrainCircuit size={18} /> 评测总结</h3>
          <button className="secondary importantAction" onClick={refreshSummary} disabled={summarizing || mode !== 'live'}>
            {summarizing ? '生成中...' : '生成评测总结'}
          </button>
        </div>
        <p className="summaryMeta">
          {data.analysis_summary?.model || 'local-fallback'} / {data.analysis_summary?.generated_at || '未生成'}
        </p>
        <pre>{data.analysis_summary?.summary || '暂无总结。点击按钮后会调用配置中的总结模型分析全部评分、领域表现和 Badcase。'}</pre>
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
          <h3><ListChecks size={18} /> 期望行为怎么来的</h3>
          <p>这里的评分参考不是要求模型逐字匹配某一段“标准答案”，而是评测人员按产品预期手工写出的“期望行为”：应包含哪些步骤、哪些限制不能越界、遇到实时数据或高风险问题时应该如何处理。</p>
          <p>新增 Case 时，前端填写的是“期望行为或评分参考口径”；CSV 导入时对应 expected_answer 列。它更像评测 Rubric 的简化表达，而不是唯一正确答案。</p>
        </div>
        <div className="panel">
          <h3><ShieldCheck size={18} /> 如何评估规范性</h3>
          <p>自动评分不是让每个模型自己给自己打分。后端默认用独立评审模型读取用户问题、期望行为和模型回答；如果被评模型与评审模型相同，会自动切换备用评审模型，降低自评偏差。</p>
          <p>评分前先执行硬规则：调用失败、超时、空回答、只输出工具调用/XML/JSON、需要实时工具却编造结果等，会直接被压低到 1-2 分并标记 Badcase。这样可以避免“语言流畅但事实或能力边界错误”的回答拿到虚高分。</p>
        </div>
        <div className="panel">
          <h3><GitBranch size={18} /> 快照展示逻辑</h3>
          <p>本地调试读实时 API；历史评测可上传 snapshot.json 进入只读快照模式。快照会直接驱动总览图表、模型对比、Badcase 和报告展示，不需要重新运行模型。</p>
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

      <div className="panel flowPanel">
        <h3>评测公平性要点</h3>
        <div className="flowSteps">
          <div className="flowStep">
            <span>A</span>
            <b>同题同口径</b>
            <p>所有模型面对同一批 Case，并对照同一套期望行为评分，保证横向比较基础一致。</p>
          </div>
          <div className="flowStep">
            <span>B</span>
            <b>先规则后评审</b>
            <p>空回答、调用失败、伪工具调用、编造实时结果等明显问题先由硬规则处理，再交给评审模型细分打分。</p>
          </div>
          <div className="flowStep">
            <span>C</span>
            <b>避免自评偏差</b>
            <p>当被评模型与评审模型相同，系统自动切换备用评审模型，降低模型“自己给自己打分”的偏差。</p>
          </div>
          <div className="flowStep">
            <span>D</span>
            <b>结果可复盘</b>
            <p>每条评分会保留原因和建议，Badcase 会沉淀归因，便于后续 Prompt 与产品策略迭代。</p>
          </div>
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
        <p className="helperBar">这里填写的不是唯一“标准答案”，而是用于评分的期望行为口径：希望模型覆盖哪些关键步骤、限制条件和风险提示。</p>
        <input placeholder="用户问题" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required disabled={mode !== 'live'} />
        <div className="row">
          <select value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} disabled={mode !== 'live'}>
            {SCENARIOS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} disabled={mode !== 'live'}>
            {DIFFICULTIES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <textarea placeholder="期望行为或评分参考口径" value={form.expected_answer} onChange={(e) => setForm({ ...form, expected_answer: e.target.value })} required disabled={mode !== 'live'} />
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
          <label><Search size={16} /><input placeholder="搜索问题或期望行为" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
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

function Compare({ data, config, mode, loadAll, setMessage }) {
  const [caseId, setCaseId] = useState('');
  const [model, setModel] = useState(config.default_answer_models?.[0] || data.models[0] || '');
  const [batching, setBatching] = useState(false);
  const selected = data.cases.find((c) => c.id === Number(caseId)) || data.cases[0];
  const answers = data.answers.filter((a) => selected && a.case_id === selected.id);
  const scoresByAnswer = useMemo(() => Object.fromEntries(data.scores.map((s) => [s.answer_id, s])), [data.scores]);
  const answeredCaseIds = useMemo(() => new Set(data.answers.map((a) => a.case_id)), [data.answers]);
  const unansweredCaseCount = data.cases.filter((c) => !answeredCaseIds.has(c.id)).length;

  useEffect(() => {
    if (!data.models.length) return;
    if (!model || !data.models.includes(model)) {
      setModel(config.default_answer_models?.find((item) => data.models.includes(item)) || data.models[0]);
    }
  }, [data.models, config.default_answer_models, model]);

  async function generate() {
    if (!selected || mode !== 'live') return;
    await request('/api/answers/generate', { method: 'POST', body: JSON.stringify({ case_id: selected.id, model_name: model, prompt_version: 'v1.0' }) });
    setMessage('模型回答已生成');
    loadAll();
  }

  async function autoJudge(answerId) {
    if (mode !== 'live') return;
    await request('/api/scores/auto', { method: 'POST', body: JSON.stringify({ answer_id: answerId, judge_model: config.default_judge_model || data.models[0] || '' }) });
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
          judge_model: config.default_judge_model || data.models[0] || '',
          max_workers: config.max_workers || 4,
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
          judge_model: config.default_judge_model || data.models[0] || '',
          max_workers: config.max_workers || 4,
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
      <div className="helperBar">
        自动评分采用“硬规则 + 独立评审模型”两层机制。这里展示的“期望行为”是评分参考口径，不要求模型逐字匹配，但要求覆盖关键步骤、边界和限制。
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
