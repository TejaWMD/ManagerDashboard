import jsPDF from 'jspdf';
import { Query, isQueryDelayed, isQueryDone, UserAccount } from '../types';
import { calculateAllManagersKpi, filterQueriesByWindow, KpiTimeWindow } from './kpi';
import { formatDate } from './dateUtils';

export interface GenerateWeeklyReportOptions {
  queries: Query[];
  managers: UserAccount[];
  adminUser: UserAccount;
  nowMs?: number;
  timeWindow?: KpiTimeWindow;
}

/** Executive-grade 2-page A4 portrait KPI report. */
export function generateWeeklyManagerReportPdf({
  queries,
  managers,
  adminUser,
  nowMs = Date.now(),
  timeWindow = '7d',
}: GenerateWeeklyReportOptions): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Layout constants ────────────────────────────────────────────────────
  const PAGE_W = 210;
  const M = 14;
  const CW = PAGE_W - M * 2; // 182
  const FOOTER_Y = 284;

  // ── Palette (single source of truth) ────────────────────────────────────
  const C = {
    brandOrange: [214, 116, 43] as RGB,
    brandDark: [37, 26, 10] as RGB,
    slate: {
      900: [15, 23, 42] as RGB,
      800: [30, 41, 59] as RGB,
      700: [51, 65, 85] as RGB,
      500: [100, 116, 139] as RGB,
      400: [148, 163, 184] as RGB,
      300: [203, 213, 225] as RGB,
      200: [226, 232, 240] as RGB,
      100: [241, 245, 249] as RGB,
      50: [248, 250, 252] as RGB,
    },
    green: [16, 185, 129] as RGB,
    greenBg: [236, 253, 245] as RGB,
    amber: [217, 119, 6] as RGB,
    amberBg: [254, 243, 199] as RGB,
    red: [220, 38, 38] as RGB,
    redBg: [254, 242, 242] as RGB,
    blue: [14, 165, 233] as RGB,
    blueBg: [240, 249, 255] as RGB,
    white: [255, 255, 255] as RGB,
  };
  type RGB = [number, number, number];

  // ── Primitives ─────────────────────────────────────────────────────────
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB, w = 0.3) => {
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(w);
  };
  const text = (
    s: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'center' | 'right' } = {},
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 7);
    const col = opts.color ?? C.slate[900];
    doc.setTextColor(col[0], col[1], col[2]);
    doc.text(s, x, y, { align: opts.align ?? 'left' });
  };
  const box = (x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; r?: number } = {}) => {
    if (opts.fill) fill(opts.fill);
    if (opts.stroke) stroke(opts.stroke);
    const r = opts.r ?? 1.2;
    doc.roundedRect(x, y, w, h, r, r, opts.fill && opts.stroke ? 'FD' : opts.fill ? 'F' : 'S');
  };
  const kpiColorFor = (v: number) => (v >= 85 ? C.green : v >= 70 ? C.amber : C.red);
  const kpiBgFor = (v: number) => (v >= 85 ? C.greenBg : v >= 70 ? C.amberBg : C.redBg);
  const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // ── Chrome (top accent, footer) ────────────────────────────────────────
  const drawChrome = () => {
    fill(C.brandOrange); doc.rect(0, 0, PAGE_W, 4, 'F');
    fill(C.brandDark); doc.rect(0, 4, PAGE_W, 1.2, 'F');
  };
  const drawFooter = (page: number, total: number) => {
    stroke(C.slate[300]); doc.line(M, FOOTER_Y, PAGE_W - M, FOOTER_Y);
    const fy = FOOTER_Y + 4.5;
    text('CONFIDENTIAL & PROPRIETARY · WMD MANAGEMENT', M, fy, { size: 6.5, color: C.slate[500] });
    text(`Page ${page} of ${total}`, PAGE_W / 2, fy, { size: 6.5, color: C.slate[500], align: 'center' });
    text('WMD Manager Portal System', PAGE_W - M, fy, { size: 6.5, color: C.slate[500], align: 'right' });
  };

  // ── Aggregate metrics ──────────────────────────────────────────────────
  const { stats, teamAverageKpi, teamAverageRating } = calculateAllManagersKpi(queries, managers, {
    window: timeWindow,
    nowMs,
  });
  const windowQueries = filterQueriesByWindow(queries, timeWindow, nowMs);

  const totalReceived = windowQueries.length;
  const totalCompleted = windowQueries.filter(isQueryDone).length;
  const totalDelayed = windowQueries.filter((q) => isQueryDelayed(q, nowMs)).length;
  const overdueActive = windowQueries.filter((q) => isQueryDelayed(q, nowMs) && !isQueryDone(q));

  const sum = (k: keyof (typeof stats)[number]) => stats.reduce((a, s) => a + (s[k] as number), 0);
  const totalOnTime = sum('onTimeCount');
  const totalLate = sum('lateCount');
  const totalOverdue = sum('overdueCount');
  const totalInProgress = sum('inProgressCount');
  const totalEvaluated = totalOnTime + totalLate + totalOverdue;
  const totalPoints = sum('earnedPoints');
  const totalRatings = sum('totalRated');

  const teamTurnaroundKpi = totalEvaluated > 0 ? Math.round((totalPoints / totalEvaluated) * 100) : 0;
  const teamSlaRate = totalCompleted > 0 ? Math.min(100, Math.round((totalOnTime / totalCompleted) * 100)) : 100;

  const turnaroundSamples = stats.flatMap((s) =>
    s.evaluatedQueries.map((e) => e.managerTurnaroundHours).filter((v): v is number => v !== null),
  );
  const teamAvgTurnaround =
    turnaroundSamples.length > 0
      ? Math.round((turnaroundSamples.reduce((a, v) => a + v, 0) / turnaroundSamples.length) * 10) / 10
      : null;

  const ext = {
    requested: windowQueries.filter((q) => q.extensionStatus && q.extensionStatus !== 'NONE').length,
    approved: windowQueries.filter((q) => q.extensionStatus === 'APPROVED').length,
    pending: windowQueries.filter((q) => q.extensionStatus === 'PENDING').length,
  };

  // ── Period labels (collapsed switch) ───────────────────────────────────
  const formattedNow = formatDate(nowMs);
  const timeNow = new Date(nowMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const periodMeta: Record<string, { label: string; days?: number }> = {
    '7d': { label: 'Weekly Briefing (7-Day Rolling)', days: 7 },
    '14d': { label: 'Bi-Weekly Briefing (14 Days)', days: 14 },
    '30d': { label: 'Monthly Operations Review (30 Days)', days: 30 },
    all: { label: 'All-Time Cumulative Review' },
  };
  const pm = periodMeta[timeWindow] ?? periodMeta['7d'];
  const dateRange = pm.days
    ? `Period: ${formatDate(nowMs - pm.days * 864e5)} to ${formattedNow}`
    : `Cumulative Overview up to ${formattedNow}`;

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 1
  // ══════════════════════════════════════════════════════════════════════
  drawChrome();
  let y = 13.5;

  text('WMD OPERATIONS & SERVICE MANAGEMENT', M, y, { size: 8, bold: true, color: C.brandOrange });
  text('Weekly Executive Manager KPI Report', M, (y += 5.5), { size: 14.5, bold: true });
  text(`${pm.label}  |  ${dateRange}`, M, (y += 4.5), { size: 8, color: C.slate[500] });

  // Metadata card (right-aligned)
  const metaW = 62, metaX = PAGE_W - M - metaW;
  box(metaX, 10, metaW, 17, { fill: C.slate[50], stroke: C.slate[300], r: 1.5 });
  const mc = metaX + metaW / 2;
  text('WEEKLY EXECUTIVE AUDIT', mc, 14, { size: 6.8, bold: true, color: C.slate[700], align: 'center' });
  [
    `Generated: ${formattedNow} ${timeNow}`,
    `Admin: ${adminUser.name} (${adminUser.roleLabel ?? 'Admin'})`,
    `Scope: ${stats.length} Managers · ${totalReceived} Queries`,
  ].forEach((line, i) => text(line, mc, 17.8 + i * 3.4, { size: 6.2, color: C.slate[500], align: 'center' }));

  stroke(C.slate[300], 0.4);
  doc.line(M, (y += 5), PAGE_W - M, y);
  y += 4.5;

  // ── Top KPI cards ──────────────────────────────────────────────────────
  const cards = [
    { t: 'TEAM OVERALL KPI', v: `${teamAverageKpi}%`, s: 'Target: >= 85%', c: kpiColorFor(teamAverageKpi) },
    { t: 'ON-TIME RESOLUTIONS', v: `${totalOnTime}`, s: `${teamSlaRate}% SLA rate`, c: C.green },
    {
      t: 'DELAYED & OVERDUE',
      v: `${totalDelayed}`,
      s: `${totalLate} late · ${totalOverdue} overdue`,
      c: totalDelayed === 0 ? C.green : totalDelayed > 2 ? C.red : C.amber,
    },
    {
      t: 'SENDER SATISFACTION',
      v: teamAverageRating !== null ? `${teamAverageRating} / 5.0` : 'N/A',
      s: totalRatings > 0 ? `${totalRatings} reviews logged` : 'No reviews yet',
      c: C.slate[900],
    },
    {
      t: 'AVG RESPONSE SPEED',
      v: teamAvgTurnaround !== null ? `${teamAvgTurnaround}h` : '—',
      s: 'Standard SLA: < 24h',
      c: C.slate[900],
    },
  ];
  const gap = 3, cardW = (CW - gap * 4) / 5, cardH = 19;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    box(x, y, cardW, cardH, { fill: C.white, stroke: C.slate[200] });
    fill(c.c);
    doc.rect(x, y, cardW, 1.6, 'F');
    text(c.t, x + cardW / 2, y + 5.8, { size: 5.8, bold: true, color: C.slate[500], align: 'center' });
    text(c.v, x + cardW / 2, y + 12.0, { size: 12.5, bold: true, color: c.c, align: 'center' });
    text(c.s, x + cardW / 2, y + 16.5, { size: 5.6, color: C.slate[500], align: 'center' });
  });
  y += cardH + 6;

  // ── Leaderboard table ──────────────────────────────────────────────────
  text('Manager Performance Leaderboard', M, y, { size: 10, bold: true });
  text('Ranked by Director KPI Scoring Policy (Turnaround 50% + Sender Rating 50%)', PAGE_W - M, y, {
    size: 6.8,
    color: C.slate[500],
    align: 'right',
  });
  y += 3.5;

  const cols = [
    { l: 'RANK', x: M, w: 12, a: 'center' as const },
    { l: 'MANAGER', x: M + 12, w: 38, a: 'left' as const },
    { l: 'OVERALL KPI', x: M + 50, w: 22, a: 'center' as const },
    { l: 'ON-TIME', x: M + 72, w: 22, a: 'center' as const },
    { l: 'DELAYED', x: M + 94, w: 22, a: 'center' as const },
    { l: 'AVG RATING', x: M + 116, w: 22, a: 'center' as const },
    { l: 'TURNAROUND', x: M + 138, w: 22, a: 'center' as const },
    { l: 'WORKLOAD', x: M + 160, w: 22, a: 'center' as const },
  ];
  const headerH = 6.5;
  fill(C.slate[800]);
  doc.rect(M, y, CW, headerH, 'F');
  cols.forEach((c) => text(c.l, c.a === 'center' ? c.x + c.w / 2 : c.x + 3, y + 4.5, {
    size: 6.2, bold: true, color: C.white, align: c.a,
  }));
  y += headerH;
  const tableTop = y;

  const rowH = 9.5;
  stats.forEach((m, i) => {
    if (i % 2 === 0) { fill(C.white); doc.rect(M, y, CW, rowH, 'F'); }
    stroke(C.slate[200], 0.2);
    doc.line(M, y + rowH, PAGE_W - M, y + rowH);

    // Rank
    const rankColors = [C.amber, C.slate[500], [180, 83, 9] as RGB, C.slate[700]];
    text(`#${i + 1}`, cols[0].x + cols[0].w / 2, y + 5.8, {
      size: 7.5, bold: true, color: rankColors[Math.min(i, 3)], align: 'center',
    });

    // Manager
    text(m.manager.name, cols[1].x + 3, y + 4.2, { size: 7.5, bold: true });
    text(truncate(m.manager.email, 24), cols[1].x + 3, y + 7.6, { size: 5.5, color: C.slate[500] });

    // KPI badge
    const bW = 16, bH = 5.2, bX = cols[2].x + (cols[2].w - bW) / 2, bY = y + 2.1;
    box(bX, bY, bW, bH, { fill: kpiBgFor(m.overallKpi), r: 1 });
    text(`${m.overallKpi}%`, bX + bW / 2, bY + 3.8, {
      size: 7.5, bold: true, color: kpiColorFor(m.overallKpi), align: 'center',
    });

    // On-time
    const onRate = m.totalAssigned > 0 ? Math.round((m.onTimeCount / m.totalAssigned) * 100) : 0;
    text(`${m.onTimeCount} on-time`, cols[3].x + cols[3].w / 2, y + 4.2, {
      size: 7.2, bold: true, color: C.green, align: 'center',
    });
    text(`${onRate}% of assigned`, cols[3].x + cols[3].w / 2, y + 7.6, {
      size: 5.5, color: C.slate[500], align: 'center',
    });

    // Delayed
    const hasDelay = m.delayedCount > 0;
    text(hasDelay ? `${m.delayedCount} delayed` : '0 (Clean)', cols[4].x + cols[4].w / 2, y + 4.2, {
      size: 7.2, bold: true, color: hasDelay ? C.red : C.green, align: 'center',
    });
    text(
      hasDelay ? `${m.lateCount} late · ${m.overdueCount} od` : '100% on SLA',
      cols[4].x + cols[4].w / 2,
      y + 7.6,
      { size: 5.5, color: C.slate[500], align: 'center' },
    );

    // Rating
    text(
      m.avgRating !== null ? `${m.avgRating} / 5.0` : '—',
      cols[5].x + cols[5].w / 2, y + 4.2,
      { size: 7.2, bold: true, color: m.avgRating !== null ? C.amber : C.slate[400], align: 'center' },
    );
    text(
      m.avgRating !== null ? `${m.totalRated} review${m.totalRated === 1 ? '' : 's'}` : 'No reviews',
      cols[5].x + cols[5].w / 2, y + 7.6,
      { size: 5.5, color: C.slate[500], align: 'center' },
    );

    // Turnaround
    text(`${m.turnaroundKpi}% score`, cols[6].x + cols[6].w / 2, y + 4.2, { size: 7.2, bold: true, align: 'center' });
    text(
      m.avgManagerTurnaroundHours !== null ? `${m.avgManagerTurnaroundHours}h avg` : '—',
      cols[6].x + cols[6].w / 2, y + 7.6,
      { size: 5.5, color: C.slate[500], align: 'center' },
    );

    // Workload
    text(`${m.completedCount} / ${m.totalAssigned}`, cols[7].x + cols[7].w / 2, y + 4.2, { size: 7.2, bold: true, align: 'center' });
    text(`${m.completionRate}% resolved`, cols[7].x + cols[7].w / 2, y + 7.6, {
      size: 5.5, color: C.slate[500], align: 'center',
    });

    y += rowH;
  });

  // Summary row
  const sumH = 7.5;
  fill(C.slate[100]);
  doc.rect(M, y, CW, sumH, 'F');
  stroke(C.slate[300]);
  doc.line(M, y, PAGE_W - M, y);
  doc.line(M, y + sumH, PAGE_W - M, y + sumH);

  text('TEAM', cols[0].x + cols[0].w / 2, y + 4.8, { size: 6.8, bold: true, color: C.slate[800], align: 'center' });
  text('Team Totals & Averages', cols[1].x + 3, y + 4.8, { size: 6.8, bold: true, color: C.slate[800] });
  text(`${teamAverageKpi}% avg`, cols[2].x + cols[2].w / 2, y + 4.8, {
    size: 6.8, bold: true, color: kpiColorFor(teamAverageKpi), align: 'center',
  });
  text(`${totalOnTime} total`, cols[3].x + cols[3].w / 2, y + 4.8, { size: 6.8, bold: true, color: C.green, align: 'center' });
  text(
    totalDelayed > 0 ? `${totalDelayed} (${totalOverdue} od)` : '0 (Clean)',
    cols[4].x + cols[4].w / 2, y + 4.8,
    { size: 6.8, bold: true, color: totalDelayed > 0 ? C.red : C.green, align: 'center' },
  );
  text(teamAverageRating !== null ? `${teamAverageRating} avg` : '—', cols[5].x + cols[5].w / 2, y + 4.8, {
    size: 6.8, bold: true, color: C.amber, align: 'center',
  });
  text(`${teamTurnaroundKpi}% pts`, cols[6].x + cols[6].w / 2, y + 4.8, { size: 6.8, bold: true, color: C.slate[800], align: 'center' });
  text(`${totalCompleted} / ${totalReceived}`, cols[7].x + cols[7].w / 2, y + 4.8, { size: 6.8, bold: true, color: C.slate[800], align: 'center' });
  y += sumH;

  stroke(C.slate[300]);
  doc.rect(M, tableTop - headerH, CW, y - (tableTop - headerH), 'S');
  y += 5.5;

  // ── Pipeline strip ─────────────────────────────────────────────────────
  text('Weekly Operations Pipeline & Resolution Breakdown', M, y, { size: 9, bold: true });
  y += 3.5;

  const pills = [
    { l: 'TOTAL RECEIVED', n: totalReceived, c: C.slate[700], bg: C.slate[50] },
    { l: 'RESOLVED ON-TIME', n: totalOnTime, c: C.green, bg: C.greenBg },
    { l: 'RESOLVED LATE', n: totalLate, c: C.amber, bg: C.amberBg },
    { l: 'OPEN OVERDUE', n: totalOverdue, c: C.red, bg: C.redBg },
    { l: 'IN PROGRESS', n: totalInProgress, c: C.blue, bg: C.blueBg },
  ];
  const pGap = 3, pW = (CW - pGap * 4) / 5, pH = 12.5;
  pills.forEach((p, i) => {
    const x = M + i * (pW + pGap);
    box(x, y, pW, pH, { fill: p.bg, stroke: C.slate[200] });
    text(p.l, x + pW / 2, y + 4.2, { size: 5.6, bold: true, color: C.slate[500], align: 'center' });
    text(String(p.n), x + pW / 2, y + 9.8, { size: 9.5, bold: true, color: p.c, align: 'center' });
  });
  y += pH + 3;

  // Stacked bar
  const barH = 3.2;
  box(M, y, CW, barH, { fill: C.slate[100], r: 0.8 });
  if (totalReceived > 0) {
    const segs: Array<[number, RGB]> = [
      [totalOnTime, C.green],
      [totalLate, C.amber],
      [totalOverdue, C.red],
      [totalInProgress, C.blue],
    ];
    let sx = M;
    segs.forEach(([count, color]) => {
      const w = (count / totalReceived) * CW;
      if (w > 0) { fill(color); doc.rect(sx, y, w, barH, 'F'); sx += w; }
    });
  }
  y += barH + 5;

  // ── Observations ───────────────────────────────────────────────────────
  const insightsH = 32;
  box(M, y, CW, insightsH, { fill: C.white, stroke: C.slate[200], r: 1.5 });
  fill(C.brandOrange);
  doc.rect(M, y, 2, insightsH, 'F');
  text('Key Operational Observations & Leadership Notes:', M + 6, y + 5.2, { size: 7.8, bold: true });

  const top = stats[0];
  const fastest = stats
    .filter((s) => s.avgManagerTurnaroundHours !== null)
    .sort((a, b) => (a.avgManagerTurnaroundHours ?? 999) - (b.avgManagerTurnaroundHours ?? 999))[0];

  const insights: string[] = [
    top && top.overallKpi > 0
      ? `Leading Performer: ${top.manager.name} led at ${top.overallKpi}% with ${top.completedCount} completed queries (${top.onTimeCount} on-time).`
      : `Weekly Performance: Operations tracking active across ${stats.length} managers.`,
    totalDelayed > 0
      ? `SLA Monitoring: ${totalDelayed} queries breached 24h SLA (${totalLate} late, ${totalOverdue} active overdue).`
      : 'SLA Excellence: 100% of evaluated queries resolved within the 24h deadline.',
    fastest?.avgManagerTurnaroundHours != null
      ? `Speed Benchmark: Fastest responder was ${fastest.manager.name} (${fastest.avgManagerTurnaroundHours}h avg).`
      : `Speed Benchmark: Team average is ${teamAvgTurnaround ?? 0}h.`,
    ext.approved > 0 || ext.pending > 0
      ? `Extension Activity: ${ext.requested} requested (${ext.approved} approved, ${ext.pending} pending).`
      : `Sender Satisfaction: ${teamAverageRating ?? 'N/A'} / 5.0 across ${totalRatings} reviews.`,
  ];
  insights.forEach((line, i) => text(`* ${line}`, M + 6, y + 11.0 + i * 5.0, {
    size: 6.5, color: C.slate[700],
  }));
  y += insightsH + 4;

  // ── Footnote ───────────────────────────────────────────────────────────
  const footH = 11;
  box(M, y, CW, footH, { fill: C.slate[50], stroke: C.slate[200], r: 1 });
  text('OFFICIAL DIRECTOR SCORING POLICY & SLA METHODOLOGY:', M + 4, y + 3.8, {
    size: 5.8, bold: true, color: C.slate[700],
  });
  [
    'Turnaround Score: On-Time (+1.0 pt), Late (>24h) (+0.5 pt), Overdue Open (0.0). In-Progress (<24h) excluded until deadline.',
    'Overall KPI: 50/50 blend of Turnaround Score and Anonymous Sender Satisfaction Rating (5.0 stars = 100%). Overdue queries carry forward.',
  ].forEach((line, i) => text(line, M + 4, y + 6.8 + i * 2.7, { size: 5.3, color: C.slate[500] }));

  drawFooter(1, 2);

  // ══════════════════════════════════════════════════════════════════════
  // PAGE 2
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage();
  drawChrome();
  y = 12;

  text('WMD EXECUTIVE KPI REPORT · INDIVIDUAL PERFORMANCE BREAKDOWN', M, y, {
    size: 7.5, bold: true, color: C.brandOrange,
  });
  text('Page 2 of 2', PAGE_W - M, y, { size: 7, color: C.slate[500], align: 'right' });
  stroke(C.slate[300]);
  doc.line(M, (y += 3.5), PAGE_W - M, y);

  // ── Manager scorecards ─────────────────────────────────────────────────
  y += 4.5;
  text('Individual Manager Performance Scorecards', M, y, { size: 10, bold: true });
  text('Detailed turnaround times, sender ratings, and resolution metrics', PAGE_W - M, y, {
    size: 6.8, color: C.slate[500], align: 'right',
  });
  y += 3.5;

  const gridGap = 3.5;
  const mcW = (CW - gridGap) / 2;
  const mcH = 28.5;

  stats.forEach((m, idx) => {
    const col = idx % 2, row = Math.floor(idx / 2);
    const x = M + col * (mcW + gridGap);
    const cy = y + row * (mcH + gridGap);

    box(x, cy, mcW, mcH, { fill: C.white, stroke: C.slate[200], r: 1.5 });

    // Left accent
    const accent = m.overdueCount > 0 ? C.red : m.overallKpi >= 85 ? C.green : C.amber;
    fill(accent); doc.rect(x, cy + 1.8, 1.6, mcH - 3.6, 'F');

    // Rank chip
    box(x + 3.5, cy + 2.8, 6.5, 4.5, { fill: C.slate[100], r: 0.8 });
    text(`#${idx + 1}`, x + 6.75, cy + 6.0, { size: 6.2, bold: true, color: C.slate[700], align: 'center' });

    // Name + email
    text(m.manager.name, x + 11.5, cy + 4.8, { size: 7.8, bold: true });
    text(truncate(m.manager.email, 22), x + 11.5, cy + 7.8, { size: 5.5, color: C.slate[500] });

    // KPI badge
    const bW = 15, bH = 4.8, bX = x + mcW - bW - 3, bY = cy + 2.6;
    box(bX, bY, bW, bH, { fill: kpiBgFor(m.overallKpi), r: 1 });
    text(`${m.overallKpi}%`, bX + bW / 2, bY + 3.5, {
      size: 7.2, bold: true, color: kpiColorFor(m.overallKpi), align: 'center',
    });

    // Progress bar
    const pBarY = cy + 10.5, pBarW = mcW - 7, pBarH = 2.0;
    box(x + 3.5, pBarY, pBarW, pBarH, { fill: C.slate[100], r: 0.5 });
    if (m.totalAssigned > 0) {
      let bx = x + 3.5;
      ([
        [m.onTimeCount, C.green],
        [m.lateCount, C.amber],
        [m.overdueCount, C.red],
        [m.inProgressCount, C.blue],
      ] as Array<[number, RGB]>).forEach(([count, color]) => {
        const w = (count / m.totalAssigned) * pBarW;
        if (w > 0) { fill(color); doc.rect(bx, pBarY, w, pBarH, 'F'); bx += w; }
      });
    }

    // Mini metrics
    const mini: Array<[string, number, RGB]> = [
      ['ON-TIME', m.onTimeCount, C.green],
      ['LATE', m.lateCount, C.amber],
      ['OVERDUE', m.overdueCount, C.red],
      ['IN-PROG', m.inProgressCount, C.blue],
    ];
    const subW = (mcW - 7) / 4;
    const kY = cy + 15.2;
    mini.forEach(([label, val, color], i) => {
      const mx = x + 3.5 + i * subW + subW / 2;
      text(label, mx, kY, { size: 4.8, color: C.slate[500], align: 'center' });
      text(String(val), mx, kY + 3.6, { size: 7, bold: true, color, align: 'center' });
    });

    // Bottom strip
    const bottomY = cy + 25.2;
    stroke(C.slate[100], 0.2);
    doc.line(x + 3.5, bottomY - 2.5, x + mcW - 3.5, bottomY - 2.5);
    const speed = m.avgManagerTurnaroundHours !== null ? `${m.avgManagerTurnaroundHours}h` : '—';
    const rating = m.avgRating !== null ? `${m.avgRating} / 5.0` : 'No reviews';
    text(`Speed: ${speed}  ·  Rating: ${rating}`, x + 3.5, bottomY, { size: 5.5, color: C.slate[500] });
    text(`${m.completedCount}/${m.totalAssigned} resolved`, x + mcW - 3.5, bottomY, {
      size: 5.5, color: C.slate[500], align: 'right',
    });
  });

  // Fill odd slot with team benchmark card
  if (stats.length % 2 !== 0) {
    const idx = stats.length;
    const x = M + (idx % 2) * (mcW + gridGap);
    const cy = y + Math.floor(idx / 2) * (mcH + gridGap);

    box(x, cy, mcW, mcH, { fill: C.slate[50], stroke: C.brandOrange, r: 1.5 });
    fill(C.brandOrange); doc.rect(x, cy + 1.8, 1.6, mcH - 3.6, 'F');

    text('TEAM OPERATIONS BENCHMARK', x + 6, cy + 5.5, { size: 7.5, bold: true });
    text('Departmental Aggregate & Target Standards', x + 6, cy + 8.8, { size: 5.5, color: C.slate[500] });

    const bW = (mcW - 10) / 3, bY = cy + 12.0;
    const bench: Array<[string, string, RGB]> = [
      ['OVERALL KPI', `${teamAverageKpi}%`, teamAverageKpi >= 85 ? C.green : C.amber],
      ['SLA COMPLIANCE', `${teamSlaRate}%`, C.green],
      ['RESOLVED', `${totalCompleted}/${totalReceived}`, C.blue],
    ];
    bench.forEach(([label, val, color], i) => {
      const bx = x + 5 + i * bW + bW / 2;
      text(label, bx, bY + 3.0, { size: 5.0, color: C.slate[500], align: 'center' });
      text(val, bx, bY + 7.5, { size: 8.0, bold: true, color, align: 'center' });
    });

    const bottomY = cy + 25.2;
    stroke(C.slate[200], 0.2);
    doc.line(x + 4, bottomY - 2.5, x + mcW - 4, bottomY - 2.5);
    text(`Avg Speed: ${teamAvgTurnaround ?? '—'}h`, x + 5, bottomY, { size: 5.5, color: C.slate[500] });
    text(`Rating: ${teamAverageRating ?? 'N/A'} / 5.0`, x + mcW - 5, bottomY, {
      size: 5.5, color: C.slate[500], align: 'right',
    });
  }

  y += Math.ceil(Math.max(stats.length, 1) / 2) * (mcH + gridGap) + 4.5;

  // ── Watchlist ──────────────────────────────────────────────────────────
  text('Operational Escalations & SLA Watchlist', M, y, { size: 9.5, bold: true });
  text('Queries exceeding standard 24-hour service level agreement', PAGE_W - M, y, {
    size: 6.5, color: C.slate[500], align: 'right',
  });
  y += 3.2;

  if (overdueActive.length > 0) {
    const rows = Math.min(3, overdueActive.length);
    const watchH = 11 + rows * 5.6;
    box(M, y, CW, watchH, { fill: C.redBg, stroke: [254, 202, 202] as RGB, r: 1.5 });
    text(`Priority Attention Required: ${overdueActive.length} Open Queries Exceeding SLA Deadline`, M + 4, y + 5, {
      size: 7.2, bold: true, color: C.red,
    });
    text('Active bottlenecks requiring manager resolution or administrative intervention:', M + 4, y + 8.5, {
      size: 5.8, color: C.slate[700],
    });

    overdueActive.slice(0, 3).forEach((oq, i) => {
      const ry = y + 13 + i * 5.4;
      const stage = !oq.managerDone ? 'Pending Manager Review' : 'Pending Sender Confirmation';
      text(`[${oq.queryId ?? oq.id}]`, M + 4, ry, { size: 6.2, bold: true, color: C.red });
      text(oq.managerName ?? 'Unassigned', M + 26, ry, { size: 6.2, bold: true });
      text(`Topic: ${truncate(oq.queryTitle?.trim() ?? 'Operational Query', 38)}`, M + 55, ry, {
        size: 6.2, color: C.slate[700],
      });
      text(`Logged: ${oq.createdAt?.slice(0, 10) ?? 'Recent'}`, M + 124, ry, { size: 6.2, color: C.slate[500] });
      text(stage, PAGE_W - M - 4, ry, { size: 6.2, bold: true, color: C.amber, align: 'right' });
    });

    if (overdueActive.length > 3) {
      text(`+ ${overdueActive.length - 3} additional overdue items logged in system portal.`, M + 4, y + watchH - 2.5, {
        size: 5.5, color: C.slate[500],
      });
    }
    y += watchH + 4.5;
  } else {
    const goodH = 11.5;
    box(M, y, CW, goodH, { fill: C.greenBg, stroke: [187, 247, 208] as RGB, r: 1.5 });
    text('Optimal SLA Health: Zero Unresolved Overdue Queries', M + 4, y + 4.8, {
      size: 7.5, bold: true, color: C.green,
    });
    text('All active open queries are currently progressing strictly within the 24-hour service level agreement.', M + 4, y + 8.8, {
      size: 6.2, color: C.slate[700],
    });
    y += goodH + 4.5;
  }

  // ── Extension governance ───────────────────────────────────────────────
  text('Target Due Date & Extension Governance', M, y, { size: 9, bold: true });
  y += 3.0;

  const extOnTime =
    ext.approved > 0
      ? `${Math.round(
          (windowQueries.filter(
            (q) => q.extensionStatus === 'APPROVED' && isQueryDone(q) && !isQueryDelayed(q, nowMs),
          ).length /
            ext.approved) *
            100,
        )}%`
      : '100%';

  const extItems: Array<[string, string | number, RGB]> = [
    ['EXTENSIONS REQUESTED', ext.requested, C.slate[700]],
    ['APPROVED BY SENDER', ext.approved, C.green],
    ['PENDING MUTUAL REVIEW', ext.pending, C.amber],
    ['EXTENDED ON-TIME RATE', extOnTime, C.blue],
  ];
  const extW = (CW - 9) / 4, extH = 13.5;
  extItems.forEach(([label, val, color], i) => {
    const ex = M + i * (extW + 3);
    box(ex, y, extW, extH, { fill: C.white, stroke: C.slate[200] });
    text(label, ex + extW / 2, y + 4.2, { size: 5.2, bold: true, color: C.slate[500], align: 'center' });
    text(String(val), ex + extW / 2, y + 10.5, { size: 9.5, bold: true, color, align: 'center' });
  });
  y += extH + 5;

  // ── Sign-off ───────────────────────────────────────────────────────────
  const signH = 22;
  box(M, y, CW, signH, { fill: C.slate[50], stroke: C.slate[200], r: 1.5 });
  text('EXECUTIVE VERIFICATION & AUDIT SIGN-OFF', M + 4, y + 4.8, {
    size: 6.5, bold: true, color: C.slate[700],
  });

  const colW = (CW - 8) / 3;
  const signCols: Array<[string, string, string]> = [
    ['Prepared By (Operations Admin):', `${adminUser.name} (${adminUser.email})`, `Stamping: ${formattedNow} ${timeNow}`],
    ['Submitted To:', 'Director & Management Board', 'WMD Corporate Service Governance'],
    ['Director Acknowledgment:', '', ''],
  ];
  signCols.forEach(([l1, l2, l3], i) => {
    const cx = M + 4 + i * colW;
    text(l1, cx, y + 9.5, { size: 5.8, color: C.slate[500] });
    if (l2) text(l2, cx, y + 13.8, { size: 5.8, bold: true });
    if (l3) text(l3, cx, y + 18.0, { size: 5.2, color: C.slate[500] });
    if (i === 2) {
      stroke(C.slate[300]);
      doc.line(cx, y + 16.5, cx + colW - 8, y + 16.5);
      text('Signature & Date', cx, y + 19.5, { size: 5.2, color: C.slate[500] });
    }
  });

  drawFooter(2, 2);

  // ── Save ───────────────────────────────────────────────────────────────
  const prefix: Record<string, string> = { '7d': 'Weekly', '14d': 'BiWeekly', '30d': 'Monthly' };
  doc.save(`${prefix[timeWindow] ?? 'Cumulative'}_Manager_KPI_Report_${formatDate(nowMs)}.pdf`);
}