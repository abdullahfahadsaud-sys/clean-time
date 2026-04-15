(function () {
  const team = (window.CleanTimeTeam = window.CleanTimeTeam || {});

  team.setupInvoices = function setupInvoices(ctx) {
    const { state, els } = ctx;

    ctx.loadMyInvoices = async function loadMyInvoices() {
      const data = await CleanTime.apiRequest("/api/orders");
      state.invoices = new Map(data.orders.map((order) => [String(order.id), order]));
      els.invCount.textContent = `إجمالي الفواتير: ${data.orders.length}`;

      if (!data.orders.length) {
        els.invoicesList.innerHTML = `
          <div class="empty-state">
            <div class="emoji">📭</div>
            <p>لا توجد فواتير بعد</p>
          </div>
        `;
        return;
      }

      els.invoicesList.innerHTML = data.orders
        .map((order) => {
          const discountTotal = CleanTime.getOrderDiscountTotal(order);
          return `
            <div class="invoice-card">
              <div class="inv-num-badge">${CleanTime.escapeHtml(order.invoiceNumber)}</div>
              <div class="inv-info">
                <div class="inv-service">${CleanTime.escapeHtml(CleanTime.getOrderServicesSummary(order))}</div>
                <div class="inv-meta">📦 ${CleanTime.escapeHtml(CleanTime.getOrderQuantitySummary(order))} &nbsp;|&nbsp; 📱 ${CleanTime.escapeHtml(order.customerPhone)} &nbsp;|&nbsp; ${CleanTime.escapeHtml(CleanTime.formatDate(order.date))}</div>
                <div style="margin-top:4px">${CleanTime.paymentBadge(order.paymentMethod)}</div>
                ${discountTotal > 0 ? `<div class="inv-meta" style="margin-top:6px;color:var(--orange)">💸 الخصم: - ${CleanTime.formatCurrency(discountTotal)}</div>` : ""}
                ${order.adminNote ? `<div class="inv-meta" style="margin-top:6px;color:var(--orange)">📝 ${CleanTime.escapeHtml(order.adminNote)}</div>` : ""}
              </div>
              <div class="inv-side">
                <div class="inv-price">${CleanTime.formatCurrency(order.totalPrice)}</div>
                <button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-print-id="${order.id}">🖨️</button>
              </div>
            </div>
          `;
        })
        .join("");
    };

    ctx.closeModal = function closeModal() {
      els.successModal.classList.remove("open");
    };
  };
})();
