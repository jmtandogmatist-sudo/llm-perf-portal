import { jsPDF } from "jspdf";
import {
  loadChineseFont,
  drawPageHeader,
  drawPageFooter,
  drawTable,
  drawRiskBadge,
} from "./pdfUtils";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export type LoadMode = "constant" | "ramp_up" | "fluctuate" | "spike";

export interface ReportConfig {
  apiProvider: string;
  apiUrl: string;
  model: string;
  loadMode: LoadMode;
  loadConfig: Record<string, unknown>;
  inputType: "text" | "image" | "json" | "video";
}

export interface ReportResults {
  totalRequests?: number;
  successfulRequests?: number;
  successRate?: number | string;
  ttftAvg?: number | string;
  ttftP95?: number | string;
  ttftP99?: number | string;
  tpsAvg?: number | string;
  itlAvg?: number | string;
  qps?: number | string;
  avgLatency?: number | string;
  p95Latency?: number | string;
  analysis?: string[];
  testType?: string;
}

interface ReportMetricSet {
  totalRequests: number;
  successfulRequests: number;
  successRate: number;
  ttftAvg: number;
  ttftP95: number;
  ttftP99: number;
  tpsAvg: number;
  itlAvg: number;
  qps: number;
  avgLatency: number;
  p95Latency: number;
}

export interface TestReportPayload {
  generatedAt: string;
  config: ReportConfig;
  results: ReportMetricSet;
  analysis: string[];
  conclusion: string;
  testType?: string;
}

type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

const COMPANY_NAME = "Silicon Valley AI Performance Lab";
const COMPANY_TAGLINE = "LLM Engineering Advisory";
const REPORT_TITLE = "LLM Performance Advisory Report";
const LOGO_PUBLIC_URL = "/branding/goldwind-logo.svg";

const toNumber = (value: number | string | undefined): number => {
  if (value === undefined || value === null) return 0;
  const normalized = String(value).replace(/%/g, "").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const createFileName = (prefix: string, ext: "json" | "pdf" | "docx") => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${ext}`;
};

const getRiskMeta = (payload: TestReportPayload) => {
  const failRate =
    payload.results.totalRequests > 0
      ? (payload.results.totalRequests - payload.results.successfulRequests) /
        payload.results.totalRequests
      : 0;
  const isRest = payload.testType === "REST_API";
  const p95 = isRest ? payload.results.p95Latency : payload.results.ttftP95;

  let level: RiskLevel = "LOW";
  if (failRate >= 0.05 || p95 >= (isRest ? 300 : 2000)) {
    level = "HIGH";
  } else if (failRate >= 0.01 || p95 >= (isRest ? 150 : 1200)) {
    level = "MEDIUM";
  }

  if (level === "HIGH") {
    return {
      level,
      label: "HIGH RISK",
      color: [220, 38, 38] as const,
      hex: "DC2626",
      summary: "High failure/latency risk. Immediate stabilization recommended.",
    };
  }

  if (level === "MEDIUM") {
    return {
      level,
      label: "MEDIUM RISK",
      color: [217, 119, 6] as const,
      hex: "D97706",
      summary: "Moderate volatility. Tune gateway and concurrency policy.",
    };
  }

  return {
    level,
    label: "LOW RISK",
    color: [22, 163, 74] as const,
    hex: "16A34A",
    summary: "Stable behavior in this test window.",
  };
};

const formatLoadConfig = (loadConfig: Record<string, unknown>) =>
  Object.entries(loadConfig)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

const dataUrlToUint8Array = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const loadLogoPngDataUrl = async (maxWidth = 180, maxHeight = 54) => {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Unable to render logo to canvas"));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Failed to load logo image"));
    image.src = `${LOGO_PUBLIC_URL}?v=20260519`;
  });
};

export const buildTestReportPayload = (
  config: ReportConfig,
  rawResults: ReportResults
): TestReportPayload => {
  const totalRequests = rawResults.totalRequests ?? 0;
  const successfulRequests = rawResults.successfulRequests ?? 0;
  const failedRequests = Math.max(0, totalRequests - successfulRequests);
  const successRate =
    rawResults.successRate !== undefined
      ? toNumber(rawResults.successRate)
      : totalRequests > 0
        ? Number.parseFloat(((successfulRequests / totalRequests) * 100).toFixed(2))
        : 0;

  const analysis = rawResults.analysis ?? [];
  const conclusion =
    failedRequests === 0
      ? "整体表现稳定，建议进入下一轮更高并发压测。"
      : failedRequests / Math.max(1, totalRequests) > 0.05
        ? "存在明显失败风险，建议先排查网关超时与限流策略。"
        : "存在少量失败请求，建议结合错误日志做针对性优化。";

  return {
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    config,
    results: {
      totalRequests,
      successfulRequests,
      successRate,
      ttftAvg: toNumber(rawResults.ttftAvg),
      ttftP95: toNumber(rawResults.ttftP95),
      ttftP99: toNumber(rawResults.ttftP99),
      tpsAvg: toNumber(rawResults.tpsAvg),
      itlAvg: toNumber(rawResults.itlAvg),
      qps: toNumber(rawResults.qps),
      avgLatency: toNumber(rawResults.avgLatency),
      p95Latency: toNumber(rawResults.p95Latency),
    },
    analysis,
    conclusion,
    testType: rawResults.testType,
  };
};

export const exportTestReportAsJson = (payload: TestReportPayload) => {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, createFileName("llm-advisory-report", "json"));
};

export const exportTestReportAsPdf = async (payload: TestReportPayload) => {
  const risk = getRiskMeta(payload);
  let logoDataUrl: string | null = null;
  try {
    logoDataUrl = await loadLogoPngDataUrl(220, 64);
  } catch {
    logoDataUrl = null;
  }

  const pdf = new jsPDF("p", "mm", "a4");
  
  // Load and register Chinese font
  try {
    await loadChineseFont(pdf);
  } catch (err) {
    console.error("Failed to load Chinese font:", err);
  }

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 16;
  const right = 16;
  const contentWidth = pageWidth - left - right;
  let y = 22;

  const ensurePage = (delta = 6) => {
    if (y + delta <= pageHeight - 16) return;
    pdf.addPage();
    y = 22;
  };

  const addText = (text: string, size = 11, bold = false, gap = 6) => {
    ensurePage(gap);
    pdf.setFont("NotoSansSC", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, contentWidth);
    pdf.text(lines, left, y);
    y += lines.length * 5 + (gap - 5);
  };

  const addSectionTitle = (title: string) => {
    ensurePage(10);
    pdf.setDrawColor(229, 231, 235);
    pdf.line(left, y - 2, pageWidth - right, y - 2);
    addText(title, 13, true, 7);
  };

  const isRest = payload.testType === "REST_API";
  const dynamicReportTitle = isRest ? "API Performance Advisory Report" : REPORT_TITLE;

  // PAGE 1: Cover Page
  pdf.setFillColor(17, 24, 39);
  pdf.rect(0, 0, pageWidth, 64, "F");
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "PNG", left, 14, 42, 12);
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("NotoSansSC", "bold");
  pdf.setFontSize(11);
  pdf.text(COMPANY_NAME, left, 34);
  pdf.setFont("NotoSansSC", "normal");
  pdf.setFontSize(9);
  pdf.text(COMPANY_TAGLINE, left, 41);
  pdf.setFont("NotoSansSC", "bold");
  pdf.setFontSize(22);
  pdf.text(dynamicReportTitle, left, 55);

  pdf.setTextColor(17, 24, 39);
  drawRiskBadge(pdf, risk.label, risk.color, left, 76, 52, 11);

  pdf.setTextColor(17, 24, 39);
  pdf.setFont("NotoSansSC", "normal");
  pdf.setFontSize(11);
  pdf.text(`报告生成时间: ${payload.generatedAt}`, left, 98);
  pdf.text(isRest ? `测试配置: ${payload.config.model || "默认配置"}` : `测试模型: ${payload.config.model}`, left, 106);
  pdf.text(isRest ? `接口地址: ${payload.config.apiUrl}` : `接口服务商: ${payload.config.apiProvider}`, left, 114);
  pdf.text(`评估简报: ${risk.summary}`, left, 122);

  // PAGE 2: Table of Contents
  pdf.addPage();
  y = 24;
  addText("报告目录 / Table of Contents", 16, true, 8);
  addText("1. Executive Summary / 执行摘要 ..................................................... 3", 11, false, 8);
  addText("2. Risk Assessment / 风险评估 ....................................................... 3", 11, false, 8);
  addText("3. Test Configuration / 测试配置 .................................................... 4", 11, false, 8);
  addText("4. Key Metrics / 性能关键指标 ....................................................... 4", 11, false, 8);
  addText("5. Expert Analysis / 专家诊断与建议 ................................................. 5", 11, false, 8);

  // PAGE 3: Main body
  pdf.addPage();
  y = 24;

  addSectionTitle("1. Executive Summary / 执行摘要");
  addText(
    isRest
      ? `请求成功率: ${payload.results.successRate.toFixed(2)}% | 平均 QPS: ${payload.results.qps.toFixed(2)} | P95 响应延迟: ${payload.results.p95Latency.toFixed(2)} ms`
      : `请求成功率: ${payload.results.successRate.toFixed(2)}% | 平均 QPS: ${payload.results.qps.toFixed(2)} | 首字延迟 P95 (TTFT P95): ${payload.results.ttftP95.toFixed(2)} ms`,
    10,
    false,
    6
  );
  addText(`诊断结论: ${payload.conclusion}`, 10, false, 6);

  addSectionTitle("2. Risk Assessment / 风险评估");
  ensurePage(12);
  drawRiskBadge(pdf, risk.label, risk.color, left, y - 1, 44, 9);
  pdf.setTextColor(17, 24, 39);
  y += 12;
  addText(risk.summary, 10, false, 6);
  addText(
    `失败请求数 / 总请求数: ${Math.max(0, payload.results.totalRequests - payload.results.successfulRequests)} / ${payload.results.totalRequests}`,
    10,
    false,
    6
  );

  // PAGE 4: Test Configuration & Metrics
  pdf.addPage();
  y = 24;

  addSectionTitle("3. Test Configuration / 测试配置");
  if (isRest) {
    addText(`接口服务商 (Provider): ${payload.config.apiProvider}`, 10);
    addText(`接口地址 (Endpoint): ${payload.config.apiUrl}`, 10);
    addText(`配置名称 (Name): ${payload.config.model}`, 10);
  } else {
    addText(`接口服务商 (Provider): ${payload.config.apiProvider}`, 10);
    addText(`接口地址 (Endpoint): ${payload.config.apiUrl}`, 10);
    addText(`测试模型 (Model): ${payload.config.model}`, 10);
  }
  addText(`负载模式 (Load Mode): ${payload.config.loadMode}`, 10);
  addText(`负载参数 (Load Config): ${formatLoadConfig(payload.config.loadConfig)}`, 10);
  addText(`输入类型 (Input Type): ${payload.config.inputType}`, 10, false, 6);

  addSectionTitle("4. Key Metrics / 性能关键指标");
  
  const metricRows = isRest
    ? [
        ["总请求数 (Total Requests)", String(payload.results.totalRequests)],
        ["成功请求数 (Successful Requests)", String(payload.results.successfulRequests)],
        ["请求成功率 (Success Rate)", `${payload.results.successRate.toFixed(2)}%`],
        ["每秒请求数 (QPS)", payload.results.qps.toFixed(2)],
        ["平均响应时间 (Avg Latency)", `${payload.results.avgLatency.toFixed(2)} ms`],
        ["响应时间 P95 (P95 Latency)", `${payload.results.p95Latency.toFixed(2)} ms`],
      ]
    : [
        ["总请求数 (Total Requests)", String(payload.results.totalRequests)],
        ["成功请求数 (Successful Requests)", String(payload.results.successfulRequests)],
        ["请求成功率 (Success Rate)", `${payload.results.successRate.toFixed(2)}%`],
        ["首字延迟平均值 (TTFT Avg)", `${payload.results.ttftAvg.toFixed(2)} ms`],
        ["首字延迟 P95 (TTFT P95)", `${payload.results.ttftP95.toFixed(2)} ms`],
        ["首字延迟 P99 (TTFT P99)", `${payload.results.ttftP99.toFixed(2)} ms`],
        ["每秒生成 Token 数 (TPS Avg)", payload.results.tpsAvg.toFixed(2)],
        ["词间延迟平均值 (ITL Avg)", `${payload.results.itlAvg.toFixed(2)} ms`],
        ["每秒请求数 (QPS)", payload.results.qps.toFixed(2)],
        ["平均响应时间 (Avg Latency)", `${payload.results.avgLatency.toFixed(2)} ms`],
        ["响应时间 P95 (P95 Latency)", `${payload.results.p95Latency.toFixed(2)} ms`],
      ];

  y = drawTable(pdf, ["性能指标 (Performance Metric)", "测量值 (Measured Value)"], metricRows, {
    startY: y + 2,
    colWidths: [118, 60],
    alignments: ["left", "right"],
    fontSize: 9,
  });

  // PAGE 5: Expert Analysis
  pdf.addPage();
  y = 24;

  addSectionTitle("5. Expert Analysis & Recommendations / 专家诊断与调优建议");
  if (payload.analysis.length === 0) {
    addText("暂无专家性能诊断建议。", 10);
  } else {
    payload.analysis.forEach((item, idx) => {
      addText(`${idx + 1}. ${item}`, 10, false, 8);
    });
  }

  // Draw headers & footers on all pages at the very end
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    if (i > 1) {
      drawPageHeader(pdf, dynamicReportTitle, logoDataUrl, COMPANY_NAME, pageWidth, left, right);
    }
    drawPageFooter(pdf, i, totalPages, pageHeight, pageWidth, left, right);
  }

  pdf.save(createFileName(isRest ? "api-advisory-report" : "llm-advisory-report", "pdf"));
};

export const exportTestReportAsWord = async (payload: TestReportPayload) => {
  const risk = getRiskMeta(payload);
  const isRest = payload.testType === "REST_API";
  const dynamicReportTitle = isRest ? "API Performance Advisory Report" : REPORT_TITLE;

  let logoData: Uint8Array | null = null;
  try {
    const logoDataUrl = await loadLogoPngDataUrl(440, 120);
    logoData = dataUrlToUint8Array(logoDataUrl);
  } catch {
    logoData = null;
  }

  const rows = isRest
    ? [
        ["Total Requests", String(payload.results.totalRequests)],
        ["Successful Requests", String(payload.results.successfulRequests)],
        ["Success Rate", `${payload.results.successRate.toFixed(2)}%`],
        ["QPS", payload.results.qps.toFixed(2)],
        ["Avg Latency", `${payload.results.avgLatency.toFixed(2)} ms`],
        ["P95 Latency", `${payload.results.p95Latency.toFixed(2)} ms`],
      ]
    : [
        ["Total Requests", String(payload.results.totalRequests)],
        ["Successful Requests", String(payload.results.successfulRequests)],
        ["Success Rate", `${payload.results.successRate.toFixed(2)}%`],
        ["TTFT Avg", `${payload.results.ttftAvg.toFixed(2)} ms`],
        ["TTFT P95", `${payload.results.ttftP95.toFixed(2)} ms`],
        ["TTFT P99", `${payload.results.ttftP99.toFixed(2)} ms`],
        ["TPS Avg", payload.results.tpsAvg.toFixed(2)],
        ["ITL Avg", `${payload.results.itlAvg.toFixed(2)} ms`],
        ["QPS", payload.results.qps.toFixed(2)],
        ["Avg Latency", `${payload.results.avgLatency.toFixed(2)} ms`],
        ["P95 Latency", `${payload.results.p95Latency.toFixed(2)} ms`],
      ];

  const tableRows = [
    new TableRow({
      children: ["Metric", "Value"].map((cell) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: cell, bold: true })],
            }),
          ],
        })
      ),
    }),
    ...rows.map(
      ([metric, value]) =>
        new TableRow({
          children: [metric, value].map((cell) =>
            new TableCell({ children: [new Paragraph(String(cell))] })
          ),
        })
    ),
  ];

  const companyHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: COMPANY_NAME, bold: true, color: "1F2937" }),
          new TextRun({ text: `  |  ${COMPANY_TAGLINE}`, color: "6B7280" }),
        ],
      }),
    ],
  });

  const reportFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: "CONFIDENTIAL | Page ", color: "6B7280" }),
          new TextRun({ children: [PageNumber.CURRENT], color: "6B7280" }),
        ],
      }),
    ],
  });

  const riskTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: risk.hex },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: risk.label, bold: true, color: "FFFFFF" })],
              }),
            ],
          }),
          new TableCell({
            children: [new Paragraph(risk.summary)],
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: [
          new Paragraph({
            text: COMPANY_NAME,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          ...(logoData
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      data: logoData,
                      type: "png",
                      transformation: { width: 220, height: 60 },
                    }),
                  ],
                }),
              ]
            : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: COMPANY_TAGLINE, color: "6B7280" })],
          }),
          new Paragraph(""),
          new Paragraph({
            text: dynamicReportTitle,
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun(`Generated At: ${payload.generatedAt}`)],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun(isRest ? `Config: ${payload.config.model || "Default"}` : `Model: ${payload.config.model}`)],
          }),
          new Paragraph(""),
          new Paragraph(""),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: risk.label, bold: true, color: risk.hex })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun(risk.summary)],
          }),
        ],
      },
      {
        headers: { default: companyHeader },
        footers: { default: reportFooter },
        children: [
          new Paragraph({ text: "Table of Contents", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("1. Executive Summary ........................................ 1"),
          new Paragraph("2. Risk Assessment .......................................... 1"),
          new Paragraph("3. Test Configuration ....................................... 2"),
          new Paragraph("4. Key Metrics .............................................. 2"),
          new Paragraph("5. Expert Analysis .......................................... 3"),
          new Paragraph(""),
          new Paragraph({
            text: "Executive Summary",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph(
            isRest
              ? `Success Rate: ${payload.results.successRate.toFixed(2)}% | QPS: ${payload.results.qps.toFixed(2)} | P95 Latency: ${payload.results.p95Latency.toFixed(2)} ms`
              : `Success Rate: ${payload.results.successRate.toFixed(2)}% | QPS: ${payload.results.qps.toFixed(2)} | TTFT P95: ${payload.results.ttftP95.toFixed(2)} ms`
          ),
          new Paragraph(`Conclusion: ${payload.conclusion}`),
          new Paragraph(""),
          new Paragraph({
            text: "Risk Assessment",
            heading: HeadingLevel.HEADING_1,
          }),
          riskTable,
          new Paragraph(""),
          new Paragraph({
            text: "Test Configuration",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph(`Provider: ${payload.config.apiProvider}`),
          new Paragraph(`Endpoint: ${payload.config.apiUrl}`),
          new Paragraph(isRest ? `Config: ${payload.config.model || "Default"}` : `Model: ${payload.config.model}`),
          new Paragraph(`Load Mode: ${payload.config.loadMode}`),
          new Paragraph(`Load Config: ${formatLoadConfig(payload.config.loadConfig)}`),
          new Paragraph(`Input Type: ${payload.config.inputType}`),
          new Paragraph(""),
          new Paragraph({
            text: "Key Metrics",
            heading: HeadingLevel.HEADING_1,
          }),
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
          new Paragraph(""),
          new Paragraph({
            text: "Expert Analysis",
            heading: HeadingLevel.HEADING_1,
          }),
          ...(payload.analysis.length > 0
            ? payload.analysis.map((item, index) =>
                new Paragraph({ text: `${index + 1}. ${item}` })
              )
            : [new Paragraph("No expert analysis generated.")]),
        ],
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { size: 22 },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { bold: true, size: 28, color: "111827" },
          paragraph: {
            border: {
              bottom: {
                color: "E5E7EB",
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            spacing: { before: 240, after: 120 },
          },
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, createFileName(isRest ? "api-advisory-report" : "llm-advisory-report", "docx"));
};
