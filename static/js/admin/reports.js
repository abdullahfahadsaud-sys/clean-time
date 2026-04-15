(function () {
  const admin = (window.CleanTimeAdmin = window.CleanTimeAdmin || {});

  admin.setupReports = function setupReports(ctx) {
    const { state, els } = ctx;

    ctx.setChartDefaults = function setChartDefaults() {
      Chart.defaults.color = "#8a9bbf";
      Chart.defaults.font.family = "Cairo";
    };

    ctx.renderReports = function renderReports(payload) {
      const total = payload.summary?.total || {};
      const today = payload.summary?.today || {};
      const expensesMonth = payload.summary?.expensesMonth || {};
      const teamExpensesMonth = payload.summary?.teamExpensesMonth || {};
      els.reportStats.innerHTML = `
        <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${total.count || 0}</div><div class="stat-label">إجمالي العمليات الكلية</div></div>
        <div class="stat-card orange"><div class="stat-icon">💰</div><div class="stat-value">${Number(total.total || 0).toFixed(0)}</div><div class="stat-label">إجمالي الدخل الكلي (ر)</div></div>
        <div class="stat-card orange"><div class="stat-icon">📅</div><div class="stat-value">${Number(today.total || 0).toFixed(0)}</div><div class="stat-label">دخل هذا اليوم (ر)</div></div>
        <div class="stat-card"><div class="stat-icon">💳</div><div class="stat-value">${Number(expensesMonth.total || 0).toFixed(0)}</div><div class="stat-label">المصروفات العامة هذا الشهر (ر)</div></div>
        <div class="stat-card"><div class="stat-icon">🚗</div><div class="stat-value">${Number(teamExpensesMonth.total || 0).toFixed(0)}</div><div class="stat-label">المصروفات الخاصة هذا الشهر (ر)</div></div>
        <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-value">${Number(payload.summary?.netMonth || 0).toFixed(0)}</div><div class="stat-label">صافي هذا الشهر (ر)</div></div>
      `;

      if (state.payChart) state.payChart.destroy();
      state.payChart = new Chart(els.paymentChart, {
        type: "doughnut",
        data: {
          labels: Object.keys(payload.paymentCounts || {}),
          datasets: [
            {
              data: Object.values(payload.paymentCounts || {}),
              backgroundColor: [
                "rgba(46,204,113,.75)",
                "rgba(74,184,193,.75)",
                "rgba(232,101,42,.75)",
                "rgba(155,89,182,.75)",
              ],
              borderColor: "#0f2044",
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { padding: 12, font: { size: 12 } },
            },
          },
        },
      });

      if (state.svcChart) state.svcChart.destroy();
      state.svcChart = new Chart(els.servicesChart, {
        type: "bar",
        data: {
          labels: (payload.topServices || []).map(([name]) => name),
          datasets: [
            {
              label: "عدد العمليات",
              data: (payload.topServices || []).map(([, count]) => count),
              backgroundColor: "rgba(232,101,42,.75)",
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: "rgba(255,255,255,.05)" } },
            y: { grid: { display: false } },
          },
        },
      });

      if (state.dayChart) state.dayChart.destroy();
      state.dayChart = new Chart(els.dailyChart, {
        type: "line",
        data: {
          labels: (payload.dailyTotals || []).map((_, index) => index + 1),
          datasets: [
            {
              label: "الدخل اليومي (ريال)",
              data: payload.dailyTotals || [],
              borderColor: "rgba(74,184,193,.9)",
              backgroundColor: "rgba(74,184,193,.08)",
              fill: true,
              tension: 0.4,
              pointBackgroundColor: "rgba(74,184,193,1)",
              pointRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: "rgba(255,255,255,.05)" } },
            y: { grid: { color: "rgba(255,255,255,.05)" }, beginAtZero: true },
          },
        },
      });

      els.teamsRanking.innerHTML =
        (payload.teamsRanking || [])
          .map(
            (item, index) => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <div style="font-size:22px;width:32px;text-align:center;">${["🥇", "🥈", "🥉"][index] || "🏅"}</div>
                <div style="flex:1">
                  <div style="font-size:14px;font-weight:700">${CleanTime.escapeHtml(item.name)}</div>
                  <div style="font-size:12px;color:var(--text-muted)">${item.count} فاتورة</div>
                </div>
                <div style="font-size:18px;font-weight:900;color:var(--orange)">${CleanTime.formatShortCurrency(item.total)}</div>
              </div>
            `
          )
          .join("") || '<div style="color:var(--text-muted);text-align:center;padding:20px;">لا توجد بيانات</div>';

      els.teamExpensesRanking.innerHTML =
        (payload.teamExpensesRanking || [])
          .map(
            (item) => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                <div style="font-size:20px;width:32px;text-align:center;">⛽</div>
                <div style="flex:1">
                  <div style="font-size:14px;font-weight:700">${CleanTime.escapeHtml(item.teamName)}</div>
                  <div style="font-size:12px;color:var(--text-muted)">${item.count} مصروف</div>
                </div>
                <div style="font-size:18px;font-weight:900;color:var(--orange)">${CleanTime.formatCurrency(item.total)}</div>
              </div>
            `
          )
          .join("") || '<div style="color:var(--text-muted);text-align:center;padding:20px;">لا توجد مصروفات خاصة بعد</div>';
    };

    ctx.loadReports = async function loadReports() {
      ctx.setChartDefaults();
      const payload = await CleanTime.apiRequest("/api/reports");
      ctx.renderReports(payload);
    };
  };
})();
