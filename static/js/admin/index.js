document.addEventListener("DOMContentLoaded", async () => {
  const state = {
    currentUser: null,
    services: {},
    teams: {},
    activePage: "dashboard",
    dashPeriod: "today",
    teamPeriod: "today",
    orders: [],
    invoices: [],
    expenses: [],
    generalExpenses: [],
    privateExpenses: [],
    expenseEntries: new Map(),
    ordersMap: new Map(),
    editOrderAllowsItemEdit: true,
    payChart: null,
    svcChart: null,
    dayChart: null,
  };

  const els = {
    sidebar: document.getElementById("sidebar"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    sideUserName: document.getElementById("sideUserName"),
    topDate: document.getElementById("topDate"),
    pageTitle: document.getElementById("pageTitle"),
    navItems: Array.from(document.querySelectorAll("[data-page]")),
    sections: Array.from(document.querySelectorAll(".page-section")),
    hamburgerBtn: document.getElementById("hamburgerBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    dashStats: document.getElementById("dashStats"),
    dashRecentBody: document.getElementById("dashRecentBody"),
    dashPeriodTabs: Array.from(document.querySelectorAll("[data-dash-period]")),
    teamsPeriodTabs: Array.from(document.querySelectorAll("[data-team-period]")),
    teamsContent: document.getElementById("teamsContent"),
    filterTeam: document.getElementById("filterTeam"),
    filterService: document.getElementById("filterService"),
    filterPayment: document.getElementById("filterPayment"),
    filterDateFrom: document.getElementById("filterDateFrom"),
    filterDateTo: document.getElementById("filterDateTo"),
    clearOrdersFilterBtn: document.getElementById("clearOrdersFilterBtn"),
    exportOrdersBtn: document.getElementById("exportOrdersBtn"),
    ordersCount: document.getElementById("ordersCount"),
    ordersBody: document.getElementById("ordersBody"),
    searchInv: document.getElementById("searchInv"),
    filterInvTeam: document.getElementById("filterInvTeam"),
    filterInvDateFrom: document.getElementById("filterInvDateFrom"),
    filterInvDateTo: document.getElementById("filterInvDateTo"),
    clearInvoicesFilterBtn: document.getElementById("clearInvoicesFilterBtn"),
    exportInvoicesBtn: document.getElementById("exportInvoicesBtn"),
    invoiceScopeBar: document.getElementById("invoiceScopeBar"),
    invoiceScopeText: document.getElementById("invoiceScopeText"),
    invoiceScopeSub: document.getElementById("invoiceScopeSub"),
    invoiceScopeClearBtn: document.getElementById("invoiceScopeClearBtn"),
    invoicesContent: document.getElementById("invoicesContent"),
    expenseType: document.getElementById("expenseType"),
    expenseTeamWrap: document.getElementById("expenseTeamWrap"),
    expenseTeam: document.getElementById("expenseTeam"),
    expenseTitle: document.getElementById("expenseTitle"),
    expenseAmount: document.getElementById("expenseAmount"),
    addExpenseBtn: document.getElementById("addExpenseBtn"),
    expenseAlert: document.getElementById("expenseAlert"),
    expensesCount: document.getElementById("expensesCount"),
    expensesBody: document.getElementById("expensesBody"),
    expensesGeneralTotal: document.getElementById("expensesGeneralTotal"),
    expensesPrivateTotal: document.getElementById("expensesPrivateTotal"),
    expensesTotal: document.getElementById("expensesTotal"),
    reportStats: document.getElementById("reportStats"),
    teamsRanking: document.getElementById("teamsRanking"),
    teamExpensesRanking: document.getElementById("teamExpensesRanking"),
    editModal: document.getElementById("editModal"),
    editOrderId: document.getElementById("editOrderId"),
    editItemsNotice: document.getElementById("editItemsNotice"),
    editService: document.getElementById("editService"),
    editQty: document.getElementById("editQty"),
    editUnitPrice: document.getElementById("editUnitPrice"),
    editDiscount: document.getElementById("editDiscount"),
    editPhone: document.getElementById("editPhone"),
    editPayment: document.getElementById("editPayment"),
    editMixedWrap: document.getElementById("editMixedWrap"),
    editCashAmount: document.getElementById("editCashAmount"),
    editNotes: document.getElementById("editNotes"),
    editAdminNote: document.getElementById("editAdminNote"),
    editTotal: document.getElementById("editTotal"),
    closeEditModalBtn: document.getElementById("closeEditModalBtn"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
    saveEditBtn: document.getElementById("saveEditBtn"),
    paymentChart: document.getElementById("paymentChart"),
    servicesChart: document.getElementById("servicesChart"),
    dailyChart: document.getElementById("dailyChart"),
  };

  const ctx = { state, els };
  window.CleanTimeAdmin.setupCore(ctx);
  window.CleanTimeAdmin.setupDashboard(ctx);
  window.CleanTimeAdmin.setupExpenses(ctx);
  window.CleanTimeAdmin.setupOrders(ctx);
  window.CleanTimeAdmin.setupReports(ctx);

  ctx.refreshCurrentPage = async function refreshCurrentPage() {
    if (state.activePage === "dashboard") {
      await ctx.loadDashboard();
      return;
    }
    if (state.activePage === "teams") {
      await ctx.loadTeams();
      return;
    }
    if (state.activePage === "orders") {
      await ctx.loadOrders();
      return;
    }
    if (state.activePage === "invoices") {
      await ctx.loadInvoices();
      return;
    }
    if (state.activePage === "expenses") {
      await ctx.loadExpenses();
      return;
    }
    if (state.activePage === "reports") {
      await ctx.loadReports();
    }
  };

  els.navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const page = item.dataset.page || "dashboard";
      ctx.setActiveNav(page);
      void ctx.refreshCurrentPage();
    });
  });

  els.hamburgerBtn.addEventListener("click", ctx.toggleSidebar);
  els.sidebarOverlay.addEventListener("click", ctx.closeSidebar);
  els.refreshBtn.addEventListener("click", () => void ctx.refreshCurrentPage());
  els.dashPeriodTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.dashPeriod = tab.dataset.dashPeriod || "today";
      els.dashPeriodTabs.forEach((item) => item.classList.toggle("active", item === tab));
      void ctx.loadDashboard();
    });
  });
  els.teamsPeriodTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.teamPeriod = tab.dataset.teamPeriod || "today";
      els.teamsPeriodTabs.forEach((item) => item.classList.toggle("active", item === tab));
      void ctx.loadTeams();
    });
  });

  [els.filterTeam, els.filterService, els.filterPayment, els.filterDateFrom, els.filterDateTo].forEach((input) => {
    input.addEventListener("change", () => void ctx.loadOrders());
  });
  els.clearOrdersFilterBtn.addEventListener("click", ctx.clearOrdersFilter);
  els.exportOrdersBtn.addEventListener("click", () => {
    CleanTime.exportOrdersToCsv(state.orders, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  [els.filterInvDateFrom, els.filterInvDateTo].forEach((input) => {
    input.addEventListener("change", () => void ctx.loadInvoices());
  });
  els.filterInvTeam.addEventListener("change", () => void ctx.loadInvoices());
  els.searchInv.addEventListener("input", () => void ctx.loadInvoices());
  els.clearInvoicesFilterBtn.addEventListener("click", ctx.clearInvoicesFilter);
  els.exportInvoicesBtn.addEventListener("click", () => {
    CleanTime.exportOrdersToCsv(state.invoices, `invoices-${new Date().toISOString().slice(0, 10)}.csv`);
  });
  els.invoiceScopeClearBtn.addEventListener("click", ctx.clearInvoicesFilter);

  els.expenseType.addEventListener("change", ctx.updateExpenseTypeUI);
  els.addExpenseBtn.addEventListener("click", () => void ctx.addExpense());
  [els.expenseTitle, els.expenseAmount].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void ctx.addExpense();
      }
    });
  });

  els.ordersBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const order = state.ordersMap.get(String(id));
    if (!order) return;
    const action = button.dataset.action;
    if (action === "print-order") CleanTime.printInvoice(order);
    if (action === "save-order-pdf") {
      const previousLabel = button.textContent;
      button.disabled = true;
      button.textContent = "PDF...";
      void CleanTime.downloadInvoicePdf(order)
        .catch((error) => {
          window.alert(error.message || "تعذر إنشاء ملف PDF");
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = previousLabel;
        });
    }
    if (action === "share-order-pdf") {
      const previousLabel = button.textContent;
      button.disabled = true;
      button.textContent = "واتس...";
      void CleanTime.shareInvoicePdf(order)
        .catch((error) => {
          if (error?.name !== "AbortError") {
            window.alert(error.message || "تعذر مشاركة ملف PDF");
          }
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = previousLabel;
        });
    }
    if (action === "edit-order") ctx.openEditModal(id);
    if (action === "delete-order") void ctx.deleteOrder(id);
  });

  els.invoicesContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const order = state.ordersMap.get(String(id));
    const action = button.dataset.action;
    if (action === "print-order" && order) CleanTime.printInvoice(order);
    if (action === "save-order-pdf" && order) {
      const previousLabel = button.textContent;
      button.disabled = true;
      button.textContent = "جاري تجهيز PDF...";
      void CleanTime.downloadInvoicePdf(order)
        .catch((error) => {
          window.alert(error.message || "تعذر إنشاء ملف PDF");
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = previousLabel;
        });
    }
    if (action === "share-order-pdf" && order) {
      const previousLabel = button.textContent;
      button.disabled = true;
      button.textContent = "جاري تجهيز المشاركة...";
      void CleanTime.shareInvoicePdf(order)
        .catch((error) => {
          if (error?.name !== "AbortError") {
            window.alert(error.message || "تعذر مشاركة ملف PDF");
          }
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = previousLabel;
        });
    }
    if (action === "edit-order" && order) ctx.openEditModal(id);
    if (action === "delete-order" && order) void ctx.deleteOrder(id);
    if (action === "save-note") void ctx.saveAdminNote(id);
  });

  els.teamsContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='open-team-invoices']");
    if (!button) return;
    ctx.openTeamInvoices(button.dataset.team || "");
  });

  els.expensesBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='delete-expense']");
    if (!button) return;
    void ctx.deleteExpense(button.dataset.id, button.dataset.kind);
  });

  els.editService.addEventListener("change", () => {
    const service = state.services[els.editService.value];
    if (service && Number(service.price) > 0) {
      els.editUnitPrice.value = service.price;
    }
    ctx.calcEditTotal();
  });
  [els.editQty, els.editUnitPrice, els.editDiscount, els.editCashAmount].forEach((input) => {
    input.addEventListener("input", ctx.calcEditTotal);
  });
  els.editPayment.addEventListener("change", () => {
    ctx.editPaymentChange();
    ctx.calcEditTotal();
  });
  els.closeEditModalBtn.addEventListener("click", ctx.closeEditModal);
  els.cancelEditBtn.addEventListener("click", ctx.closeEditModal);
  els.saveEditBtn.addEventListener("click", () => void ctx.saveEdit());

  state.currentUser = await CleanTime.ensureRole("admin");
  if (!state.currentUser) {
    return;
  }

  const catalog = await CleanTime.loadCatalog();
  state.services = catalog.services || {};
  state.teams = catalog.teams || {};
  els.sideUserName.textContent = state.currentUser.name;
  els.topDate.textContent = new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  ctx.buildServiceSelects();
  ctx.buildTeamSelects();
  ctx.updateExpenseTypeUI();
  ctx.setActiveNav("dashboard");
  await ctx.loadDashboard();
});
