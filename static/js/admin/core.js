(function () {
  const admin = (window.CleanTimeAdmin = window.CleanTimeAdmin || {});

  admin.setupCore = function setupCore(ctx) {
    const { state, els } = ctx;

    ctx.closeSidebar = function closeSidebar() {
      els.sidebar.classList.remove("open");
      els.sidebarOverlay.classList.remove("show");
    };

    ctx.toggleSidebar = function toggleSidebar() {
      els.sidebar.classList.toggle("open");
      els.sidebarOverlay.classList.toggle("show");
    };

    ctx.setActiveNav = function setActiveNav(page) {
      state.activePage = page;
      els.navItems.forEach((item) => {
        item.classList.toggle("active", item.dataset.page === page);
      });
      els.sections.forEach((section) => {
        section.classList.toggle("active", section.id === `page-${page}`);
      });
      const titles = {
        dashboard: "لوحة التحكم",
        teams: "إحصائيات الفرق",
        orders: "جميع العمليات",
        invoices: "الفواتير",
        expenses: "المصروفات",
        reports: "التقارير",
      };
      els.pageTitle.textContent = titles[page] || "Clean Time";
      ctx.closeSidebar();
    };

    ctx.buildServiceSelects = function buildServiceSelects() {
      const options = Object.keys(state.services)
        .map((service) => `<option value="${CleanTime.escapeHtml(service)}">${CleanTime.escapeHtml(service)}</option>`)
        .join("");
      els.filterService.innerHTML = `<option value="">جميع الخدمات</option>${options}`;
      els.editService.innerHTML = options;
    };

    ctx.buildTeamSelects = function buildTeamSelects() {
      const teamEntries = Object.entries(state.teams);
      const options = teamEntries
        .map(([username, name]) => `<option value="${CleanTime.escapeHtml(username)}">${CleanTime.escapeHtml(name)}</option>`)
        .join("");
      els.filterTeam.innerHTML = `<option value="">جميع الفرق</option>${options}`;
      els.filterInvTeam.innerHTML = `<option value="">جميع الفرق</option>${options}`;
      els.expenseTeam.innerHTML = `<option value="">${teamEntries.length ? "اختر الفريق" : "لا توجد فرق متاحة"}</option>${options}`;
      els.expenseTeam.disabled = teamEntries.length === 0;
    };

    ctx.renderOrderServices = function renderOrderServices(order) {
      return CleanTime.getOrderServicesSummary(order);
    };

    ctx.renderOrderQuantity = function renderOrderQuantity(order) {
      return CleanTime.getOrderQuantitySummary(order);
    };

    ctx.renderOrderItemsDetails = function renderOrderItemsDetails(order) {
      return CleanTime.getOrderItems(order)
        .map(
          (item, index) => `
            <div class="inv-field" style="grid-column:1/-1">
              <div class="key">البند ${index + 1}</div>
              <div class="val">
                ${CleanTime.escapeHtml(item.serviceType)} — ${CleanTime.escapeHtml(String(item.quantity))} ${CleanTime.escapeHtml(item.unit)}
                — ${CleanTime.formatCurrency(item.unitPrice)}
                ${Number(item.discount || 0) > 0 ? ` — خصم ${CleanTime.formatCurrency(item.discount)}` : ""}
                — الإجمالي ${CleanTime.formatCurrency(item.totalPrice)}
              </div>
            </div>
          `
        )
        .join("");
    };

    ctx.setEditItemFieldsLocked = function setEditItemFieldsLocked(order) {
      state.editOrderAllowsItemEdit = Number(order.itemCount || 0) <= 1;
      [els.editService, els.editQty, els.editUnitPrice, els.editDiscount].forEach((input) => {
        input.disabled = !state.editOrderAllowsItemEdit;
      });

      if (state.editOrderAllowsItemEdit) {
        els.editItemsNotice.style.display = "none";
        els.editItemsNotice.textContent = "";
        els.editService.value = order.items?.[0]?.serviceType || order.serviceType;
        els.editQty.value = order.items?.[0]?.quantity ?? order.quantity;
        els.editUnitPrice.value = order.items?.[0]?.unitPrice ?? order.unitPrice;
        els.editDiscount.value = order.items?.[0]?.discount ?? (order.discount || 0);
        return;
      }

      els.editItemsNotice.style.display = "block";
      els.editItemsNotice.textContent = `هذه الفاتورة تحتوي ${order.itemCount} بنود: ${ctx.renderOrderServices(order)}. يمكنك من هذه النافذة تعديل الجوال والدفع والملاحظات فقط.`;
      els.editService.value = "";
      els.editQty.value = "";
      els.editUnitPrice.value = "";
      els.editDiscount.value = CleanTime.getOrderDiscountTotal(order).toFixed(2);
    };

    ctx.currentOrdersQuery = function currentOrdersQuery() {
      const params = new URLSearchParams();
      if (els.filterTeam.value) params.set("team", els.filterTeam.value);
      if (els.filterService.value) params.set("service", els.filterService.value);
      if (els.filterPayment.value) params.set("payment", els.filterPayment.value);
      if (els.filterDateFrom.value) params.set("dateFrom", els.filterDateFrom.value);
      if (els.filterDateTo.value) params.set("dateTo", els.filterDateTo.value);
      return params;
    };

    ctx.currentInvoicesQuery = function currentInvoicesQuery() {
      const params = new URLSearchParams();
      if (els.filterInvTeam.value) params.set("team", els.filterInvTeam.value);
      if (els.searchInv.value.trim()) params.set("search", els.searchInv.value.trim());
      if (els.filterInvDateFrom.value) params.set("dateFrom", els.filterInvDateFrom.value);
      if (els.filterInvDateTo.value) params.set("dateTo", els.filterInvDateTo.value);
      return params;
    };
  };
})();
