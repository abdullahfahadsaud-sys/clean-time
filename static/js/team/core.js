(function () {
  const team = (window.CleanTimeTeam = window.CleanTimeTeam || {});

  team.setupCore = function setupCore(ctx) {
    const { state, els } = ctx;

    ctx.showAlert = function showAlert(message, type = "danger") {
      els.formAlert.innerHTML = `<div class="alert alert-${type}">${CleanTime.escapeHtml(message)}</div>`;
    };

    ctx.clearAlert = function clearAlert() {
      els.formAlert.innerHTML = "";
    };

    ctx.closeSidebar = function closeSidebar() {
      els.sidebar.classList.remove("open");
      els.sidebarOverlay.classList.remove("show");
    };

    ctx.toggleSidebar = function toggleSidebar() {
      els.sidebar.classList.toggle("open");
      els.sidebarOverlay.classList.toggle("show");
    };

    ctx.setPage = function setPage(page) {
      state.activePage = page;
      els.pageSections.forEach((section) => {
        section.classList.toggle("active", section.id === `page-${page}`);
      });
      els.navItems.forEach((item) => {
        item.classList.toggle("active", item.dataset.page === page);
      });
      const titles = { "new-order": "عملية جديدة", "my-invoices": "فواتيري" };
      els.pageTitle.textContent = titles[page] || "Clean Time";
      if (page === "my-invoices") {
        void ctx.loadMyInvoices();
      }
      ctx.closeSidebar();
    };

    ctx.currentServiceInfo = function currentServiceInfo() {
      return state.services[els.selectedService.value] || null;
    };

    ctx.serviceHasPriceOptions = function serviceHasPriceOptions(serviceInfo) {
      return Boolean(serviceInfo && Array.isArray(serviceInfo.priceOptions) && serviceInfo.priceOptions.length);
    };

    ctx.serviceUsesAgreedPrice = function serviceUsesAgreedPrice(serviceInfo) {
      return Boolean(serviceInfo && serviceInfo.agreedPrice && serviceInfo.quantityLocked);
    };

    ctx.currentPriceOption = function currentPriceOption(serviceInfo = ctx.currentServiceInfo()) {
      if (!ctx.serviceHasPriceOptions(serviceInfo)) {
        return null;
      }
      const optionIndex = Number(els.priceOption.value || 0);
      return serviceInfo.priceOptions[optionIndex] || serviceInfo.priceOptions[0] || null;
    };

    ctx.setPriceOption = function setPriceOption(optionIndex) {
      const serviceInfo = ctx.currentServiceInfo();
      if (!ctx.serviceHasPriceOptions(serviceInfo)) {
        return;
      }
      const safeIndex = Math.max(0, Math.min(Number(optionIndex || 0), serviceInfo.priceOptions.length - 1));
      els.priceOption.value = String(safeIndex);
      els.priceOptionTabs.querySelectorAll("[data-price-option]").forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.priceOption) === safeIndex);
      });
      ctx.applySelectedPriceOption();
    };

    ctx.findPriceOptionIndex = function findPriceOptionIndex(serviceInfo, unitPrice) {
      if (!ctx.serviceHasPriceOptions(serviceInfo)) {
        return 0;
      }
      const target = Number(unitPrice || 0);
      return Math.max(
        0,
        serviceInfo.priceOptions.findIndex((option) => Number(option.price || 0) === target)
      );
    };

    ctx.getServiceCardPriceLabel = function getServiceCardPriceLabel(info) {
      if (ctx.serviceUsesAgreedPrice(info)) {
        return "سعر متفق عليه";
      }
      if (ctx.serviceHasPriceOptions(info)) {
        return info.priceOptions.map((option) => option.label).join(" / ");
      }
      return Number(info.price) > 0 ? `${info.price} ر/${info.unit}` : "حسب الاتفاق";
    };

    ctx.syncServiceFields = function syncServiceFields(serviceInfo, options = {}) {
      const preservePrice = Boolean(options.preservePrice);
      const priceOptionIndex = Number.isInteger(options.priceOptionIndex) ? options.priceOptionIndex : 0;
      const hasPriceOptions = ctx.serviceHasPriceOptions(serviceInfo);
      const usesAgreedPrice = ctx.serviceUsesAgreedPrice(serviceInfo);

      els.priceOptionGroup.classList.toggle("is-hidden", !hasPriceOptions);
      els.quantityGroup.classList.toggle("is-hidden", usesAgreedPrice);
      els.quantity.disabled = usesAgreedPrice;
      els.unitPrice.readOnly = hasPriceOptions;
      els.unitPriceLabel.textContent = usesAgreedPrice ? "السعر المتفق عليه (ريال)" : "سعر الوحدة (ريال)";
      els.psSubLabel.textContent = usesAgreedPrice ? "السعر المتفق عليه" : "الكمية × سعر الوحدة";

      if (!serviceInfo) {
        els.priceOptionTabs.innerHTML = "";
        els.priceOption.value = "0";
        els.priceOptionLabel.textContent = "اختر السعر المناسب";
        return;
      }

      if (hasPriceOptions) {
        els.priceOptionTabs.innerHTML = serviceInfo.priceOptions
          .map(
            (option, index) =>
              `<button class="pay-tab" type="button" data-price-option="${index}">${CleanTime.escapeHtml(option.label)}</button>`
          )
          .join("");
        els.priceOptionLabel.textContent = "اختر السعر المناسب";
        ctx.setPriceOption(priceOptionIndex);
      } else {
        els.priceOptionTabs.innerHTML = "";
        els.priceOption.value = "0";
      }

      if (usesAgreedPrice) {
        els.quantity.value = "1";
        els.unitLabel.textContent = "(خدمة)";
        els.quantityLabel.textContent = "الكمية";
        els.unitPrice.placeholder = "مثال: 100";
        if (!preservePrice) {
          els.unitPrice.value = "";
        }
        return;
      }

      els.quantity.value = "";
      els.unitLabel.textContent = `(${serviceInfo.unit})`;
      els.quantityLabel.innerHTML = `الكمية <span id="unitLabel" style="color:var(--text-muted)">${CleanTime.escapeHtml(els.unitLabel.textContent)}</span>`;
      els.unitLabel = document.getElementById("unitLabel");
      els.unitPrice.placeholder = "0";

      if (!preservePrice && !hasPriceOptions) {
        els.unitPrice.value = Number(serviceInfo.price || 0).toString();
      }
    };

    ctx.applySelectedPriceOption = function applySelectedPriceOption() {
      const serviceInfo = ctx.currentServiceInfo();
      const option = ctx.currentPriceOption(serviceInfo);
      if (option) {
        els.unitPrice.value = String(Number(option.price || 0));
      }
      ctx.calcCurrentItem();
    };

    ctx.getDraftTotals = function getDraftTotals() {
      return state.draftItems.reduce(
        (totals, item) => {
          totals.subtotal += Number(item.quantity || 0) * Number(item.unitPrice || 0);
          totals.discount += Number(item.discount || 0);
          totals.total += Number(item.totalPrice || 0);
          return totals;
        },
        { subtotal: 0, discount: 0, total: 0 }
      );
    };

    ctx.calcCurrentItem = function calcCurrentItem() {
      const serviceInfo = ctx.currentServiceInfo();
      const usesAgreedPrice = ctx.serviceUsesAgreedPrice(serviceInfo);
      const quantity = usesAgreedPrice ? 1 : Number(els.quantity.value || 0);
      const unitPrice = Number(els.unitPrice.value || 0);
      const discount = Number(els.discount.value || 0);
      const subtotal = quantity * unitPrice;
      const total = Math.max(0, subtotal - discount);
      const hasEnteredAgreedPrice = !usesAgreedPrice || els.unitPrice.value !== "";
      const hasData = Boolean(els.selectedService.value) && quantity > 0 && unitPrice >= 0 && hasEnteredAgreedPrice;

      if (hasData) {
        els.priceSummary.style.display = "block";
        els.psSub.textContent = CleanTime.formatCurrency(subtotal);
        els.psTotal.textContent = CleanTime.formatCurrency(total);
        els.psDiscRow.style.display = discount > 0 ? "flex" : "none";
        els.psDisc.textContent = `- ${CleanTime.formatCurrency(discount)}`;
      } else {
        els.priceSummary.style.display = "none";
      }

      return { quantity, unitPrice, discount, subtotal, total };
    };

    ctx.calcMixed = function calcMixed() {
      if (els.paymentMethod.value !== "مختلط") {
        return;
      }
      const total = ctx.getDraftTotals().total;
      const cashAmount = Math.max(0, Number(els.cashAmount.value || 0));
      const clampedCash = Math.min(cashAmount, total);
      if (String(clampedCash) !== String(cashAmount)) {
        els.cashAmount.value = clampedCash.toFixed(2);
      }
      const remaining = Math.max(0, total - clampedCash);
      els.networkAmount.value = remaining.toFixed(2);
    };

    ctx.setPayment = function setPayment(method) {
      els.paymentMethod.value = method;
      els.paymentTabs.forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.payment === method);
      });
      els.mixedFields.classList.toggle("show", method === "مختلط");
      if (method === "مختلط") {
        ctx.calcMixed();
      } else {
        els.cashAmount.value = "";
        els.networkAmount.value = "";
      }
    };

    ctx.resetItemEditor = function resetItemEditor() {
      document.querySelectorAll(".svc-card").forEach((card) => card.classList.remove("selected"));
      els.selectedService.value = "";
      els.priceOptionTabs.innerHTML = "";
      els.priceOption.value = "0";
      els.priceOptionGroup.classList.add("is-hidden");
      els.quantityGroup.classList.remove("is-hidden");
      els.quantity.disabled = false;
      els.unitPrice.readOnly = false;
      els.unitPriceLabel.textContent = "سعر الوحدة (ريال)";
      els.psSubLabel.textContent = "الكمية × سعر الوحدة";
      els.quantityLabel.innerHTML = 'الكمية <span id="unitLabel" style="color:var(--text-muted)">(وحدة)</span>';
      els.unitLabel = document.getElementById("unitLabel");
      els.quantity.value = "";
      els.unitPrice.value = "";
      els.unitPrice.placeholder = "0";
      els.discount.value = "0";
      els.priceSummary.style.display = "none";
      state.editingItemIndex = null;
      els.addItemBtn.textContent = "➕ إضافة البند للفواتير";
      els.cancelItemEditBtn.style.display = "none";
    };

    ctx.resetForm = function resetForm() {
      ctx.resetItemEditor();
      state.draftItems = [];
      ctx.renderDraftItems();
      els.phone.value = "";
      els.notes.value = "";
      els.cashAmount.value = "";
      els.networkAmount.value = "";
      ctx.clearAlert();
      ctx.setPayment("كاش");
    };

    ctx.buildServiceGrid = function buildServiceGrid() {
      const icons = {
        خداديات: { image: "/static/pillow.png", fallback: "🛏️" },
        موكيت: { image: "/static/mokt.png", fallback: "🪣" },
        كنب: { image: "/static/sofa.png", fallback: "🛋️" },
        "جلسة عربي": { emoji: "🪑" },
        "مكيف دولابي": { image: "/static/air-cooler.png", fallback: "❄️" },
        "مكيف شباك": { image: "/static/air-conditioning.png", fallback: "🌀" },
        "مكيف أسبليت": { image: "/static/air-conditioner.png", fallback: "💨" },
        ستائر: { image: "/static/curtains.png", fallback: "🪟" },
        فله: { emoji: "🏠" },
        مسابح: { image: "/static/swimming-pool.png", fallback: "🏊" },
        أرضيات: { image: "/static/floor.png", fallback: "🏗️" },
        نوافذ: { emoji: "🪟" },
        "خدمات مساجد": { emoji: "🕌" },
        شقة: { emoji: "🏢" },
        "نظافة عامه": { emoji: "🧼" },
      };
      const entries = Object.entries(state.services);
      els.serviceGrid.innerHTML = entries
        .map(([name, info]) => {
          info.name = name;
          const priceLabel = ctx.getServiceCardPriceLabel(info);
          const icon = icons[name] || { emoji: "🧹" };
          const iconMarkup = icon.image
            ? `
                <img
                  class="svc-icon-image"
                  src="${CleanTime.escapeHtml(icon.image)}"
                  alt=""
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';"
                >
                <span class="svc-icon-fallback" style="display:none;">${CleanTime.escapeHtml(icon.fallback || "🧹")}</span>
              `
            : `<span class="svc-icon-fallback">${CleanTime.escapeHtml(icon.emoji || "🧹")}</span>`;
          return `
            <button type="button" class="svc-card" data-service="${CleanTime.escapeHtml(name)}">
              <div class="svc-icon">${iconMarkup}</div>
              <div class="svc-name">${CleanTime.escapeHtml(name)}</div>
              <div class="svc-price">${CleanTime.escapeHtml(priceLabel)}</div>
            </button>
          `;
        })
        .join("");
    };

    ctx.selectService = function selectService(name) {
      const info = state.services[name];
      if (!info) return;
      info.name = name;
      els.selectedService.value = name;
      ctx.syncServiceFields(info);
      document.querySelectorAll(".svc-card").forEach((card) => {
        card.classList.toggle("selected", card.dataset.service === name);
      });
      ctx.calcCurrentItem();
    };

    ctx.buildDraftItemFromForm = function buildDraftItemFromForm() {
      const service = els.selectedService.value;
      const serviceInfo = ctx.currentServiceInfo();
      const usesAgreedPrice = ctx.serviceUsesAgreedPrice(serviceInfo);
      const currentOption = ctx.currentPriceOption(serviceInfo);
      const { quantity, unitPrice, discount, total } = ctx.calcCurrentItem();

      if (!service || !serviceInfo) {
        throw new Error("الرجاء اختيار نوع الخدمة");
      }
      if (usesAgreedPrice && els.unitPrice.value === "") {
        throw new Error("الرجاء إدخال السعر المتفق عليه");
      }
      if (!usesAgreedPrice && (!quantity || quantity <= 0)) {
        throw new Error("الرجاء إدخال الكمية");
      }
      if (unitPrice < 0) {
        throw new Error("سعر الوحدة غير صالح");
      }
      if (ctx.serviceHasPriceOptions(serviceInfo) && !currentOption) {
        throw new Error("الرجاء اختيار السعر المناسب");
      }
      if (discount < 0) {
        throw new Error("الخصم غير صالح");
      }
      if (total < 0) {
        throw new Error("إجمالي البند غير صالح");
      }

      return {
        serviceType: service,
        unit: serviceInfo.unit,
        quantity,
        unitPrice,
        discount,
        quantityLocked: usesAgreedPrice,
        priceOptionLabel: currentOption ? currentOption.label : "",
        totalPrice: total,
      };
    };
  };
})();
