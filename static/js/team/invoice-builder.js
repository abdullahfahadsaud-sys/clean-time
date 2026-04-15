(function () {
  const team = (window.CleanTimeTeam = window.CleanTimeTeam || {});

  team.setupInvoiceBuilder = function setupInvoiceBuilder(ctx) {
    const { state, els } = ctx;

    ctx.renderInvoiceSummary = function renderInvoiceSummary() {
      const totals = ctx.getDraftTotals();
      if (!state.draftItems.length) {
        els.invoiceSummary.style.display = "none";
        if (els.paymentMethod.value === "مختلط") {
          els.networkAmount.value = "0.00";
        }
        return;
      }
      els.invoiceSummary.style.display = "block";
      els.invSub.textContent = CleanTime.formatCurrency(totals.subtotal);
      els.invDisc.textContent = `- ${CleanTime.formatCurrency(totals.discount)}`;
      els.invDiscRow.style.display = totals.discount > 0 ? "flex" : "none";
      els.invTotal.textContent = CleanTime.formatCurrency(totals.total);
      ctx.calcMixed();
    };

    ctx.renderDraftItems = function renderDraftItems() {
      els.draftItemsCount.textContent = state.draftItems.length ? `${state.draftItems.length} بند` : "";

      if (!state.draftItems.length) {
        els.draftItemsList.className = "draft-empty";
        els.draftItemsList.innerHTML = "أضف بندًا واحدًا على الأقل قبل إصدار الفاتورة";
        ctx.renderInvoiceSummary();
        return;
      }

      els.draftItemsList.className = "";
      els.draftItemsList.innerHTML = state.draftItems
        .map(
          (item, index) => {
            const quantityLine = item.quantityLocked
              ? `السعر المتفق عليه: ${CleanTime.formatCurrency(item.unitPrice)}`
              : `الكمية: ${CleanTime.escapeHtml(String(item.quantity))} ${CleanTime.escapeHtml(item.unit)}<br>سعر الوحدة: ${CleanTime.formatCurrency(item.unitPrice)}`;
            const optionLine = item.priceOptionLabel ? `<br>الخيار: ${CleanTime.escapeHtml(item.priceOptionLabel)}` : "";
            return `
              <div class="draft-item-card">
                <div class="draft-item-main">
                  <div class="draft-item-title">${CleanTime.escapeHtml(item.serviceType)}</div>
                  <div class="draft-item-meta">
                    ${quantityLine}
                    ${optionLine}
                    ${Number(item.discount || 0) > 0 ? `<br>الخصم: - ${CleanTime.formatCurrency(item.discount)}` : ""}
                  </div>
                </div>
                <div class="draft-item-side">
                  <div class="draft-item-total">${CleanTime.formatCurrency(item.totalPrice)}</div>
                  <div class="draft-item-btns">
                    <button class="btn btn-ghost btn-sm" type="button" data-action="edit-draft-item" data-index="${index}">✏️ تعديل</button>
                    <button class="btn-danger" type="button" data-action="remove-draft-item" data-index="${index}">🗑️ حذف</button>
                  </div>
                </div>
              </div>
            `;
          }
        )
        .join("");

      ctx.renderInvoiceSummary();
    };

    ctx.addOrUpdateDraftItem = function addOrUpdateDraftItem() {
      ctx.clearAlert();
      try {
        const item = ctx.buildDraftItemFromForm();
        if (state.editingItemIndex === null) {
          state.draftItems.push(item);
        } else {
          state.draftItems[state.editingItemIndex] = item;
        }
        ctx.renderDraftItems();
        ctx.resetItemEditor();
      } catch (error) {
        ctx.showAlert(error.message || "تعذر إضافة البند");
      }
    };

    ctx.loadDraftItem = function loadDraftItem(index) {
      const item = state.draftItems[index];
      if (!item) return;
      state.editingItemIndex = index;
      ctx.selectService(item.serviceType);
      const serviceInfo = ctx.currentServiceInfo();
      if (ctx.serviceHasPriceOptions(serviceInfo)) {
        const optionIndex = ctx.findPriceOptionIndex(serviceInfo, item.unitPrice);
        els.priceOption.value = String(optionIndex);
        ctx.applySelectedPriceOption();
      }
      els.quantity.value = item.quantityLocked ? "1" : item.quantity;
      els.unitPrice.value = item.unitPrice;
      els.discount.value = item.discount || 0;
      ctx.calcCurrentItem();
      els.addItemBtn.textContent = "💾 تحديث البند";
      els.cancelItemEditBtn.style.display = "inline-flex";
      ctx.clearAlert();
    };

    ctx.removeDraftItem = function removeDraftItem(index) {
      state.draftItems.splice(index, 1);
      if (state.editingItemIndex === index) {
        ctx.resetItemEditor();
      } else if (state.editingItemIndex !== null && state.editingItemIndex > index) {
        state.editingItemIndex -= 1;
      }
      ctx.renderDraftItems();
    };

    ctx.submitOrder = async function submitOrder() {
      ctx.clearAlert();
      if (!state.draftItems.length) {
        ctx.showAlert("أضف خدمة واحدة على الأقل قبل إصدار الفاتورة");
        return;
      }

      const paymentMethod = els.paymentMethod.value;
      const customerPhone = els.phone.value.trim();
      const notes = els.notes.value.trim();
      const invoiceTotal = ctx.getDraftTotals().total;

      if (!customerPhone) {
        ctx.showAlert("الرجاء إدخال رقم الجوال");
        return;
      }
      if (paymentMethod === "مختلط") {
        const cashAmount = Number(els.cashAmount.value || 0);
        if (cashAmount < 0 || cashAmount > invoiceTotal) {
          ctx.showAlert("مبلغ الكاش في الدفع المختلط غير صالح");
          return;
        }
      }

      els.submitOrderBtn.disabled = true;
      els.submitOrderBtn.textContent = "جاري إصدار الفاتورة...";
      try {
        const response = await CleanTime.apiRequest("/api/orders", {
          method: "POST",
          body: {
            items: state.draftItems.map((item) => ({
              serviceType: item.serviceType,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
            })),
            customerPhone,
            paymentMethod,
            cashAmount: Number(els.cashAmount.value || 0),
            notes,
          },
        });
        state.lastOrder = response.order;
        const discountTotal = CleanTime.getOrderDiscountTotal(response.order);
        els.modalInvNum.textContent = response.order.invoiceNumber;
        els.modalInvTotal.textContent = `الإجمالي: ${CleanTime.formatCurrency(response.order.totalPrice)}`;
        els.modalInvDiscount.textContent = `إجمالي الخصم: - ${CleanTime.formatCurrency(discountTotal)}`;
        els.modalInvDiscount.style.display = discountTotal > 0 ? "block" : "none";
        CleanTime.playSuccessSound();
        els.successModal.classList.add("open");
        ctx.resetForm();
      } catch (error) {
        ctx.showAlert(error.message || "تعذر حفظ الفاتورة");
      } finally {
        els.submitOrderBtn.disabled = false;
        els.submitOrderBtn.textContent = "إصدار الفاتورة";
      }
    };
  };
})();
