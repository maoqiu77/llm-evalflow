from __future__ import annotations

from pathlib import Path
import re
import subprocess
import time
from typing import Iterable

README_MARKER_START = "<!-- screenshots:start -->"
README_MARKER_END = "<!-- screenshots:end -->"
SCREENSHOT_DIR_NAME = "screenshots"

SCREENSHOTS = [
    {
        "slug": "dashboard",
        "tab": "dashboard",
        "title": "Dashboard 总览",
        "alt": "Dashboard 总览截图",
        "description": "展示题库规模、完成进度、模型平均分和 Badcase 分布。",
    },
    {
        "slug": "compare",
        "tab": "compare",
        "title": "模型对比",
        "alt": "模型对比截图",
        "description": "展示同一 Case 下不同模型的回答、评分结果和首屏差异。",
    },
    {
        "slug": "badcase",
        "tab": "badcase",
        "title": "Badcase 归因",
        "alt": "Badcase 归因截图",
        "description": "展示低分样本、问题类型和首屏优化建议。",
    },
    {
        "slug": "report",
        "tab": "report",
        "title": "评测报告",
        "alt": "评测报告截图",
        "description": "展示自动生成的 Markdown 评测报告。",
    },
]


class ScreenshotExportError(RuntimeError):
    pass


def run_readme_screenshot_export(*, root_dir: Path, base_url: str = "http://127.0.0.1:5173") -> dict[str, object]:
    screenshot_dir = root_dir / "docs" / SCREENSHOT_DIR_NAME
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    script_path = root_dir / "frontend" / "scripts" / "capture_readme_screenshots.mjs"

    if not script_path.exists():
        raise ScreenshotExportError(f"未找到截图脚本：{script_path}")

    ensure_frontend_ready(base_url)

    command = [
        "npm",
        "run",
        "capture:readme-screenshots",
        "--",
        f"--base-url={base_url}",
        f"--output-dir={screenshot_dir}",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=root_dir / "frontend",
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        detail = stderr or stdout or str(exc)
        raise ScreenshotExportError(f"自动截图失败：{detail}") from exc

    readme_path = root_dir / "README.md"
    update_readme_screenshot_section(readme_path)

    files = [str(screenshot_dir / f"{item['slug']}.png") for item in SCREENSHOTS]
    return {
        "screenshot_dir": str(screenshot_dir),
        "readme_path": str(readme_path),
        "files": files,
        "stdout": (completed.stdout or "").strip(),
    }


def ensure_frontend_ready(base_url: str, timeout_seconds: int = 30) -> None:
    import urllib.request
    import urllib.error

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base_url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(1)
    raise ScreenshotExportError(
        f"前端页面未启动：{base_url}。请先运行前端开发服务器，再执行导出。"
    )


def update_readme_screenshot_section(readme_path: Path) -> None:
    content = readme_path.read_text(encoding="utf-8")
    section = build_readme_screenshot_section()
    pattern = re.compile(
        rf"{re.escape(README_MARKER_START)}[\s\S]*?{re.escape(README_MARKER_END)}",
        re.MULTILINE,
    )
    replacement = f"{README_MARKER_START}\n{section}\n{README_MARKER_END}"
    if pattern.search(content):
        content = pattern.sub(replacement, content, count=1)
    else:
        insert_after_candidates = [
            "- 模型调用：OpenAI SDK 兼容接口\n",
            "这是一个面向 AI 产品经理、问答策略和 Agent 产品岗位的轻量评测平台，支持：\n",
        ]
        inserted = False
        for marker in insert_after_candidates:
            if marker in content:
                content = content.replace(marker, marker + "\n" + replacement + "\n", 1)
                inserted = True
                break
        if not inserted:
            content = content + "\n\n" + replacement + "\n"
    readme_path.write_text(content, encoding="utf-8")


def build_readme_screenshot_section() -> str:
    lines: list[str] = [
        "## 页面预览",
        "",
        "以下截图由本地“导出 GitHub 展示”流程自动生成，推送到 GitHub 后会同步显示在仓库首页。",
        "",
    ]
    for item in SCREENSHOTS:
        lines.extend([
            f"### {item['title']}",
            item["description"],
            f"![{item['alt']}](docs/{SCREENSHOT_DIR_NAME}/{item['slug']}.png)",
            "",
        ])
    return "\n".join(lines).rstrip()
