(function () {
  const admin = (window.CleanTimeAdmin = window.CleanTimeAdmin || {});

  admin.setupDashboard = function setupDashboard(ctx) {
    const { els } = ctx;

    ctx.renderDashboardCards = function renderDashboardCards(stats) {
      els.dashStats.innerHTML = `
        <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${Number(stats.total || 0).toFixed(0)}</div><div class="stat-label">إجمالي الدخل (ريال)</div></div>
        <div class="stat-card orange"><div class="stat-icon">💵</div><div class="stat-value">${Number(stats.cash || 0).toFixed(0)}</div><div class="stat-label">إجمالي الكاش</div></div>
        <div class="stat-card"><div class="stat-icon">💳</div><div class="stat-value">${Number(stats.network || 0).toFixed(0)}</div><div class="stat-label">إجمالي الشبكة</div></div>
        <div class="stat-card green"><div class="stat-icon">🏦</div><div class="stat-value">${Number(stats.transfer || 0).toFixed(0)}</div><div class="stat-label">إجمالي التحويل</div></div>
        <div class="stat-card"><div class="stat-icon">📋</div><div class="stat-value">${stats.count || 0}</div><div class="stat-label">عدد العمليات</div></div>
      `;
    };

    ctx.renderRecentOrders = function renderRecentOrders(orders) {
      if (!orders.length) {
        els.dashRecentBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">لا توجد عمليات بعد</td></tr>';
        return;
      }
      els.dashRecentBody.innerHTML = orders
        .map((order) => `
          <tr>
            <td style="color:var(--teal);font-weight:700">${CleanTime.escapeHtml(order.invoiceNumber)}</td>
            <td>${CleanTime.escapeHtml(order.teamName)}</td>
            <td>${CleanTime.escapeHtml(ctx.renderOrderServices(order))}</td>
            <td>${CleanTime.escapeHtml(ctx.renderOrderQuantity(order))}</td>
            <td style="font-weight:700;color:var(--orange)">${CleanTime.formatCurrency(order.totalPrice)}</td>
            <td>${CleanTime.paymentBadge(order.paymentMethod)}</td>
            <td style="color:var(--text-muted);font-size:12px">${CleanTime.escapeHtml(CleanTime.formatDate(order.date))}</td>
          </tr>
        `)
        .join("");
    };

    ctx.loadDashboard = async function loadDashboard() {
      const data = await CleanTime.apiRequest(`/api/stats/dashboard?period=${ctx.state.dashPeriod}`);
      ctx.renderDashboardCards(data.stats || {});
      ctx.renderRecentOrders(data.recentOrders || []);
    };

    ctx.loadTeams = async function loadTeams() {
      const data = await CleanTime.apiRequest(`/api/stats/teams?period=${ctx.state.teamPeriod}`);
      els.teamsContent.innerHTML = (data.teams || [])
        .map((team, index) => `
          <div class="team-row">
            <div class="team-avatar">${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][index] || "👷"}</div>
            <div class="team-info">
              <div class="team-name">${CleanTime.escapeHtml(team.name)}</div>
              <div class="team-stats">
                <div class="ts">فواتير <span>${team.stats.count}</span></div>
                <div class="ts">أمتار <span>${Number(team.meters || 0).toFixed(1)}</span></div>
                <div class="ts">كاش <span>${CleanTime.formatShortCurrency(team.stats.cash)}</span></div>
                <div class="ts">شبكة/تحويل <span>${CleanTime.formatShortCurrency(Number(team.stats.network || 0) + Number(team.stats.transfer || 0))}</span></div>
              </div>
            </div>
            <div class="team-actions">
              <div class="team-total">${CleanTime.formatShortCurrency(team.stats.total)}</div>
              <button type="button" class="team-link-btn" data-action="open-team-invoices" data-team="${CleanTime.escapeHtml(team.username)}">عرض الفواتير</button>
            </div>
          </div>
        `)
        .join("");
    };
  };
})();
