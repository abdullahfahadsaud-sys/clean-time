document.addEventListener("DOMContentLoaded", async () => {
  const state = {
    currentUser: null,
    services: {},
    lastOrder: null,
    invoices: new Map(),
    activePage: "new-order",
    draftItems: [],
    editingItemIndex: null,
  };

  const els = {
    sidebar: document.getElementById("sidebar"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    sideUserName: document.getElementById("sideUserName"),
    topDate: document.getElementById("topDate"),
    pageTitle: document.getElementById("pageTitle"),
    navItems: Array.from(document.querySelectorAll("[data-page]")),
    pageSections: Array.from(document.querySelectorAll(".page-section")),
    hamburger: document.getElementById("hamburgerBtn"),
    serviceGrid: document.getElementById("serviceGrid"),
    selectedService: document.getElementById("selectedService"),
    priceOptionGroup: document.getElementById("priceOptionGroup"),
    priceOptionLabel: document.getElementById("priceOptionLabel"),
    priceOptionTabs: document.getElementById("priceOptionTabs"),
    priceOption: document.getElementById("priceOption"),
    quantityGroup: document.getElementById("quantityGroup"),
    quantityLabel: document.getElementById("quantityLabel"),
    unitLabel: document.getElementById("unitLabel"),
    unitPriceLabel: document.getElementById("unitPriceLabel"),
    quantity: document.getElementById("quantity"),
    unitPrice: document.getElementById("unitPrice"),
    discount: document.getElementById("discount"),
    addItemBtn: document.getElementById("addItemBtn"),
    cancelItemEditBtn: document.getElementById("cancelItemEditBtn"),
    draftItemsList: document.getElementById("draftItemsList"),
    draftItemsCount: document.getElementById("draftItemsCount"),
    phone: document.getElementById("phone"),
    paymentMethod: document.getElementById("paymentMethod"),
    paymentTabs: Array.from(document.querySelectorAll("[data-payment]")),
    mixedFields: document.getElementById("mixedFields"),
    cashAmount: document.getElementById("cashAmount"),
    networkAmount: document.getElementById("networkAmount"),
    priceSummary: document.getElementById("priceSummary"),
    psSubLabel: document.getElementById("psSubLabel"),
    psSub: document.getElementById("ps-sub"),
    psDiscRow: document.getElementById("ps-disc-row"),
    psDisc: document.getElementById("ps-disc"),
    psTotal: document.getElementById("ps-total"),
    invoiceSummary: document.getElementById("invoiceSummary"),
    invSub: document.getElementById("inv-sub"),
    invDiscRow: document.getElementById("inv-disc-row"),
    invDisc: document.getElementById("inv-disc"),
    invTotal: document.getElementById("inv-total"),
    notes: document.getElementById("notes"),
    formAlert: document.getElementById("formAlert"),
    submitOrderBtn: document.getElementById("submitOrderBtn"),
    resetFormBtn: document.getElementById("resetFormBtn"),
    invoicesList: document.getElementById("invoicesList"),
    invCount: document.getElementById("invCount"),
    successModal: document.getElementById("successModal"),
    modalInvNum: document.getElementById("modalInvNum"),
    modalInvTotal: document.getElementById("modalInvTotal"),
    modalInvDiscount: document.getElementById("modalInvDiscount"),
    modalCloseBtn: document.getElementById("modalCloseBtn"),
    modalDismissBtn: document.getElementById("modalDismissBtn"),
    modalPrintBtn: document.getElementById("modalPrintBtn"),
  };

  const ctx = { state, els };
  window.CleanTimeTeam.setupCore(ctx);
  window.CleanTimeTeam.setupInvoiceBuilder(ctx);
  window.CleanTimeTeam.setupInvoices(ctx);

  els.navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      ctx.setPage(item.dataset.page);
    });
  });

  els.hamburger.addEventListener("click", ctx.toggleSidebar);
  els.sidebarOverlay.addEventListener("click", ctx.closeSidebar);
  els.addItemBtn.addEventListener("click", ctx.addOrUpdateDraftItem);
  els.cancelItemEditBtn.addEventListener("click", ctx.resetItemEditor);
  els.submitOrderBtn.addEventListener("click", () => void ctx.submitOrder());
  els.resetFormBtn.addEventListener("click", ctx.resetForm);
  els.modalCloseBtn.addEventListener("click", ctx.closeModal);
  els.modalDismissBtn.addEventListener("click", ctx.closeModal);
  els.modalPrintBtn.addEventListener("click", () => {
    if (state.lastOrder) {
      CleanTime.printInvoice(state.lastOrder);
    }
  });

  els.serviceGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".svc-card");
    if (!card) return;
    ctx.selectService(card.dataset.service || "");
  });
  els.priceOptionTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-price-option]");
    if (!button) return;
    ctx.setPriceOption(Number(button.dataset.priceOption || 0));
  });

  els.paymentTabs.forEach((tab) => {
    tab.addEventListener("click", () => ctx.setPayment(tab.dataset.payment || "كاش"));
  });

  [els.quantity, els.unitPrice, els.discount].forEach((input) => {
    input.addEventListener("input", ctx.calcCurrentItem);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ctx.addOrUpdateDraftItem();
      }
    });
  });
  els.cashAmount.addEventListener("input", ctx.calcMixed);

  els.draftItemsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const index = Number(button.dataset.index);
    if (!Number.isInteger(index)) return;
    if (button.dataset.action === "edit-draft-item") ctx.loadDraftItem(index);
    if (button.dataset.action === "remove-draft-item") ctx.removeDraftItem(index);
  });

  els.invoicesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-print-id]");
    if (!button) return;
    const order = state.invoices.get(button.dataset.printId || "");
    if (order) {
      CleanTime.printInvoice(order);
    }
  });

  state.currentUser = await CleanTime.ensureRole("team");
  if (!state.currentUser) {
    return;
  }

  const catalog = await CleanTime.loadCatalog();
  state.services = catalog.services || {};
  els.sideUserName.textContent = state.currentUser.name;
  els.topDate.textContent = new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  ctx.buildServiceGrid();
  ctx.resetForm();
});
