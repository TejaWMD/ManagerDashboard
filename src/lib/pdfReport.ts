import jsPDF from 'jspdf';
import {
  Query,
  isQueryDelayed,
  isQueryDone,
  UserAccount,
} from '../types';
import {
  calculateAllManagersKpi,
  filterQueriesByWindow,
  KpiTimeWindow,
} from './kpi';

export interface GenerateWeeklyReportOptions {
  queries: Query[];
  managers: UserAccount[];
  adminUser: UserAccount;
  nowMs?: number;
  timeWindow?: KpiTimeWindow;
}

/**
 * Generates an executive-ready 2-page Portrait PDF report designed for Director-level review.
 * Page 1: Executive Overview, Team Benchmarks, and Manager Leaderboard.
 * Page 2: Individual Manager Performance Cards, General Overdue Watchlist, and SLA Extension Tracking.
 */
export function generateWeeklyManagerReportPdf({
  queries,
  managers,
  adminUser,
  nowMs = Date.now(),
  timeWindow = '7d',
}: GenerateWeeklyReportOptions): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182 mm
  const footerY = 284;

  // 1. Calculate KPI data using the official weighted scoring system
  const { stats, teamAverageKpi, teamAverageRating } = calculateAllManagersKpi(
    queries,
    managers,
    { window: timeWindow, nowMs }
  );

  // Scoped queries in the selected time window (with anti-cheat overdue carry-over)
  const windowQueries = filterQueriesByWindow(queries, timeWindow, nowMs);

  // Calculate team-level aggregate volume metrics
  const totalReceived = windowQueries.length;
  const totalCompleted = windowQueries.filter((q) => isQueryDone(q)).length;
  const totalDelayed = windowQueries.filter((q) => isQueryDelayed(q, nowMs)).length;
  const overdueActive = windowQueries.filter((q) => isQueryDelayed(q, nowMs) && !isQueryDone(q));

  const totalOnTime = stats.reduce((sum, s) => sum + s.onTimeCount, 0);
  const totalLate = stats.reduce((sum, s) => sum + s.lateCount, 0);
  const totalOverdue = stats.reduce((sum, s) => sum + s.overdueCount, 0);
  const totalInProgress = stats.reduce((sum, s) => sum + s.inProgressCount, 0);
  const totalEvaluated = totalOnTime + totalLate + totalOverdue;
  const totalPoints = stats.reduce((sum, s) => sum + s.earnedPoints, 0);

  const teamTurnaroundKpi =
    totalEvaluated > 0 ? Math.round((totalPoints / totalEvaluated) * 100) : 0;

  const teamSlaComplianceRate =
    totalCompleted > 0 ? Math.min(100, Math.round((totalOnTime / totalCompleted) * 100)) : 100;

  // Turnaround hours average across all evaluated manager queries
  const allTurnaroundTimes: number[] = [];
  stats.forEach((s) => {
    s.evaluatedQueries.forEach((eq) => {
      if (eq.managerTurnaroundHours !== null) {
        allTurnaroundTimes.push(eq.managerTurnaroundHours);
      }
    });
  });
  const teamAvgTurnaroundHours =
    allTurnaroundTimes.length > 0
      ? Math.round(
          (allTurnaroundTimes.reduce((acc, v) => acc + v, 0) /
            allTurnaroundTimes.length) *
            10
        ) / 10
      : null;

  // Total ratings count across team
  const totalRatingsCount = stats.reduce((sum, s) => sum + s.totalRated, 0);

  // SLA Extensions statistics
  const extensionsRequested = windowQueries.filter((q) => Boolean(q.extensionStatus && q.extensionStatus !== 'NONE')).length;
  const extensionsApproved = windowQueries.filter((q) => q.extensionStatus === 'APPROVED').length;
  const extensionsPending = windowQueries.filter((q) => q.extensionStatus === 'PENDING').length;

  // Date and Time labels
  const formattedNow = new Date(nowMs).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formattedTime = new Date(nowMs).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  let periodLabel = 'Last 7 Days (Weekly Review)';
  let dateRangeSubtitle = '';
  if (timeWindow === '7d') {
    const startMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const startStr = new Date(startMs).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    periodLabel = 'Weekly Briefing (7-Day Rolling)';
    dateRangeSubtitle = `Period: ${startStr} – ${formattedNow}`;
  } else if (timeWindow === '14d') {
    const startMs = nowMs - 14 * 24 * 60 * 60 * 1000;
    const startStr = new Date(startMs).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    periodLabel = 'Bi-Weekly Briefing (14 Days)';
    dateRangeSubtitle = `Period: ${startStr} – ${formattedNow}`;
  } else if (timeWindow === '30d') {
    const startMs = nowMs - 30 * 24 * 60 * 60 * 1000;
    const startStr = new Date(startMs).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    periodLabel = 'Monthly Operations Review (30 Days)';
    dateRangeSubtitle = `Period: ${startStr} – ${formattedNow}`;
  } else {
    periodLabel = 'All-Time Cumulative Review';
    dateRangeSubtitle = `Cumulative Overview up to ${formattedNow}`;
  }

  // Brand Palette Constants (RGB)
  const COLOR_BRAND_ORANGE = [214, 116, 43]; // #D6742B Warm Spice Orange
  const COLOR_BRAND_DARK = [37, 26, 10]; // #251A0A Russet Dark Slate
  const COLOR_SLATE_900 = [15, 23, 42]; // #0F172A
  const COLOR_SLATE_700 = [51, 65, 85]; // #334155
  const COLOR_SLATE_500 = [100, 116, 139]; // #64748B
  const COLOR_SLATE_300 = [203, 213, 225]; // #CBD5E1
  const COLOR_GREEN = [16, 185, 129]; // #10B981
  const COLOR_AMBER = [217, 119, 6]; // #D97706
  const COLOR_RED = [220, 38, 38]; // #DC2626
  const COLOR_BLUE = [14, 165, 233]; // #0EA5E9

  // ===========================================================================
  // PAGE 1: EXECUTIVE KPI SUMMARY & MANAGER LEADERBOARD
  // ===========================================================================

  // Top Accent Stripes
  doc.setFillColor(COLOR_BRAND_ORANGE[0], COLOR_BRAND_ORANGE[1], COLOR_BRAND_ORANGE[2]);
  doc.rect(0, 0, pageWidth, 4, 'F');
  doc.setFillColor(COLOR_BRAND_DARK[0], COLOR_BRAND_DARK[1], COLOR_BRAND_DARK[2]);
  doc.rect(0, 4, pageWidth, 1.2, 'F');

  // Header Left: Organization & Report Title
  let curY = 13.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(COLOR_BRAND_ORANGE[0], COLOR_BRAND_ORANGE[1], COLOR_BRAND_ORANGE[2]);
  doc.text('WMD OPERATIONS & SERVICE MANAGEMENT', margin, curY);

  curY += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  doc.text('Executive KPI Summary Report', margin, curY);

  curY += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  doc.text(`${dateRangeSubtitle}`, margin, curY);

  // Header Right: Metadata Box
  const metaRightX = pageWidth - margin;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(metaRightX - 60, 10, 60, 16, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  doc.text('EXECUTIVE SUMMARY', metaRightX - 30, 14, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  doc.text(`Generated: ${formattedNow} ${formattedTime}`, metaRightX - 30, 18, { align: 'center' });
  doc.text(`Admin: ${adminUser.name}`, metaRightX - 30, 22, { align: 'center' });

  // Divider Line
  curY += 5;
  doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  doc.setLineWidth(0.4);
  doc.line(margin, curY, pageWidth - margin, curY);

  // ---------------------------------------------------------------------------
  // Top 4 Executive Score Cards
  // ---------------------------------------------------------------------------
  curY += 5;
  const cardGap = 3.5;
  const cardWidth = (contentWidth - cardGap * 3) / 4; // ~42.8mm
  const cardHeight = 20;

  const topCards = [
    {
      title: 'TEAM OVERALL KPI',
      value: `${teamAverageKpi}%`,
      sub: `Turnaround: ${teamTurnaroundKpi}%`,
      barColor: teamAverageKpi >= 85 ? COLOR_GREEN : teamAverageKpi >= 70 ? COLOR_AMBER : COLOR_RED,
      valColor: teamAverageKpi >= 85 ? COLOR_GREEN : teamAverageKpi >= 70 ? COLOR_AMBER : COLOR_RED,
    },
    {
      title: 'SENDER SATISFACTION',
      value: teamAverageRating !== null ? `${teamAverageRating} / 5.0` : 'N/A',
      sub: totalRatingsCount > 0 ? `${totalRatingsCount} reviews logged` : 'No ratings yet',
      barColor: COLOR_BLUE,
      valColor: COLOR_SLATE_900,
    },
    {
      title: 'PERFORMANCE COMPLIANCE',
      value: `${teamSlaComplianceRate}%`,
      sub: `${totalOnTime} on-time · ${totalDelayed} delayed`,
      barColor: teamSlaComplianceRate >= 80 ? COLOR_GREEN : COLOR_AMBER,
      valColor: COLOR_SLATE_900,
    },
    {
      title: 'AVG RESPONSE SPEED',
      value: teamAvgTurnaroundHours !== null ? `${teamAvgTurnaroundHours} hrs` : '—',
      sub: 'Standard Performance: < 48 hrs',
      barColor: COLOR_BRAND_ORANGE,
      valColor: COLOR_SLATE_900,
    },
  ];

  topCards.forEach((c, idx) => {
    const cardX = margin + idx * (cardWidth + cardGap);
    // Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, curY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Colored top pill
    doc.setFillColor(c.barColor[0], c.barColor[1], c.barColor[2]);
    doc.rect(cardX, curY, cardWidth, 1.8, 'F');

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(c.title, cardX + cardWidth / 2, curY + 6.2, { align: 'center' });

    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(c.valColor[0], c.valColor[1], c.valColor[2]);
    doc.text(c.value, cardX + cardWidth / 2, curY + 12.8, { align: 'center' });

    // Subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(c.sub, cardX + cardWidth / 2, curY + 17.5, { align: 'center' });
  });

  curY += cardHeight + 7;

  // ---------------------------------------------------------------------------
  // Manager Leaderboard Table (Ranked #1 to #6)
  // ---------------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  doc.text('Manager Performance Leaderboard', margin, curY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  doc.text('Ranked by Overall KPI', pageWidth - margin, curY, {
    align: 'right',
  });

  curY += 3.5;

  // Table Column Definitions
  const cols = [
    { label: 'RANK', x: margin, width: 14, align: 'center' as const },
    { label: 'MANAGER', x: margin + 14, width: 42, align: 'left' as const },
    { label: 'OVERALL KPI', x: margin + 56, width: 24, align: 'center' as const },
    { label: 'TURNAROUND', x: margin + 80, width: 26, align: 'center' as const },
    { label: 'SENDER RATING', x: margin + 106, width: 24, align: 'center' as const },
    { label: 'COMPLETED / REC', x: margin + 130, width: 26, align: 'center' as const },
    { label: 'PERFORMANCE', x: margin + 156, width: 26, align: 'center' as const },
  ];

  // Header Row
  const headerHeight = 6.5;
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.rect(margin, curY, contentWidth, headerHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);

  cols.forEach((col) => {
    const textX = col.align === 'center' ? col.x + col.width / 2 : col.x + 3;
    doc.text(col.label, textX, curY + 4.5, { align: col.align });
  });

  curY += headerHeight;

  // Render Data Rows for all 6 managers
  const rowHeight = 10;
  stats.forEach((mgr, idx) => {
    const isEven = idx % 2 === 0;
    doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
    doc.rect(margin, curY, contentWidth, rowHeight, 'F');

    // Row border bottom
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, curY + rowHeight, pageWidth - margin, curY + rowHeight);

    // 1. Rank
    const rankLabel = idx === 0 ? '#1' : idx === 1 ? '#2' : idx === 2 ? '#3' : `#${idx + 1}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(idx === 0 ? 217 : idx === 1 ? 100 : idx === 2 ? 180 : 71, idx === 0 ? 119 : idx === 1 ? 116 : idx === 2 ? 83 : 85, idx === 0 ? 6 : idx === 1 ? 139 : idx === 2 ? 9 : 105);
    doc.text(rankLabel, cols[0].x + cols[0].width / 2, curY + 6.2, { align: 'center' });

    // 2. Manager Name & Email
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
    doc.text(mgr.manager.name, cols[1].x + 3, curY + 4.5);

    // doc.setFont('helvetica', 'normal');
    // doc.setFontSize(6);
    // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    // doc.text(mgr.manager.email, cols[1].x + 3, curY + 8);

    // 3. Overall KPI Badge
    const kpiBadgeColor =
      mgr.overallKpi >= 85 ? COLOR_GREEN : mgr.overallKpi >= 70 ? COLOR_AMBER : COLOR_RED;
    const badgeW = 16;
    const badgeH = 5.2;
    const badgeX = cols[2].x + (cols[2].width - badgeW) / 2;
    const badgeY = curY + 2.4;

    doc.setFillColor(kpiBadgeColor[0] === 16 ? 236 : kpiBadgeColor[0] === 217 ? 254 : 254, kpiBadgeColor[1] === 185 ? 253 : kpiBadgeColor[1] === 119 ? 243 : 242, kpiBadgeColor[2] === 129 ? 245 : kpiBadgeColor[2] === 6 ? 199 : 242);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(kpiBadgeColor[0], kpiBadgeColor[1], kpiBadgeColor[2]);
    doc.text(`${mgr.overallKpi}%`, badgeX + badgeW / 2, badgeY + 3.8, { align: 'center' });

    // 4. Turnaround Score
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
    doc.text(`${mgr.turnaroundKpi}%`, cols[3].x + cols[3].width / 2, curY + 4.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(`${mgr.earnedPoints}/${mgr.totalEvaluated} pts`, cols[3].x + cols[3].width / 2, curY + 8, {
      align: 'center',
    });

    // 5. Sender Rating
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    if (mgr.avgRating !== null) {
      doc.setTextColor(217, 119, 6);
      doc.text(`${mgr.avgRating}`, cols[4].x + cols[4].width / 2, curY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
      doc.text(`${mgr.totalRated} review${mgr.totalRated === 1 ? '' : 's'}`, cols[4].x + cols[4].width / 2, curY + 8, {
        align: 'center',
      });
    } else {
      doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
      doc.text('—', cols[4].x + cols[4].width / 2, curY + 6.2, { align: 'center' });
    }

    // 6. Volume (Completed / Received)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
    doc.text(`${mgr.completedCount} / ${mgr.totalAssigned}`, cols[5].x + cols[5].width / 2, curY + 4.5, {
      align: 'center',
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(`${mgr.completionRate}% resolved`, cols[5].x + cols[5].width / 2, curY + 8, {
      align: 'center',
    });

    // 7. SLA Delayed (Late + Overdue)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    if (mgr.delayedCount > 0) {
      doc.setTextColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
      doc.text(String(mgr.delayedCount), cols[6].x + cols[6].width / 2, curY + 4.5, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.text(`(${mgr.overdueCount} overdue)`, cols[6].x + cols[6].width / 2, curY + 8, {
        align: 'center',
      });
    } else {
      doc.setTextColor(COLOR_GREEN[0], COLOR_GREEN[1], COLOR_GREEN[2]);
      doc.text('0 (Clean)', cols[6].x + cols[6].width / 2, curY + 6.2, { align: 'center' });
    }

    curY += rowHeight;
  });

  // Table Outer Frame Box
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(margin, curY - (stats.length * rowHeight + headerHeight), contentWidth, stats.length * rowHeight + headerHeight, 'S');

  curY += 7;

  // ---------------------------------------------------------------------------
  // Team Workload & Pipeline Distribution Strip
  // ---------------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  doc.text('Weekly Overview', margin, curY);

  curY += 3.5;

  // 5 Status Capsules
  const distGap = 3;
  const distWidth = (contentWidth - distGap * 4) / 5;
  const distHeight = 14;

  const pipelinePills = [
    { label: 'TOTAL RECEIVED', count: totalReceived, color: COLOR_SLATE_700, bg: [248, 250, 252] },
    { label: 'RESOLVED ON-TIME', count: totalOnTime, color: COLOR_GREEN, bg: [236, 253, 245] },
    { label: 'RESOLVED LATE', count: totalLate, color: COLOR_AMBER, bg: [254, 243, 199] },
    { label: 'OPEN OVERDUE', count: totalOverdue, color: COLOR_RED, bg: [254, 242, 242] },
    { label: 'IN PROGRESS', count: totalInProgress, color: COLOR_BLUE, bg: [240, 249, 255] },
  ];

  pipelinePills.forEach((p, idx) => {
    const px = margin + idx * (distWidth + distGap);
    doc.setFillColor(p.bg[0], p.bg[1], p.bg[2]);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(px, curY, distWidth, distHeight, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(p.label, px + distWidth / 2, curY + 4.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(p.color[0], p.color[1], p.color[2]);
    doc.text(String(p.count), px + distWidth / 2, curY + 10.8, { align: 'center' });
  });

  curY += distHeight + 4;

  // // Stacked Segment Progress Bar
  // const barHeight = 3.5;
  // doc.setFillColor(241, 245, 249);
  // doc.roundedRect(margin, curY, contentWidth, barHeight, 0.8, 0.8, 'F');

  // if (totalReceived > 0) {
  //   const onTimeW = (totalOnTime / totalReceived) * contentWidth;
  //   const lateW = (totalLate / totalReceived) * contentWidth;
  //   const overdueW = (totalOverdue / totalReceived) * contentWidth;
  //   const inProgW = (totalInProgress / totalReceived) * contentWidth;

  //   let segX = margin;
  //   if (onTimeW > 0) {
  //     doc.setFillColor(COLOR_GREEN[0], COLOR_GREEN[1], COLOR_GREEN[2]);
  //     doc.rect(segX, curY, onTimeW, barHeight, 'F');
  //     segX += onTimeW;
  //   }
  //   if (lateW > 0) {
  //     doc.setFillColor(COLOR_AMBER[0], COLOR_AMBER[1], COLOR_AMBER[2]);
  //     doc.rect(segX, curY, lateW, barHeight, 'F');
  //     segX += lateW;
  //   }
  //   if (overdueW > 0) {
  //     doc.setFillColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
  //     doc.rect(segX, curY, overdueW, barHeight, 'F');
  //     segX += overdueW;
  //   }
  //   if (inProgW > 0) {
  //     doc.setFillColor(COLOR_BLUE[0], COLOR_BLUE[1], COLOR_BLUE[2]);
  //     doc.rect(segX, curY, inProgW, barHeight, 'F');
  //   }
  // }

  // curY += barHeight + 6;

  // // ---------------------------------------------------------------------------
  // // Executive Commentary & Operations Highlights
  // // ---------------------------------------------------------------------------
  // const insightsBoxHeight = 36;
  // doc.setFillColor(255, 255, 255);
  // doc.setDrawColor(226, 232, 240);
  // doc.roundedRect(margin, curY, contentWidth, insightsBoxHeight, 1.5, 1.5, 'FD');

  // doc.setFillColor(COLOR_BRAND_ORANGE[0], COLOR_BRAND_ORANGE[1], COLOR_BRAND_ORANGE[2]);
  // doc.rect(margin, curY, 2, insightsBoxHeight, 'F');

  // doc.setFont('helvetica', 'bold');
  // doc.setFontSize(8);
  // doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  // doc.text('Key Operational Observations & Leadership Notes:', margin + 6, curY + 5.5);

  // const topMgr = stats.length > 0 ? stats[0] : null;
  // const bestTurnaround = stats
  //   .filter((s) => s.avgManagerTurnaroundHours !== null)
  //   .sort((a, b) => (a.avgManagerTurnaroundHours ?? 999) - (b.avgManagerTurnaroundHours ?? 999))[0];

  // const insightLines: string[] = [];

  // if (topMgr && topMgr.overallKpi > 0) {
  //   insightLines.push(
  //     `Leading Performer: ${topMgr.manager.name} achieved the top overall ranking with a score of ${topMgr.overallKpi}% and ${topMgr.completedCount} completed queries.`
  //   );
  // } else {
  //   insightLines.push('Weekly Performance: Operations tracking active across all registered managers.');
  // }

  // if (totalDelayed > 0) {
  //   insightLines.push(
  //     `PERFORMANCE Monitoring: ${totalDelayed} total queries exceeded the 48-hour threshold (${totalLate} resolved late, ${totalOverdue} currently active overdue requiring intervention).`
  //   );
  // } else {
  //   insightLines.push('PERFORMANCE Excellence: 100% of evaluated queries were completed strictly within the standard 48-hour performance deadline.');
  // }

  // if (bestTurnaround && bestTurnaround.avgManagerTurnaroundHours !== null) {
  //   insightLines.push(
  //     `Speed Benchmark: Fastest response speed logged by ${bestTurnaround.manager.name} averaging ${bestTurnaround.avgManagerTurnaroundHours} hours per query.`
  //   );
  // }

  // if (extensionsApproved > 0 || extensionsPending > 0) {
  //   insightLines.push(
  //     `Extension Activity: ${extensionsRequested} extensions requested this period (${extensionsApproved} approved, ${extensionsPending} pending review).`
  //   );
  // } else {
  //   insightLines.push(`Satisfaction Metric: Team average sender rating is ${teamAverageRating !== null ? `${teamAverageRating} / 5.0` : 'N/A'} based on ${totalRatingsCount} verified evaluations.`);
  // }

  // doc.setFont('helvetica', 'normal');
  // doc.setFontSize(6.8);
  // doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);

  // insightLines.slice(0, 4).forEach((line, lIdx) => {
  //   doc.text(`* ${line}`, margin + 6, curY + 11.5 + lIdx * 5.5);
  // });

  // curY += insightsBoxHeight + 5;

  // // ---------------------------------------------------------------------------
  // // KPI Formula & Scoring Policy Notice (Footnote Box)
  // // ---------------------------------------------------------------------------
  // doc.setFillColor(248, 250, 252);
  // doc.setDrawColor(226, 232, 240);
  // doc.roundedRect(margin, curY, contentWidth, 11, 1, 1, 'FD');

  // doc.setFont('helvetica', 'bold');
  // doc.setFontSize(6);
  // doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  // doc.text('OFFICIAL DIRECTOR SCORING POLICY:', margin + 4, curY + 4);

  // doc.setFont('helvetica', 'normal');
  // doc.setFontSize(5.6);
  // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text(
  //   'Turnaround Score: On-Time (+1.0 pt), Late (>48h) (+0.5 pt), Overdue Open (0.0 pt penalty). In-Progress (<48h) excluded until deadline expires.',
  //   margin + 4,
  //   curY + 7.2
  // );
  // doc.text(
  //   'Overall KPI: Equal 50/50 blend of Turnaround Score and Anonymous Sender Satisfaction Rating (5.0 stars = 100%).',
  //   margin + 4,
  //   curY + 9.8
  // );

  // Page 1 Footer
  doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageWidth - margin, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('CONFIDENTIAL & PROPRIETARY · WMD MANAGEMENT', margin, footerY + 5);
  doc.text('Page 1 of 2', pageWidth / 2, footerY + 5, { align: 'center' });
  doc.text('WMD Manager Portal System', pageWidth - margin, footerY + 5, { align: 'right' });

  // ===========================================================================
  // PAGE 2: INDIVIDUAL SCORECARDS, OVERDUE WATCHLIST & SIGN-OFF
  // ===========================================================================
  doc.addPage();

  // Top Accent Stripes
  doc.setFillColor(COLOR_BRAND_ORANGE[0], COLOR_BRAND_ORANGE[1], COLOR_BRAND_ORANGE[2]);
  doc.rect(0, 0, pageWidth, 4, 'F');
  doc.setFillColor(COLOR_BRAND_DARK[0], COLOR_BRAND_DARK[1], COLOR_BRAND_DARK[2]);
  doc.rect(0, 4, pageWidth, 1.2, 'F');

  curY = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(COLOR_BRAND_ORANGE[0], COLOR_BRAND_ORANGE[1], COLOR_BRAND_ORANGE[2]);
  doc.text('WMD EXECUTIVE KPI REPORT · INDIVIDUAL PERFORMANCE BREAKDOWN', margin, curY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  doc.text(`Page 2 of 2`, pageWidth - margin, curY, { align: 'right' });

  curY += 3.5;
  doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, curY, pageWidth - margin, curY);

  // ---------------------------------------------------------------------------
  // 6 Individual Manager Scorecards (2 Columns x 3 Rows)
  // ---------------------------------------------------------------------------
  curY += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  doc.text('Individual Manager Scorecards', margin, curY);

  // doc.setFont('helvetica', 'normal');
  // doc.setFontSize(7);
  // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('Comprehensive turnaround time, rating, and resolution breakdown', pageWidth - margin, curY, {
  //   align: 'right',
  // });

  curY += 4;
  const gridGap = 4;
  const mCardWidth = (contentWidth - gridGap) / 2; // ~89mm
  const mCardHeight = 33;

  stats.forEach((mgr, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cardX = margin + col * (mCardWidth + gridGap);
    const cardY = curY + row * (mCardHeight + gridGap);

    // Outer Card Container
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, cardY, mCardWidth, mCardHeight, 1.5, 1.5, 'FD');

    // Left Border Highlight (Red if overdue queries exist, otherwise Green)
    if (mgr.overdueCount > 0) {
      doc.setFillColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
    } else if (mgr.overallKpi >= 85) {
      doc.setFillColor(COLOR_GREEN[0], COLOR_GREEN[1], COLOR_GREEN[2]);
    } else {
      doc.setFillColor(COLOR_AMBER[0], COLOR_AMBER[1], COLOR_AMBER[2]);
    }
    doc.rect(cardX, cardY + 2, 1.8, mCardHeight - 4, 'F');

    // Rank Badge
    const rankNum = idx + 1;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(cardX + 4, cardY + 3.2, 7, 5, 0.8, 0.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
    doc.text(`#${rankNum}`, cardX + 7.5, cardY + 6.8, { align: 'center' });

    // Manager Name & Email
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
    doc.text(mgr.manager.name, cardX + 13, cardY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(mgr.manager.email, cardX + 13, cardY + 8.8);

    // Overall KPI Badge Right
    const badgeW = 16;
    const badgeH = 5.2;
    const badgeX = cardX + mCardWidth - badgeW - 3;
    const badgeY = cardY + 3.2;

    const kpiColor =
      mgr.overallKpi >= 85 ? COLOR_GREEN : mgr.overallKpi >= 70 ? COLOR_AMBER : COLOR_RED;
    doc.setFillColor(kpiColor[0] === 16 ? 236 : kpiColor[0] === 217 ? 254 : 254, kpiColor[1] === 185 ? 253 : kpiColor[1] === 119 ? 243 : 242, kpiColor[2] === 129 ? 245 : kpiColor[2] === 6 ? 199 : 242);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(kpiColor[0], kpiColor[1], kpiColor[2]);
    doc.text(`${mgr.overallKpi}%`, badgeX + badgeW / 2, badgeY + 3.8, { align: 'center' });

    // Progress Bar Track (On-time, Late, Overdue, In-Prog)
    const pBarY = cardY + 12.2;
    const pBarW = mCardWidth - 8;
    const pBarH = 2.4;

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(cardX + 4, pBarY, pBarW, pBarH, 0.6, 0.6, 'F');

    if (mgr.totalAssigned > 0) {
      const oW = (mgr.onTimeCount / mgr.totalAssigned) * pBarW;
      const lW = (mgr.lateCount / mgr.totalAssigned) * pBarW;
      const odW = (mgr.overdueCount / mgr.totalAssigned) * pBarW;
      const ipW = (mgr.inProgressCount / mgr.totalAssigned) * pBarW;

      let bX = cardX + 4;
      if (oW > 0) {
        doc.setFillColor(COLOR_GREEN[0], COLOR_GREEN[1], COLOR_GREEN[2]);
        doc.rect(bX, pBarY, oW, pBarH, 'F');
        bX += oW;
      }
      if (lW > 0) {
        doc.setFillColor(COLOR_AMBER[0], COLOR_AMBER[1], COLOR_AMBER[2]);
        doc.rect(bX, pBarY, lW, pBarH, 'F');
        bX += lW;
      }
      if (odW > 0) {
        doc.setFillColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
        doc.rect(bX, pBarY, odW, pBarH, 'F');
        bX += odW;
      }
      if (ipW > 0) {
        doc.setFillColor(COLOR_BLUE[0], COLOR_BLUE[1], COLOR_BLUE[2]);
        doc.rect(bX, pBarY, ipW, pBarH, 'F');
      }
    }

    // 4 Micro Metric Capsules
    const subColWidth = (mCardWidth - 8) / 4;
    const miniKpis = [
      { label: 'ON-TIME', val: mgr.onTimeCount, isRed: false, color: COLOR_GREEN },
      { label: 'LATE', val: mgr.lateCount, isRed: false, color: COLOR_AMBER },
      { label: 'OVERDUE', val: mgr.overdueCount, isRed: mgr.overdueCount > 0, color: COLOR_RED },
      { label: 'IN-PROG', val: mgr.inProgressCount, isRed: false, color: COLOR_BLUE },
    ];

    const kpiY = cardY + 17.5;
    miniKpis.forEach((mk, mIdx) => {
      const mkX = cardX + 4 + mIdx * subColWidth + subColWidth / 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.2);
      doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
      doc.text(mk.label, mkX, kpiY, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(mk.color[0], mk.color[1], mk.color[2]);
      doc.text(String(mk.val), mkX, kpiY + 4, { align: 'center' });
    });

    // Bottom Speed & Satisfaction Strip
    const bottomY = cardY + 28.5;
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(cardX + 4, bottomY - 3, cardX + mCardWidth - 4, bottomY - 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    const respSpeedStr = mgr.avgManagerTurnaroundHours !== null ? `${mgr.avgManagerTurnaroundHours}h` : '—';
    const ratingStr = mgr.avgRating !== null ? `* ${mgr.avgRating}/5.0` : 'No reviews';
    doc.text(`Avg Speed: ${respSpeedStr}  ·  Rating: ${ratingStr}`, cardX + 4, bottomY);

    doc.text(`${mgr.completedCount}/${mgr.totalAssigned} resolved`, cardX + mCardWidth - 4, bottomY, {
      align: 'right',
    });
  });

  const totalCardRows = Math.ceil(stats.length / 2);
  curY += totalCardRows * (mCardHeight + gridGap) + 5;

  // ---------------------------------------------------------------------------
  // Section 2: Priority Action Watchlist (General / Non-Sensitive Summary)
  // ---------------------------------------------------------------------------
  // doc.setFont('helvetica', 'bold');
  // doc.setFontSize(10.5);
  // doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  // doc.text('Operational Escalations & SLA Watchlist', margin, curY);

  // curY += 3.5;

  // if (overdueActive.length > 0) {
  //   // Red Alert Card
  //   const watchHeight = Math.min(40, 16 + overdueActive.length * 6);
  //   doc.setFillColor(254, 242, 242);
  //   doc.setDrawColor(254, 202, 202);
  //   doc.roundedRect(margin, curY, contentWidth, watchHeight, 1.5, 1.5, 'FD');

  //   doc.setFont('helvetica', 'bold');
  //   doc.setFontSize(7.8);
  //   doc.setTextColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
  //   doc.text(
  //     `Priority Attention Required: ${overdueActive.length} Open Queries Exceeding 48-Hour SLA`,
  //     margin + 4,
  //     curY + 5.5
  //   );

  //   doc.setFont('helvetica', 'normal');
  //   doc.setFontSize(6.5);
  //   doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  //   doc.text(
  //     'General tracking view (confidential remarks withheld for team distribution):',
  //     margin + 4,
  //     curY + 9.5
  //   );

  //   // General Overdue Table Items
  //   overdueActive.slice(0, 4).forEach((oq, oIdx) => {
  //     const rowY = curY + 14.5 + oIdx * 5.8;
  //     const createdDateStr = oq.createdAt ? oq.createdAt.slice(0, 10) : 'Recent';
      
  //     // Clean, general title or category snippet (no sensitive private text)
  //     let generalTopic = oq.queryTitle ? oq.queryTitle.trim() : 'Operational Query';
  //     if (generalTopic.length > 40) {
  //       generalTopic = `${generalTopic.slice(0, 37)}...`;
  //     }

  //     const stageText = !oq.managerDone
  //       ? 'Pending Manager Review'
  //       : 'Pending Sender Confirmation';

  //     doc.setFont('helvetica', 'bold');
  //     doc.setFontSize(6.5);
  //     doc.setTextColor(COLOR_RED[0], COLOR_RED[1], COLOR_RED[2]);
  //     doc.text(`[${oq.queryId || oq.id}]`, margin + 4, rowY);

  //     doc.setFont('helvetica', 'bold');
  //     doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  //     doc.text(oq.managerName || 'Unassigned', margin + 26, rowY);

  //     doc.setFont('helvetica', 'normal');
  //     doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  //     doc.text(`Subject: ${generalTopic}`, margin + 55, rowY);

  //     doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  //     doc.text(`Logged: ${createdDateStr}`, margin + 125, rowY);

  //     doc.setFont('helvetica', 'bold');
  //     doc.setTextColor(COLOR_AMBER[0], COLOR_AMBER[1], COLOR_AMBER[2]);
  //     doc.text(stageText, pageWidth - margin - 4, rowY, { align: 'right' });
  //   });

  //   if (overdueActive.length > 4) {
  //     doc.setFont('helvetica', 'normal');
  //     doc.setFontSize(6);
  //     doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  //     doc.text(
  //       `+ ${overdueActive.length - 4} additional overdue items logged in system portal.`,
  //       margin + 4,
  //       curY + watchHeight - 3
  //     );
  //   }

  //   curY += watchHeight + 6;
  // } else {
  //   // Green Positive Banner
  //   const goodHeight = 14;
  //   doc.setFillColor(240, 253, 244);
  //   doc.setDrawColor(187, 247, 208);
  //   doc.roundedRect(margin, curY, contentWidth, goodHeight, 1.5, 1.5, 'FD');

  //   doc.setFont('helvetica', 'bold');
  //   doc.setFontSize(8);
  //   doc.setTextColor(COLOR_GREEN[0], COLOR_GREEN[1], COLOR_GREEN[2]);
  //   doc.text('Optimal SLA Health: Zero Unresolved Overdue Queries', margin + 4, curY + 6);

  //   doc.setFont('helvetica', 'normal');
  //   doc.setFontSize(6.8);
  //   doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  //   doc.text(
  //     'All active open queries are currently progressing strictly within the 48-hour service level agreement.',
  //     margin + 4,
  //     curY + 10.5
  //   );

  //   curY += goodHeight + 6;
  // }

  // ---------------------------------------------------------------------------
  // Section 3: SLA Extension Management Summary
  // ---------------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  doc.text('Target Due Date & Extension Governance', margin, curY);

  curY += 3.5;

  const extCardHeight = 15;
  const extColW = (contentWidth - 9) / 4;

  const extItems = [
    { label: 'EXTENSIONS REQUESTED', val: extensionsRequested, color: COLOR_SLATE_700 },
    { label: 'APPROVED BY SENDER', val: extensionsApproved, color: COLOR_GREEN },
    { label: 'PENDING MUTUAL REVIEW', val: extensionsPending, color: COLOR_AMBER },
    {
      label: 'EXTENDED ON-TIME RATE',
      val:
        extensionsApproved > 0
          ? `${Math.round(
              (windowQueries.filter((q) => q.extensionStatus === 'APPROVED' && isQueryDone(q) && !isQueryDelayed(q, nowMs)).length /
                extensionsApproved) *
                100
            )}%`
          : '100%',
      color: COLOR_BLUE,
    },
  ];

  extItems.forEach((ei, eIdx) => {
    const eX = margin + eIdx * (extColW + 3);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(eX, curY, extColW, extCardHeight, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
    doc.text(ei.label, eX + extColW / 2, curY + 4.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(ei.color[0], ei.color[1], ei.color[2]);
    doc.text(String(ei.val), eX + extColW / 2, curY + 11.5, { align: 'center' });
  });

  curY += extCardHeight + 7;

  // ---------------------------------------------------------------------------
  // Section 4: Executive Review Sign-Off & Audit Block
  // ---------------------------------------------------------------------------
  // const signHeight = 22;
  // doc.setFillColor(248, 250, 252);
  // doc.setDrawColor(226, 232, 240);
  // doc.roundedRect(margin, curY, contentWidth, signHeight, 1.5, 1.5, 'FD');

  // doc.setFont('helvetica', 'bold');
  // doc.setFontSize(6.8);
  // doc.setTextColor(COLOR_SLATE_700[0], COLOR_SLATE_700[1], COLOR_SLATE_700[2]);
  // doc.text('EXECUTIVE VERIFICATION & AUDIT SIGN-OFF', margin + 4, curY + 5.5);

  // const signColWidth = (contentWidth - 8) / 3;

  // // Prepared by
  // doc.setFont('helvetica', 'normal');
  // doc.setFontSize(6.2);
  // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('Prepared By (Operations Admin):', margin + 4, curY + 10.5);
  // doc.setFont('helvetica', 'bold');
  // doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  // doc.text(`${adminUser.name} (${adminUser.email})`, margin + 4, curY + 15);

  // // Submitted To
  // const subX = margin + 4 + signColWidth;
  // doc.setFont('helvetica', 'normal');
  // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('Submitted To:', subX, curY + 10.5);
  // doc.setFont('helvetica', 'bold');
  // doc.setTextColor(COLOR_SLATE_900[0], COLOR_SLATE_900[1], COLOR_SLATE_900[2]);
  // doc.text('Director & Management Board', subX, curY + 15);

  // // Signature Line
  // const sigX = margin + 4 + signColWidth * 2;
  // doc.setFont('helvetica', 'normal');
  // doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('Director Acknowledgment:', sigX, curY + 10.5);
  // doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  // doc.line(sigX, curY + 17, sigX + signColWidth - 8, curY + 17);
  // doc.setFontSize(5.5);
  // doc.text('Signature & Date', sigX, curY + 20);

  // Page 2 Footer
  doc.setDrawColor(COLOR_SLATE_300[0], COLOR_SLATE_300[1], COLOR_SLATE_300[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY, pageWidth - margin, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(COLOR_SLATE_500[0], COLOR_SLATE_500[1], COLOR_SLATE_500[2]);
  // doc.text('CONFIDENTIAL & PROPRIETARY · WMD MANAGEMENT', margin, footerY + 5);
  doc.text('Page 2 of 2', pageWidth / 2, footerY + 5, { align: 'center' });
  doc.text('WMD Manager Portal System', pageWidth - margin, footerY + 5, { align: 'right' });

  // ---------------------------------------------------------------------------
  // Save PDF Document with Clean Contextual Filename
  // ---------------------------------------------------------------------------
  const dateStr = new Date(nowMs).toISOString().slice(0, 10);
  const prefix =
    timeWindow === '7d'
      ? 'Weekly'
      : timeWindow === '14d'
      ? 'BiWeekly'
      : timeWindow === '30d'
      ? 'Monthly'
      : 'Cumulative';

  doc.save(`${prefix}_Manager_KPI_Report_${dateStr}.pdf`);
}
