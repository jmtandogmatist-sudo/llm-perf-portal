import os
import glob
import json
import argparse
from typing import List, Dict, Any
from jinja2 import Template

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>LLM 性能趋势对比报告</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f4f7f9; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 25px; margin-bottom: 20px; }
        h1, h2 { color: #2c3e50; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
        .chart-container { position: relative; height: 400px; width: 100%; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; }
    </style>
</head>
<body>
    <h1>📊 LLM 性能趋势对比报告</h1>

    <div class="card">
        <h2>整体测试概览</h2>
        <p>基于发现的 {{ total_reports }} 份测试报告，共涉及 {{ models | length }} 个不同模型，并发量分布为: {{ concurrencies | sort }}。</p>
    </div>

    <div class="grid">
        <div class="card">
            <h2>QPS随并发数变化趋势</h2>
            <div class="chart-container">
                <canvas id="qpsChart"></canvas>
            </div>
        </div>
        <div class="card">
            <h2>TPS(Token吞吐量)随并发数变化趋势</h2>
            <div class="chart-container">
                <canvas id="tpsChart"></canvas>
            </div>
        </div>
        <div class="card">
            <h2>P95总延迟随并发数变化趋势</h2>
            <div class="chart-container">
                <canvas id="latencyChart"></canvas>
            </div>
        </div>
        <div class="card">
            <h2>P95首字延迟(TTFT)趋势</h2>
            <div class="chart-container">
                <canvas id="ttftChart"></canvas>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>测试数据详情列表</h2>
        <table>
            <tr>
                <th>模型名称</th>
                <th>并发数</th>
                <th>持续时间(s)</th>
                <th>QPS</th>
                <th>TPS</th>
                <th>P95总延迟(ms)</th>
                <th>P95 TTFT(ms)</th>
                <th>成功数/总请求</th>
            </tr>
            {% for row in all_stats %}
            <tr>
                <td>{{ row.model }}</td>
                <td>{{ row.concurrency }}</td>
                <td>{{ row.duration }}</td>
                <td>{{ row.qps }}</td>
                <td>{{ row.tps }}</td>
                <td>{{ row.p95_latency }}</td>
                <td>{{ row.p95_ttft }}</td>
                <td>{{ row.successful }} / {{ row.total_requests }}</td>
            </tr>
            {% endfor %}
        </table>
    </div>

    <script>
        const chartColors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe'];
        const chartData = {{ chart_data | tojson | safe }};
        const allConcurrencies = {{ concurrencies | sort | tojson | safe }};
        
        // 构造 Dataset
        function buildDatasets(metricField) {
            return Object.keys(chartData).map((model, index) => {
                const modelData = chartData[model];
                const dataPoints = allConcurrencies.map(c => {
                    const row = modelData.find(item => item.concurrency === c);
                    return row ? row[metricField] : null;
                });
                return {
                    label: model,
                    data: dataPoints,
                    borderColor: chartColors[index % chartColors.length],
                    backgroundColor: chartColors[index % chartColors.length],
                    tension: 0.1,
                    fill: false,
                    spanGaps: true
                };
            });
        }

        const commonOptions = { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: { x: { title: { display: true, text: '并发数' } } } 
        };

        // QPS Chart
        new Chart(document.getElementById('qpsChart').getContext('2d'), {
            type: 'line',
            data: { labels: allConcurrencies, datasets: buildDatasets('qps') },
            options: { ...commonOptions, scales: { ...commonOptions.scales, y: { beginAtZero: true, title: { display: true, text: 'QPS' } } } }
        });

        // TPS Chart
        new Chart(document.getElementById('tpsChart').getContext('2d'), {
            type: 'line',
            data: { labels: allConcurrencies, datasets: buildDatasets('tps') },
            options: { ...commonOptions, scales: { ...commonOptions.scales, y: { beginAtZero: true, title: { display: true, text: 'TPS' } } } }
        });

        // P95 Latency Chart
        new Chart(document.getElementById('latencyChart').getContext('2d'), {
            type: 'line',
            data: { labels: allConcurrencies, datasets: buildDatasets('p95_latency') },
            options: { ...commonOptions, scales: { ...commonOptions.scales, y: { beginAtZero: true, title: { display: true, text: '延迟 (ms)' } } } }
        });

        // P95 TTFT Chart
        new Chart(document.getElementById('ttftChart').getContext('2d'), {
            type: 'line',
            data: { labels: allConcurrencies, datasets: buildDatasets('p95_ttft') },
            options: { ...commonOptions, scales: { ...commonOptions.scales, y: { beginAtZero: true, title: { display: true, text: 'TTFT (ms)' } } } }
        });
    </script>
</body>
</html>
"""

def analyze(input_dir: str, output_dir: str):
    json_files = glob.glob(os.path.join(input_dir, "*_results.json"))
    if not json_files:
        print(f"在 {input_dir} 目录下未找到任何 *_results.json 报告文件。")
        return

    all_stats = []
    for f in json_files:
        try:
            with open(f, 'r', encoding='utf-8') as file:
                data = json.load(file)
                if "stats" in data:
                    all_stats.append(data["stats"])
        except Exception as e:
            print(f"读取或解析 {f} 时出错: {e}")

    if not all_stats:
        print("未提取到任何有效数据。")
        return

    # 按照并发数和模型排序以方便页面上的表格展示
    all_stats.sort(key=lambda x: (x.get("model", ""), x.get("concurrency", 0)))
    
    # 提取有哪些模型，有哪些并发数用于画图
    models = list(set([s["model"] for s in all_stats]))
    concurrencies = list(set([s["concurrency"] for s in all_stats]))
    
    # 构造画图所需要的数据结构： { "modelA": [ stat1, stat2 ], "modelB": [...] }
    chart_data = {}
    for stat in all_stats:
        model = stat["model"]
        if model not in chart_data:
            chart_data[model] = []
        chart_data[model].append(stat)

    os.makedirs(output_dir, exist_ok=True)
    report_path = os.path.join(output_dir, "trend_comparison_report.html")

    template = Template(HTML_TEMPLATE)
    html_output = template.render(
        total_reports=len(all_stats),
        models=models,
        concurrencies=concurrencies,
        all_stats=all_stats,
        chart_data=chart_data
    )

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(html_output)
    
    print(f"✅ 生成趋势对比报告成功！\n文件存放在: {report_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="分析该目录下的所有结果生成趋势对比与图表")
    parser.add_argument("--input-dir", default="reports", help="包含结果JSON的输入目录")
    parser.add_argument("--output-dir", default="reports", help="对比HTML报告输出目录")
    args = parser.parse_args()
    
    analyze(args.input_dir, args.output_dir)
