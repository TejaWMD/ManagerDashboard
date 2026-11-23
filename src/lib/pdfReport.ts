import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import wmdLogoUrl from '../assets/wmd-logo.jpg';
import {
  isQueryDelayed,
  isQueryDone,
  ManagerKpiStats,
  Query,
  UserAccount,
} from '../types';
import {
  calculateAllManagersKpi,
  filterQueriesByWindow,
  KpiTimeWindow,
} from './kpi';
import { calculateReceiverOverallRating } from './ratingUtils';
import { formatDate } from './dateUtils';

export interface GenerateWeeklyReportOptions {
  queries: Query[];
  managers: UserAccount[];
  adminUser: UserAccount;
  nowMs?: number;
  timeWindow?: KpiTimeWindow;
}

type RGB = [number, number, number];

interface ManagerTheme {
  accent: RGB;
  softBg: RGB;
  border: RGB;
}

const MANAGER_THEMES: ManagerTheme[] = [
  { accent: [217, 119, 6], softBg: [254, 243, 199], border: [252, 211, 77] },   // Warm Amber
  { accent: [2, 132, 199], softBg: [224, 242, 254], border: [125, 211, 252] },   // Sky Blue
  { accent: [5, 150, 105], softBg: [209, 250, 229], border: [110, 231, 183] },   // Emerald Mint
  { accent: [124, 58, 237], softBg: [237, 233, 254], border: [196, 181, 253] },  // Soft Violet
  { accent: [225, 29, 72], softBg: [255, 228, 230], border: [253, 164, 175] },   // Rose Pink
  { accent: [13, 148, 136], softBg: [204, 251, 241], border: [94, 234, 212] },   // Soft Teal
  { accent: [79, 70, 229], softBg: [224, 231, 255], border: [165, 180, 252] },   // Pastel Indigo
  { accent: [234, 88, 12], softBg: [255, 237, 213], border: [253, 186, 116] },   // Soft Coral
];

interface LoadedImage {
  dataUrl: string;
  aspectRatio: number;
}

function loadImageData(url: string): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    if (!url || typeof window === 'undefined' || typeof Image === 'undefined') {
      return resolve(null);
    }
    try {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 200;
          canvas.height = img.naturalHeight || 200;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', 0.9),
            aspectRatio: canvas.width / canvas.height,
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Fits text cleanly within maxWidth in mm (never overflows box boundaries).
 */
function fitTextToWidth(doc: jsPDF, text: string, maxWidth: number): string {
  const str = String(text || '').trim();
  if (!str || maxWidth <= 0) return '';
  if (doc.getTextWidth(str) <= maxWidth) return str;
  const ellipsis = '…';
  const ellW = doc.getTextWidth(ellipsis);
  let end = str.length;
  while (end > 0 && doc.getTextWidth(str.slice(0, end)) + ellW > maxWidth) {
    end -= 1;
  }
  return end > 0 ? `${str.slice(0, end)}${ellipsis}` : '';
}

function getKpiStatus(
  kpi: number,
  hasData: boolean
): { label: string; color: RGB; bg: RGB } {
  if (!hasData) {
    return { label: 'No Data', color: [100, 116, 139], bg: [241, 245, 249] };
  }
  if (kpi >= 90) {
    return { label: 'Excellent', color: [22, 101, 52], bg: [220, 252, 231] };
  }
  if (kpi >= 75) {
    return { label: 'On Track', color: [3, 105, 161], bg: [224, 242, 254] };
  }
  if (kpi >= 50) {
    return { label: 'In Progress', color: [180, 83, 9], bg: [254, 243, 199] };
  }
  return { label: 'Needs Push', color: [153, 27, 27], bg: [254, 226, 226] };
}

function getRatingStatus(
  rating: number | null
): { label: string; color: RGB; bg: RGB } {
  if (rating === null || Number.isNaN(rating)) {
    return { label: 'No Data', color: [100, 116, 139], bg: [241, 245, 249] };
  }
  if (rating >= 9.0) {
    return { label: 'Top Rated', color: [22, 101, 52], bg: [220, 252, 231] };
  }
  if (rating >= 7.5) {
    return { label: 'Strong', color: [3, 105, 161], bg: [224, 242, 254] };
  }
  if (rating >= 6.0) {
    return { label: 'Average', color: [180, 83, 9], bg: [254, 243, 199] };
  }
  return { label: 'Low', color: [153, 27, 27], bg: [254, 226, 226] };
}

function fmtRating(val: number | null): string {
  if (val === null || Number.isNaN(val)) return '-';
  return `${val.toFixed(1)}/10`;
}

function fmtRatingShort(val: number | null): string {
  if (val === null || Number.isNaN(val)) return '-';
  return val.toFixed(1);
}

function fmtHours(val: number | null): string {
  if (val === null || Number.isNaN(val)) return '-';
  return `${val.toFixed(1)}h`;
}

interface ManagerReportProfile {
  rank: number;
  stats: ManagerKpiStats;
  theme: ManagerTheme;
  kpiStatus: { label: string; color: RGB; bg: RGB };
  ratingStatus: { label: string; color: RGB; bg: RGB };
  avgAdminRating: number | null;
  avgSystemRating: number | null;
  avgSenderRating: number | null;
}

/**
 * Generates a neat, evenly spaced, collision-free Manager KPI & Ratings PDF report.
 * Strictly includes Managers only (excludes Account Managers and Admins).
 */
export async function generateWeeklyManagerReportPdf({
  queries,
  managers,
  adminUser,
  nowMs = Date.now(),
  timeWindow = '7d',
}: GenerateWeeklyReportOptions): Promise<{
  success: boolean;
  filename: string;
  pages: number;
}> {
  const onlyManagers = managers.filter((u) => u.role === 'manager');

  const { stats, teamAverageKpi, teamAverageRating } = calculateAllManagersKpi(
    queries,
    onlyManagers,
    {
      window: timeWindow,
      nowMs,
    }
  );

  const profiles: ManagerReportProfile[] = stats.map((st, idx) => {
    const theme = MANAGER_THEMES[idx % MANAGER_THEMES.length];
    const hasData = st.totalAssigned > 0 || st.totalEvaluated > 0;
    const kpiStatus = getKpiStatus(st.overallKpi, hasData);
    const ratingStatus = getRatingStatus(st.avgRating);

    let adminSum = 0;
    let systemSum = 0;
    let senderSum = 0;
    const ratedCount = st.evaluatedQueries.length;

    st.evaluatedQueries.forEach((ev) => {
      const rb = calculateReceiverOverallRating(ev.query, nowMs);
      const effectiveSender =
        rb.senderRating !== null && rb.senderRating !== undefined
          ? rb.senderRating
          : 10;
      adminSum += rb.adminRating;
      systemSum += rb.systemRating;
      senderSum += effectiveSender;
    });

    return {
      rank: idx + 1,
      stats: st,
      theme,
      kpiStatus,
      ratingStatus,
      avgAdminRating:
        ratedCount > 0 ? Math.round((adminSum / ratedCount) * 10) / 10 : null,
      avgSystemRating:
        ratedCount > 0 ? Math.round((systemSum / ratedCount) * 10) / 10 : null,
      avgSenderRating:
        ratedCount > 0 ? Math.round((senderSum / ratedCount) * 10) / 10 : null,
    };
  });

  // Aggregate manager-scoped totals
  const totalAssigned = profiles.reduce((s, p) => s + p.stats.totalAssigned, 0);
  const totalCompleted = profiles.reduce((s, p) => s + p.stats.completedCount, 0);
  const totalOnTime = profiles.reduce((s, p) => s + p.stats.onTimeCount, 0);
  const totalLate = profiles.reduce((s, p) => s + p.stats.lateCount, 0);
  const totalOverdue = profiles.reduce((s, p) => s + p.stats.overdueCount, 0);
  const totalInProgress = profiles.reduce((s, p) => s + p.stats.inProgressCount, 0);
  const totalDelayed = totalLate + totalOverdue;
  const totalEvaluated = totalOnTime + totalLate + totalOverdue;
  const totalPoints = profiles.reduce((s, p) => s + p.stats.earnedPoints, 0);

  const teamCompletionRate =
    totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;
  const teamTurnaroundKpi =
    totalEvaluated > 0 ? Math.round((totalPoints / totalEvaluated) * 100) : 0;

  const turnaroundSamples = profiles.flatMap((p) =>
    p.stats.evaluatedQueries
      .map((e) => e.managerTurnaroundHours)
      .filter((v): v is number => v !== null)
  );
  const teamAvgSpeed =
    turnaroundSamples.length > 0
      ? Math.round(
          (turnaroundSamples.reduce((a, v) => a + v, 0) / turnaroundSamples.length) *
            10
        ) / 10
      : null;

  const avgOf = (getter: (p: ManagerReportProfile) => number | null): number | null => {
    const vals = profiles
      .map(getter)
      .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 10) / 10;
  };
  const teamAvgAdmin = avgOf((p) => p.avgAdminRating);
  const teamAvgSystem = avgOf((p) => p.avgSystemRating);
  const teamAvgSender = avgOf((p) => p.avgSenderRating);

  // Extension summary across manager queries in window
  const managerQueryList = filterQueriesByWindow(queries, timeWindow, nowMs).filter((q) =>
    onlyManagers.some(
      (m) =>
        (q.managerId && q.managerId.toLowerCase() === m.id.toLowerCase()) ||
        (q.managerEmail && q.managerEmail.toLowerCase() === m.email.toLowerCase()) ||
        (q.managerName && q.managerName.toLowerCase() === m.name.toLowerCase())
    )
  );
  const extRequested = managerQueryList.filter(
    (q) => q.extensionStatus && q.extensionStatus !== 'NONE'
  ).length;
  const extApproved = managerQueryList.filter(
    (q) => q.extensionStatus === 'APPROVED'
  ).length;
  const extPending = managerQueryList.filter(
    (q) => q.extensionStatus === 'PENDING'
  ).length;
  const activeOverdueCount = managerQueryList.filter(
    (q) => isQueryDelayed(q, nowMs) && !isQueryDone(q)
  ).length;

  // Period labels
  const formattedNow = formatDate(nowMs);
  const nowDate = new Date(nowMs);
  const dateFormatted = nowDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeFormatted = nowDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const periodConfig: Record<
    KpiTimeWindow,
    { pill: string; slug: string; days?: number }
  > = {
    '7d': { pill: 'LAST 7 DAYS', slug: '7D_Weekly', days: 7 },
    '14d': { pill: 'LAST 14 DAYS', slug: '14D_BiWeekly', days: 14 },
    '30d': { pill: 'LAST 30 DAYS', slug: '30D_Monthly', days: 30 },
    all: { pill: 'ALL TIME', slug: 'AllTime' },
  };
  const pCfg = periodConfig[timeWindow] ?? periodConfig['7d'];
  const rangeStr = pCfg.days
    ? `${formatDate(nowMs - pCfg.days * 864e5)} to ${formattedNow}`
    : `Up to ${formattedNow}`;
  const periodDisplay = `${rangeStr}`;

  // Initialize PDF (A4 Portrait: 210mm x 297mm)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 13;
  const contentWidth = pageWidth - marginX * 2; // 184mm
  const runningHeaderTopMargin = 14.0; // Safe top Y for all pages after page 1
  const footerSafeBottom = pageHeight - 14.0; // 283mm safe bottom boundary

  const logoInfo = await loadImageData(wmdLogoUrl);

  // Palette
  const NAVY: RGB = [11, 45, 97];
  const GOLD: RGB = [251, 229, 70];
  const TEAL: RGB = [13, 148, 136];
  const GREEN: RGB = [22, 101, 52];
  const AMBER: RGB = [180, 83, 9];
  const RED: RGB = [185, 28, 28];
  const SKY: RGB = [2, 132, 199];
  const TEXT_DARK: RGB = [15, 23, 42];
  const TEXT_MUTED: RGB = [100, 116, 139];
  const CARD_BG: RGB = [248, 250, 252];
  const BORDER: RGB = [226, 232, 240];

  // Helpers
  const drawTopAccent = (slim = false) => {
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(0, 0, pageWidth, slim ? 2.5 : 3.2, 'F');
    doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
    doc.rect(0, slim ? 2.5 : 3.2, pageWidth, slim ? 0.7 : 0.9, 'F');
  };

  const drawRunningHeader = () => {
    drawTopAccent(true);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text('QUERY PORTAL MANAGER PERFORMANCE REPORT', marginX, 7.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
    doc.text(periodDisplay, marginX + contentWidth, 7.8, { align: 'right' });

    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.25);
    doc.line(marginX, 10.2, marginX + contentWidth, 10.2);
  };

  const ensurePageSpace = (currentY: number, neededHeight: number): number => {
    if (currentY + neededHeight > footerSafeBottom) {
      doc.addPage();
      drawRunningHeader();
      return runningHeaderTopMargin;
    }
    return currentY;
  };

  const drawSummaryCard = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    sub: string,
    accentColor: RGB,
    softBg: RGB = CARD_BG
  ) => {
    const padX = 3.0;
    const innerW = w - padX * 2;

    doc.setFillColor(softBg[0], softBg[1], softBg[2]);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.28);
    doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');

    // Top accent strip inside card
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.roundedRect(x + padX, y + 2.4, 10, 1.3, 0.6, 0.6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.0);
    doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
    doc.text(fitTextToWidth(doc, label.toUpperCase(), innerW), x + padX, y + 7.0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text(fitTextToWidth(doc, value, innerW), x + padX, y + 12.4);

    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
      doc.text(fitTextToWidth(doc, sub, innerW), x + padX, y + 16.2);
    }
  };

  const drawSectionPillHeader = (
    y: number,
    title: string,
    rightBadge = '',
    bgColor: RGB = NAVY
  ) => {
    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    doc.roundedRect(marginX, y, contentWidth, 7.0, 1.8, 1.8, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), marginX + 3.5, y + 4.7);

    if (rightBadge) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.text(rightBadge, marginX + contentWidth - 3.5, y + 4.7, {
        align: 'right',
      });
    }
  };

  const drawSegmentedBar = (
    x: number,
    y: number,
    w: number,
    h: number,
    st: ManagerKpiStats
  ) => {
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');

    if (st.totalAssigned <= 0) return;

    const segments: Array<[number, RGB]> = [
      [st.onTimeCount, [16, 185, 129]],
      [st.lateCount, [245, 158, 11]],
      [st.overdueCount, [239, 68, 68]],
      [st.inProgressCount, [14, 165, 233]],
    ];
    let curX = x;
    segments.forEach(([count, color]) => {
      if (count <= 0) return;
      const segW = Math.min(x + w - curX, (count / st.totalAssigned) * w);
      if (segW > 0.3) {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(curX, y, segW, h, 0.9, 0.9, 'F');
        curX += segW;
      }
    });
  };

  // =========================================================================
  // PAGE 1: EXECUTIVE SUMMARY, MANAGER KPI TABLE & RATINGS BREAKDOWN
  // =========================================================================
  drawTopAccent(false);

  let curY = 8.5;

  // Logo sizing calculated first so title area never overlaps logo
  let logoW = 0;
  const logoH = 11.2;
  if (logoInfo?.dataUrl) {
    logoW = Math.min(42, logoH * (logoInfo.aspectRatio || 1.8));
    try {
      doc.addImage(
        logoInfo.dataUrl,
        'JPEG',
        marginX + contentWidth - logoW,
        curY - 1,
        logoW,
        logoH
      );
    } catch {
      logoW = 0;
    }
  }
  const headerTextMaxW = contentWidth - (logoW > 0 ? logoW + 4 : 0);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(
    fitTextToWidth(doc, 'MANAGER KPI PERFORMANCE REPORT', headerTextMaxW),
    marginX,
    curY + 3.5
  );

  // Warm gold period pill
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  const pillText = periodDisplay.toUpperCase();
  const pillW = doc.getTextWidth(pillText) + 6.5;
  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(252, 211, 77);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, curY + 5.7, pillW, 5.0, 2.2, 2.2, 'FD');
  doc.setTextColor(146, 64, 14);
  doc.text(pillText, marginX + 3.25, curY + 9.2);

  // Generated timestamp beside pill (wrapped cleanly if space is tight)
  const genStr = `Generated: ${dateFormatted}, ${timeFormatted}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.3);
  doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
  const remHeaderW = headerTextMaxW - pillW - 3.5;
  if (remHeaderW >= doc.getTextWidth(genStr)) {
    doc.text(genStr, marginX + pillW + 3.2, curY + 9.2);
    curY += 14.5;
  } else {
    doc.text(genStr, marginX, curY + 13.8);
    curY += 17.5;
  }

  // Subtle divider
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.25);
  doc.line(marginX, curY, marginX + contentWidth, curY);
  curY += 4.2;

  // MANAGER TEAM SUMMARY (4 Pastel Cards)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(
    `MANAGERS OVERVIEW (${onlyManagers.length} MANAGERS)`,
    marginX,
    curY + 2.0
  );
  curY += 4.5;

  const cardGap = 2.8;
  const cardW = (contentWidth - cardGap * 3) / 4;
  const cardH = 18.6;

  drawSummaryCard(
    marginX,
    curY,
    cardW,
    cardH,
    'Team Overall KPI',
    `${teamAverageKpi}%`,
    `Turnaround: ${teamTurnaroundKpi}% avg`,
    teamAverageKpi >= 85 ? GREEN : teamAverageKpi >= 70 ? AMBER : RED,
    [241, 245, 255]
  );

  drawSummaryCard(
    marginX + (cardW + cardGap),
    curY,
    cardW,
    cardH,
    'Queries Resolved',
    `${totalCompleted} / ${totalAssigned}`,
    `${teamCompletionRate}% done · ${totalOnTime} on-time`,
    GREEN,
    [240, 253, 244]
  );

  drawSummaryCard(
    marginX + (cardW + cardGap) * 2,
    curY,
    cardW,
    cardH,
    'Delayed & Overdue',
    `${totalDelayed}`,
    `${totalLate} late · ${activeOverdueCount} open overdue`,
    totalDelayed > 0 ? RED : GREEN,
    totalDelayed > 0 ? [254, 242, 242] : [240, 253, 244]
  );

  drawSummaryCard(
    marginX + (cardW + cardGap) * 3,
    curY,
    cardW,
    cardH,
    'Avg Manager Rating',
    teamAverageRating !== null ? `${teamAverageRating.toFixed(1)} / 10` : '-',
    `Avg speed: ${fmtHours(teamAvgSpeed)}`,
    TEAL,
    [240, 253, 250]
  );

  curY += cardH + 3.4;

  // =========================================================================
  // DYNAMIC PIPELINE & EXTENSIONS STRIP (EVENLY DISTRIBUTED, ZERO COLLISION)
  // =========================================================================
  const stripH = 7.4;
  doc.setFillColor(238, 242, 255);
  doc.setDrawColor(199, 210, 254);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, curY, contentWidth, stripH, 1.6, 1.6, 'FD');

  const extValStr =
    extPending > 0
      ? `${extRequested} (${extApproved} ok, ${extPending} pend)`
      : `${extRequested} (${extApproved} ok)`;

  const stripItems: Array<{ label: string; value: string; color: RGB }> = [
    { label: 'RECEIVED:', value: String(totalAssigned), color: NAVY },
    { label: 'ON-TIME:', value: String(totalOnTime), color: GREEN },
    { label: 'LATE:', value: String(totalLate), color: totalLate > 0 ? AMBER : TEXT_MUTED },
    { label: 'OVERDUE:', value: String(totalOverdue), color: totalOverdue > 0 ? RED : TEXT_MUTED },
    { label: 'IN PROG:', value: String(totalInProgress), color: SKY },
    { label: 'EXTENSIONS:', value: extValStr, color: NAVY },
  ];

  // Measure exact widths so items distribute evenly across full width with guaranteed gaps
  const measuredItems = stripItems.map((it) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.7);
    const lblW = doc.getTextWidth(`${it.label} `);
    doc.setFontSize(6.5);
    const valW = doc.getTextWidth(it.value);
    return { ...it, lblW, valW, totalW: lblW + valW };
  });

  const innerPadX = 3.8;
  const usableStripW = contentWidth - innerPadX * 2;
  const totalItemsW = measuredItems.reduce((sum, it) => sum + it.totalW, 0);
  const evenGap = Math.max(2.0, (usableStripW - totalItemsW) / (measuredItems.length - 1));

  let stripCursorX = marginX + innerPadX;
  const stripTextY = curY + 4.8;
  measuredItems.forEach((it) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.7);
    doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
    doc.text(`${it.label} `, stripCursorX, stripTextY);

    doc.setFontSize(6.5);
    doc.setTextColor(it.color[0], it.color[1], it.color[2]);
    doc.text(it.value, stripCursorX + it.lblW, stripTextY);

    stripCursorX += it.totalW + evenGap;
  });

  curY += stripH + 5.5;

  // =========================================================================
  // SECTION 1: MANAGERS KPI SUMMARY TABLE
  // =========================================================================
  drawSectionPillHeader(
    curY,
    '1. Managers KPI Summary',
    `${onlyManagers.length} Managers · Ranked by Overall KPI`,
    NAVY
  );
  curY += 8.6;

  // Column widths sum to exact 184mm (contentWidth)
  const kpiHead = [
    [
      '#',
      'Manager',
      'Done / Total',
      'On-Time',
      'Late',
      'Overdue',
      'In Prog',
      'Avg Speed',
      'Turnaround',
      'Avg Rating',
      'Overall KPI',
      'Status',
    ],
  ];

  const kpiBody = profiles.map((p) => {
    const s = p.stats;
    const kpiLabel = s.hasActiveUrgentPenalty
      ? `${s.overallKpi}%*`
      : `${s.overallKpi}%`;
    return [
      `#${p.rank}`,
      s.manager.name,
      `${s.completedCount} / ${s.totalAssigned}`,
      String(s.onTimeCount),
      String(s.lateCount),
      String(s.overdueCount),
      String(s.inProgressCount),
      fmtHours(s.avgManagerTurnaroundHours),
      `${s.turnaroundKpi}%`,
      fmtRating(s.avgRating),
      kpiLabel,
      p.kpiStatus.label,
    ];
  });

  kpiBody.push([
    '-',
    'Team Total / Avg',
    `${totalCompleted} / ${totalAssigned}`,
    String(totalOnTime),
    String(totalLate),
    String(totalOverdue),
    String(totalInProgress),
    fmtHours(teamAvgSpeed),
    `${teamTurnaroundKpi}%`,
    fmtRating(teamAverageRating),
    `${teamAverageKpi}%`,
    '',
  ]);

  autoTable(doc, {
    startY: curY,
    margin: {
      top: runningHeaderTopMargin,
      bottom: 14,
      left: marginX,
      right: marginX,
    },
    head: kpiHead,
    body: kpiBody,
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica',
      fontSize: 6.4,
      cellPadding: { top: 2.0, bottom: 2.0, left: 1.4, right: 1.4 },
      textColor: TEXT_DARK,
      lineColor: BORDER,
      lineWidth: 0.2,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 58, 108],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.0,
      halign: 'center',
      cellPadding: { top: 2.2, bottom: 2.2, left: 1.2, right: 1.2 },
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 28, fontStyle: 'bold', halign: 'left' },
      2: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 13, halign: 'center', fontStyle: 'bold', textColor: GREEN },
      4: { cellWidth: 11, halign: 'center', fontStyle: 'bold', textColor: AMBER },
      5: { cellWidth: 13, halign: 'center', fontStyle: 'bold', textColor: RED },
      6: { cellWidth: 12, halign: 'center', textColor: SKY },
      7: { cellWidth: 15, halign: 'center' },
      8: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
      9: { cellWidth: 16, halign: 'right', fontStyle: 'bold', textColor: AMBER },
      10: { cellWidth: 17, halign: 'right', fontStyle: 'bold', textColor: NAVY },
      11: { cellWidth: 19, halign: 'center', fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawRunningHeader();
      }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const isSubtotal = data.row.index === kpiBody.length - 1;
        if (isSubtotal) {
          data.cell.styles.fillColor = [238, 242, 255];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = NAVY;
        } else if (data.column.index === 11) {
          const prof = profiles[data.row.index];
          if (prof) {
            data.cell.styles.textColor = prof.kpiStatus.color;
            data.cell.styles.fillColor = prof.kpiStatus.bg;
          }
        } else if (data.column.index === 4) {
          const prof = profiles[data.row.index];
          if (prof && prof.stats.lateCount === 0) {
            data.cell.styles.textColor = TEXT_MUTED;
            data.cell.styles.fontStyle = 'normal';
          }
        } else if (data.column.index === 5) {
          const prof = profiles[data.row.index];
          if (prof && prof.stats.overdueCount === 0) {
            data.cell.styles.textColor = TEXT_MUTED;
            data.cell.styles.fontStyle = 'normal';
          }
        } else if (data.column.index === 3) {
          const prof = profiles[data.row.index];
          if (prof && prof.stats.onTimeCount === 0) {
            data.cell.styles.textColor = TEXT_MUTED;
            data.cell.styles.fontStyle = 'normal';
          }
        }
      }
    },
  });

  curY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const hasAnyUrgentPenalty = profiles.some((p) => p.stats.hasActiveUrgentPenalty);
  if (hasAnyUrgentPenalty) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.8);
    doc.setTextColor(RED[0], RED[1], RED[2]);
    doc.text(
      '* Active uncompleted urgent query (-50% KPI penalty applied until resolved).',
      marginX,
      curY + 4.0
    );
    curY += 6.5;
  } else {
    curY += 3.0;
  }

  curY += 5.0;

  // =========================================================================
  // SECTION 2: MANAGERS RATINGS BREAKDOWN (ADMIN 50% · SYSTEM 30% · SENDER 20%)
  // =========================================================================
  // Check exact space needed for header + table rows so it never clips or splits awkwardly
  const estimatedRatingTableH = 8.6 + (ratingBodyLength(profiles.length) + 1) * 6.5;
  curY = ensurePageSpace(curY, Math.min(estimatedRatingTableH, 60));

  drawSectionPillHeader(
    curY,
    '2. Managers Ratings Breakdown',
    'Admin 50% · System 30% · Sender 20%',
    TEAL
  );
  curY += 8.6;

  // Column widths sum to exact 184mm (contentWidth)
  const ratingHead = [
    [
      '#',
      'Manager',
      'Rated Queries',
      'Admin (50%)',
      'System (30%)',
      'Sender (20%)',
      'Avg Rating',
      'Rating %',
      'Tier',
    ],
  ];

  const ratingBody = profiles.map((p) => {
    const rPct =
      p.stats.avgRating !== null
        ? `${Math.round((p.stats.avgRating / 10) * 100)}%`
        : '-';
    return [
      `#${p.rank}`,
      p.stats.manager.name,
      String(p.stats.totalRated),
      fmtRating(p.avgAdminRating),
      fmtRating(p.avgSystemRating),
      fmtRating(p.avgSenderRating),
      fmtRating(p.stats.avgRating),
      rPct,
      p.ratingStatus.label,
    ];
  });

  ratingBody.push([
    '-',
    'Team Average',
    String(totalAssigned),
    fmtRating(teamAvgAdmin),
    fmtRating(teamAvgSystem),
    fmtRating(teamAvgSender),
    fmtRating(teamAverageRating),
    teamAverageRating !== null
      ? `${Math.round((teamAverageRating / 10) * 100)}%`
      : '-',
    '',
  ]);

  autoTable(doc, {
    startY: curY,
    margin: {
      top: runningHeaderTopMargin,
      bottom: 14,
      left: marginX,
      right: marginX,
    },
    head: ratingHead,
    body: ratingBody,
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica',
      fontSize: 6.4,
      cellPadding: { top: 2.0, bottom: 2.0, left: 1.5, right: 1.5 },
      textColor: TEXT_DARK,
      lineColor: BORDER,
      lineWidth: 0.2,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.1,
      halign: 'center',
      cellPadding: { top: 2.2, bottom: 2.2, left: 1.4, right: 1.4 },
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 34, fontStyle: 'bold', halign: 'left' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 20, halign: 'right', fontStyle: 'bold', textColor: TEAL },
      7: { cellWidth: 18, halign: 'right', fontStyle: 'bold', textColor: NAVY },
      8: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawRunningHeader();
      }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const isSubtotal = data.row.index === ratingBody.length - 1;
        if (isSubtotal) {
          data.cell.styles.fillColor = [240, 253, 250];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = TEAL;
        } else if (data.column.index === 8) {
          const prof = profiles[data.row.index];
          if (prof) {
            data.cell.styles.textColor = prof.ratingStatus.color;
            data.cell.styles.fillColor = prof.ratingStatus.bg;
          }
        }
      }
    },
  });

  // =========================================================================
  // PAGE 2+: INDIVIDUAL MANAGER KPI SCORECARDS (EVEN 2x4 GRID, ZERO OVERLAP)
  // =========================================================================
  doc.addPage();
  drawRunningHeader();

  curY = runningHeaderTopMargin;
  drawSectionPillHeader(
    curY,
    '3. Individual Manager KPI Scorecards',
    'Managers Only · Sorted by Rank',
    NAVY
  );
  curY += 9.4;

  const gridGapX = 4.4;
  const gridGapY = 5.0;
  const mcW = (contentWidth - gridGapX) / 2; // 89.8mm
  const mcH = 48.0; // Clean, spacious card height so every row breathes evenly

  const drawManagerCard = (p: ManagerReportProfile, x: number, y: number) => {
    const s = p.stats;
    const { accent, softBg, border } = p.theme;
    const padX = 3.2;
    const innerX = x + padX;
    const innerW = mcW - padX * 2; // 83.4mm

    // Card outer shell
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.setLineWidth(0.32);
    doc.roundedRect(x, y, mcW, mcH, 2.5, 2.5, 'FD');

    // Pastel header strip (10.5mm tall — safely houses rank, name, and right badges)
    const headerH = 10.5;
    doc.setFillColor(softBg[0], softBg[1], softBg[2]);
    doc.roundedRect(x + 0.3, y + 0.3, mcW - 0.6, headerH, 2.2, 2.2, 'F');
    doc.rect(x + 0.3, y + headerH - 3.0, mcW - 0.6, 3.3, 'F');

    // 1. Rank pill (left)
    const rankW = 7.8;
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(innerX, y + 2.4, rankW, 5.4, 1.6, 1.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(255, 255, 255);
    doc.text(`#${p.rank}`, innerX + rankW / 2, y + 6.0, { align: 'center' });

    // 2. Right KPI + Status Pill (measured first so name width never collides)
    const kpiPillText = `${s.overallKpi}% · ${p.kpiStatus.label}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.1);
    const kpW = doc.getTextWidth(kpiPillText) + 5.0;
    const kpX = x + mcW - padX - kpW;
    doc.setFillColor(p.kpiStatus.bg[0], p.kpiStatus.bg[1], p.kpiStatus.bg[2]);
    doc.setDrawColor(
      p.kpiStatus.color[0],
      p.kpiStatus.color[1],
      p.kpiStatus.color[2]
    );
    doc.setLineWidth(0.2);
    doc.roundedRect(kpX, y + 2.5, kpW, 5.2, 1.8, 1.8, 'FD');
    doc.setTextColor(
      p.kpiStatus.color[0],
      p.kpiStatus.color[1],
      p.kpiStatus.color[2]
    );
    doc.text(kpiPillText, kpX + kpW / 2, y + 5.9, { align: 'center' });

    // 3. Optional Urgent Penalty Pill placed immediately left of KPI Pill
    let rightReservedX = kpX - 1.6;
    if (s.hasActiveUrgentPenalty) {
      const urgW = 12.2;
      const ux = rightReservedX - urgW;
      doc.setFillColor(254, 226, 226);
      doc.setDrawColor(248, 113, 113);
      doc.setLineWidth(0.2);
      doc.roundedRect(ux, y + 2.7, urgW, 4.8, 1.2, 1.2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.0);
      doc.setTextColor(RED[0], RED[1], RED[2]);
      doc.text('-50% URG', ux + urgW / 2, y + 5.8, { align: 'center' });
      rightReservedX = ux - 1.6;
    }

    // 4. Manager Name strictly constrained to remaining middle space
    const nameStartX = innerX + rankW + 2.2;
    const maxNameW = Math.max(12, rightReservedX - nameStartX);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(fitTextToWidth(doc, s.manager.name, maxNameW), nameStartX, y + 6.2);

    // 5. Segmented progress bar
    drawSegmentedBar(innerX, y + 12.8, innerW, 2.4, s);

    // 6. 4 Core KPI metrics row (evenly spaced columns)
    const kpiRowY = y + 18.0;
    const coreMetrics: Array<{ label: string; val: string; color: RGB }> = [
      { label: 'TURNAROUND', val: `${s.turnaroundKpi}%`, color: NAVY },
      { label: 'AVG RATING', val: fmtRating(s.avgRating), color: AMBER },
      { label: 'COMPLETION', val: `${s.completionRate}%`, color: GREEN },
      { label: 'AVG SPEED', val: fmtHours(s.avgManagerTurnaroundHours), color: SKY },
    ];
    const mW = innerW / 4;
    coreMetrics.forEach((cm, i) => {
      const mx = innerX + i * mW + mW / 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.1);
      doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
      doc.text(cm.label, mx, kpiRowY + 1.0, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(cm.color[0], cm.color[1], cm.color[2]);
      doc.text(cm.val, mx, kpiRowY + 5.5, { align: 'center' });
    });

    // 7. 5 Query Count Mini-Cards (evenly spaced across innerW)
    const qStripY = y + 26.5;
    const qBoxH = 10.2;
    const qCounts: Array<{ label: string; val: number; color: RGB; bg: RGB }> = [
      {
        label: 'TOTAL',
        val: s.totalAssigned,
        color: s.totalAssigned > 0 ? NAVY : TEXT_MUTED,
        bg: [241, 245, 249],
      },
      {
        label: 'ON-TIME',
        val: s.onTimeCount,
        color: s.onTimeCount > 0 ? GREEN : TEXT_MUTED,
        bg: [236, 253, 245],
      },
      {
        label: 'LATE',
        val: s.lateCount,
        color: s.lateCount > 0 ? AMBER : TEXT_MUTED,
        bg: [254, 243, 199],
      },
      {
        label: 'OVERDUE',
        val: s.overdueCount,
        color: s.overdueCount > 0 ? RED : TEXT_MUTED,
        bg: [254, 242, 242],
      },
      {
        label: 'IN PROG',
        val: s.inProgressCount,
        color: s.inProgressCount > 0 ? SKY : TEXT_MUTED,
        bg: [240, 249, 255],
      },
    ];
    const qGap = 1.8;
    const qBoxW = (innerW - qGap * 4) / 5;
    qCounts.forEach((qc, i) => {
      const qx = innerX + i * (qBoxW + qGap);
      doc.setFillColor(qc.bg[0], qc.bg[1], qc.bg[2]);
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.setLineWidth(0.18);
      doc.roundedRect(qx, qStripY, qBoxW, qBoxH, 1.4, 1.4, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(4.7);
      doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
      doc.text(qc.label, qx + qBoxW / 2, qStripY + 3.6, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      doc.setTextColor(qc.color[0], qc.color[1], qc.color[2]);
      doc.text(String(qc.val), qx + qBoxW / 2, qStripY + 8.1, { align: 'center' });
    });

    // 8. Rating Split Strip at Bottom of Card (3 equal columns, zero overlap)
    const rStripY = y + 38.8;
    const rStripH = 6.4;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.18);
    doc.roundedRect(innerX, rStripY, innerW, rStripH, 1.3, 1.3, 'FD');

    const rCols = [
      { lbl: 'Admin (50%):', val: fmtRatingShort(p.avgAdminRating) },
      { lbl: 'System (30%):', val: fmtRatingShort(p.avgSystemRating) },
      { lbl: 'Sender (20%):', val: fmtRatingShort(p.avgSenderRating) },
    ];
    const rColW = innerW / 3;
    rCols.forEach((rc, i) => {
      const cx = innerX + i * rColW + rColW / 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      const lblW = doc.getTextWidth(`${rc.lbl} `);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.9);
      const valW = doc.getTextWidth(rc.val);
      const totalW = lblW + valW;
      const startX = cx - totalW / 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
      doc.text(`${rc.lbl} `, startX, rStripY + 4.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.9);
      doc.setTextColor(
        rc.val === '-' ? TEXT_MUTED[0] : TEAL[0],
        rc.val === '-' ? TEXT_MUTED[1] : TEAL[1],
        rc.val === '-' ? TEXT_MUTED[2] : TEAL[2]
      );
      doc.text(rc.val, startX + lblW, rStripY + 4.2);
    });
  };

  let rowOnPage = 0;
  let pageStartY = curY;

  profiles.forEach((p, idx) => {
    const col = idx % 2;
    if (col === 0 && idx > 0) {
      rowOnPage += 1;
    }

    const cardY = pageStartY + rowOnPage * (mcH + gridGapY);
    if (col === 0 && cardY + mcH > footerSafeBottom) {
      doc.addPage();
      drawRunningHeader();
      pageStartY = runningHeaderTopMargin;
      rowOnPage = 0;
    }

    const finalY = pageStartY + rowOnPage * (mcH + gridGapY);
    const cardX = marginX + col * (mcW + gridGapX);
    drawManagerCard(p, cardX, finalY);
  });

  // =========================================================================
  // GLOBAL PAGE FOOTERS
  // =========================================================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 10, marginX + contentWidth, pageHeight - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
    const footerLeft = `Query Portal Manager Performance Report  •  ${periodDisplay}  •  Generated by ${adminUser.name || 'Admin'}`;
    doc.text(fitTextToWidth(doc, footerLeft, contentWidth - 25), marginX, pageHeight - 6.2);
    doc.text(`Page ${i} of ${totalPages}`, marginX + contentWidth, pageHeight - 6.2, {
      align: 'right',
    });
  }

  const filename = `Query_Portal_Manager_Performance_Report_${pCfg.slug}_${formattedNow}.pdf`;
  doc.save(filename);

  return {
    success: true,
    filename,
    pages: totalPages,
  };
}

function ratingBodyLength(count: number): number {
  return count + 1;
}