import { jsPDF } from "jspdf";
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
  inputType: "text" | "image" | "json";
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
  const p95 = payload.results.ttftP95;

  let level: RiskLevel = "LOW";
  if (failRate >= 0.05 || p95 >= 2000) {
    level = "HIGH";
  } else if (failRate >= 0.01 || p95 >= 1200) {
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
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 16;
  const right = 16;
  const contentWidth = pageWidth - left - right;
  let y = 22;

  const drawPageHeader = (title: string) => {
    pdf.setFillColor(245, 247, 250);
    pdf.rect(0, 0, pageWidth, 14, "F");
    if (logoDataUrl) {
      pdf.addImage(logoDataUrl, "PNG", left, 2.7, 28, 8.2);
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(31, 41, 55);
    pdf.text(COMPANY_NAME, left + 31, 7.5);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(75, 85, 99);
    pdf.text(title, pageWidth - right, 7.5, { align: "right" });
    pdf.setDrawColor(229, 231, 235);
    pdf.line(left, 14, pageWidth - right, 14);
    pdf.setTextColor(0, 0, 0);
  };

  const drawPageFooter = () => {
    const pageNum = pdf.getCurrentPageInfo().pageNumber;
    pdf.setDrawColor(229, 231, 235);
    pdf.line(left, pageHeight - 10, pageWidth - right, pageHeight - 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    pdf.text("CONFIDENTIAL", left, pageHeight - 5.5);
    pdf.text(`Page ${pageNum}`, pageWidth - right, pageHeight - 5.5, {
      align: "right",
    });
    pdf.setTextColor(0, 0, 0);
  };

  const ensurePage = (delta = 6) => {
    if (y + delta <= pageHeight - 14) return;
    drawPageFooter();
    pdf.addPage();
    y = 22;
    drawPageHeader(REPORT_TITLE);
  };

  const addText = (text: string, size = 11, bold = false, gap = 6) => {
    ensurePage(gap);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
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

  // Cover
  pdf.setFillColor(17, 24, 39);
  pdf.rect(0, 0, pageWidth, 64, "F");
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "PNG", left, 14, 42, 12);
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(COMPANY_NAME, left, 34);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(COMPANY_TAGLINE, left, 41);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(REPORT_TITLE, left, 55);

  pdf.setTextColor(17, 24, 39);
  pdf.setFillColor(risk.color[0], risk.color[1], risk.color[2]);
  pdf.roundedRect(left, 76, 52, 11, 2, 2, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.text(risk.label, left + 26, 83, { align: "center" });

  pdf.setTextColor(17, 24, 39);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(`Generated At: ${payload.generatedAt}`, left, 98);
  pdf.text(`Model: ${payload.config.model}`, left, 106);
  pdf.text(`Provider: ${payload.config.apiProvider}`, left, 114);
  pdf.text(`Summary: ${risk.summary}`, left, 122);
  drawPageFooter();

  // TOC
  pdf.addPage();
  drawPageHeader(REPORT_TITLE);
  y = 24;
  addText("Table of Contents", 16, true, 8);
  addText("1. Executive Summary ........................................ 3", 11, false, 6);
  addText("2. Risk Assessment .......................................... 3", 11, false, 6);
  addText("3. Test Configuration ....................................... 4", 11, false, 6);
  addText("4. Key Metrics .............................................. 4", 11, false, 6);
  addText("5. Expert Analysis .......................................... 5", 11, false, 6);
  drawPageFooter();

  // Main body
  pdf.addPage();
  drawPageHeader(REPORT_TITLE);
  y = 24;

  addSectionTitle("1. Executive Summary");
  addText(
    `Success Rate: ${payload.results.successRate.toFixed(2)}% | QPS: ${payload.results.qps.toFixed(2)} | TTFT P95: ${payload.results.ttftP95.toFixed(2)} ms`,
    10,
    false,
    6
  );
  addText(`Conclusion: ${payload.conclusion}`, 10, false, 6);

  addSectionTitle("2. Risk Assessment");
  ensurePage(12);
  pdf.setFillColor(risk.color[0], risk.color[1], risk.color[2]);
  pdf.roundedRect(left, y - 1, 44, 9, 2, 2, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(255, 255, 255);
  pdf.text(risk.label, left + 22, y + 5, { align: "center" });
  pdf.setTextColor(17, 24, 39);
  y += 12;
  addText(risk.summary, 10, false, 6);
  addText(
    `Failed Requests: ${Math.max(0, payload.results.totalRequests - payload.results.successfulRequests)} / ${payload.results.totalRequests}`,
    10,
    false,
    6
  );

  addSectionTitle("3. Test Configuration");
  addText(`Provider: ${payload.config.apiProvider}`, 10);
  addText(`Endpoint: ${payload.config.apiUrl}`, 10);
  addText(`Model: ${payload.config.model}`, 10);
  addText(`Load Mode: ${payload.config.loadMode}`, 10);
  addText(`Load Config: ${formatLoadConfig(payload.config.loadConfig)}`, 10);
  addText(`Input Type: ${payload.config.inputType}`, 10, false, 6);

  addSectionTitle("4. Key Metrics");
  addText(`Total Requests: ${payload.results.totalRequests}`, 10);
  addText(`Successful Requests: ${payload.results.successfulRequests}`, 10);
  addText(
    `TTFT Avg / P95 / P99: ${payload.results.ttftAvg.toFixed(2)} / ${payload.results.ttftP95.toFixed(2)} / ${payload.results.ttftP99.toFixed(2)} ms`,
    10
  );
  addText(`TPS Avg: ${payload.results.tpsAvg.toFixed(2)}`, 10);
  addText(`ITL Avg: ${payload.results.itlAvg.toFixed(2)} ms`, 10);
  addText(`QPS: ${payload.results.qps.toFixed(2)}`, 10);
  addText(
    `Avg Latency / P95 Latency: ${payload.results.avgLatency.toFixed(2)} / ${payload.results.p95Latency.toFixed(2)} ms`,
    10,
    false,
    6
  );

  addSectionTitle("5. Expert Analysis");
  if (payload.analysis.length === 0) {
    addText("No expert analysis generated.", 10);
  } else {
    payload.analysis.forEach((item, idx) => {
      addText(`${idx + 1}. ${item}`, 10);
    });
  }

  drawPageFooter();

  pdf.save(createFileName("llm-advisory-report", "pdf"));
};

export const exportTestReportAsWord = async (payload: TestReportPayload) => {
  const risk = getRiskMeta(payload);
  let logoData: Uint8Array | null = null;
  try {
    const logoDataUrl = await loadLogoPngDataUrl(440, 120);
    logoData = dataUrlToUint8Array(logoDataUrl);
  } catch {
    logoData = null;
  }

  const rows = [
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
            text: REPORT_TITLE,
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun(`Generated At: ${payload.generatedAt}`)],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun(`Model: ${payload.config.model}`)],
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
            `Success Rate: ${payload.results.successRate.toFixed(2)}% | QPS: ${payload.results.qps.toFixed(2)} | TTFT P95: ${payload.results.ttftP95.toFixed(2)} ms`
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
          new Paragraph(`Model: ${payload.config.model}`),
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
  downloadBlob(blob, createFileName("llm-advisory-report", "docx"));
};
