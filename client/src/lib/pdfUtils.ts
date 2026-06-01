import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";

let cachedFontBase64: string | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0xffff; // 64k chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    // @ts-ignore
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(chunks.join(""));
};

export const loadChineseFont = async (pdf: jsPDF): Promise<void> => {
  if (!cachedFontBase64) {
    const response = await fetch("/fonts/NotoSansSC-Regular.ttf");
    if (!response.ok) {
      throw new Error("Failed to fetch Noto Sans SC font file from public/fonts/");
    }
    const buffer = await response.arrayBuffer();
    cachedFontBase64 = arrayBufferToBase64(buffer);
  }

  const fontFilename = "NotoSansSC-Regular.ttf";
  const fontName = "NotoSansSC";
  pdf.addFileToVFS(fontFilename, cachedFontBase64);
  pdf.addFont(fontFilename, fontName, "normal");
  pdf.addFont(fontFilename, fontName, "bold"); // Map regular font to bold style too to avoid box fallback
  pdf.setFont(fontName, "normal");
};

export const drawPageHeader = (
  pdf: jsPDF,
  title: string,
  logoDataUrl: string | null,
  companyName: string,
  pageWidth: number,
  left: number,
  right: number
) => {
  // Use dark Slate-900 background for page header to make white Goldwind logo visible!
  pdf.setFillColor(17, 24, 39);
  pdf.rect(0, 0, pageWidth, 14, "F");
  
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "PNG", left, 2.7, 28, 8.2);
  } else {
    pdf.setFont("NotoSansSC", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255); // White text
    pdf.text(companyName, left, 8.0);
  }
  
  pdf.setFont("NotoSansSC", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(209, 213, 219); // Light gray text
  pdf.text(title, pageWidth - right, 8.0, { align: "right" });
  
  pdf.setDrawColor(55, 65, 81); // Darker border divider line
  pdf.setLineWidth(0.2);
  pdf.line(left, 14, pageWidth - right, 14);
  pdf.setTextColor(0, 0, 0);
};

export const drawPageFooter = (
  pdf: jsPDF,
  pageNum: number,
  totalPages: number,
  pageHeight: number,
  pageWidth: number,
  left: number,
  right: number
) => {
  pdf.setDrawColor(229, 231, 235);
  pdf.line(left, pageHeight - 10, pageWidth - right, pageHeight - 10);
  
  pdf.setFont("NotoSansSC", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(107, 114, 128);
  pdf.text("CONFIDENTIAL", left, pageHeight - 5.5);
  
  pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - right, pageHeight - 5.5, {
    align: "right",
  });
  pdf.setTextColor(0, 0, 0);
};

export interface TableOptions {
  startY: number;
  startX?: number;
  colWidths: number[];
  rowHeight?: number;
  fontSize?: number;
  headerBgColor?: [number, number, number];
  headerTextColor?: [number, number, number];
  alternateRowBgColor?: [number, number, number];
  rowBgColor?: [number, number, number];
  textColor?: [number, number, number];
  alignments?: ("left" | "center" | "right")[];
}

export const drawTable = (
  pdf: jsPDF,
  headers: string[],
  rows: string[][],
  options: TableOptions
): number => {
  const startX = options.startX ?? 16;
  let y = options.startY;
  const rowHeight = options.rowHeight ?? 8;
  const fontSize = options.fontSize ?? 9;
  const colWidths = options.colWidths;
  const alignments = options.alignments ?? new Array(headers.length).fill("left");
  
  // Set font
  pdf.setFont("NotoSansSC", "bold");
  pdf.setFontSize(fontSize);
  
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const headerBg = options.headerBgColor ?? [31, 41, 55];
  const headerText = options.headerTextColor ?? [255, 255, 255];
  
  // Header background
  pdf.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
  pdf.rect(startX, y, tableWidth, rowHeight, "F");
  
  // Header text
  pdf.setTextColor(headerText[0], headerText[1], headerText[2]);
  let currentX = startX;
  headers.forEach((header, index) => {
    const colWidth = colWidths[index];
    const alignment = alignments[index];
    let textX = currentX + 3;
    if (alignment === "center") {
      textX = currentX + (colWidth / 2);
    } else if (alignment === "right") {
      textX = currentX + colWidth - 3;
    }
    pdf.text(header, textX, y + (rowHeight / 2) + 1.5, { align: alignment });
    currentX += colWidth;
  });
  
  y += rowHeight;
  
  // Rows
  pdf.setFont("NotoSansSC", "normal");
  const alternateRowBg = options.alternateRowBgColor ?? [249, 250, 251];
  const rowBg = options.rowBgColor ?? [255, 255, 255];
  const textColor = options.textColor ?? [55, 65, 81];
  
  rows.forEach((row, rowIndex) => {
    const isAlternate = rowIndex % 2 === 1;
    const bg = isAlternate ? alternateRowBg : rowBg;
    pdf.setFillColor(bg[0], bg[1], bg[2]);
    pdf.rect(startX, y, tableWidth, rowHeight, "F");
    
    // Bottom border
    pdf.setDrawColor(243, 244, 246);
    pdf.setLineWidth(0.2);
    pdf.line(startX, y + rowHeight, startX + tableWidth, y + rowHeight);
    
    // Cell text
    pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    currentX = startX;
    row.forEach((cell, cellIndex) => {
      const colWidth = colWidths[cellIndex];
      const alignment = alignments[cellIndex];
      let textX = currentX + 3;
      if (alignment === "center") {
        textX = currentX + (colWidth / 2);
      } else if (alignment === "right") {
        textX = currentX + colWidth - 3;
      }
      pdf.text(String(cell), textX, y + (rowHeight / 2) + 1.5, { align: alignment });
      currentX += colWidth;
    });
    
    y += rowHeight;
  });
  
  return y;
};

export const drawRiskBadge = (
  pdf: jsPDF,
  label: string,
  color: readonly [number, number, number] | [number, number, number],
  x: number,
  y: number,
  w = 44,
  h = 9
) => {
  pdf.setFillColor(color[0], color[1], color[2]);
  pdf.roundedRect(x, y, w, h, 1.5, 1.5, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8);
  pdf.setFont("NotoSansSC", "bold");
  pdf.text(label, x + (w / 2), y + (h / 2) + 1.2, { align: "center" });
};

export const captureChartAsImage = async (element: HTMLElement): Promise<string> => {
  return toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    style: {
      animation: "none",
      transition: "none",
    },
  });
};

export const loadLogoPngDataUrl = async (
  logoUrl = "/branding/goldwind-logo.svg",
  maxWidth = 180,
  maxHeight = 54
): Promise<string> => {
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
    image.src = `${logoUrl}?v=20260519`;
  });
};
