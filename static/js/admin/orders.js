(function () {
  const admin = (window.CleanTimeAdmin = window.CleanTimeAdmin || {});

  admin.setupOrders = function setupOrders(ctx) {
    const { state, els } = ctx;

    ctx.updateInvoiceScope = function updateInvoiceScope() {
      const selectedTeam = els.filterInvTeam.value;
      if (!selectedTeam) {
        els.invoiceScopeBar.classList.remove("show");
        els.invoiceScopeText.textContent = "";
        els.invoiceScopeSub.textContent = "";
        return;
      }

      const teamName = state.teams[selectedTeam] || selectedTeam;
      els.invoiceScopeBar.classList.add("show");
      els.invoiceScopeText.textContent = `فواتير ${teamName}`;
      els.invoiceScopeSub.textContent = `عدد النتائج الحالية: ${state.invoices.length}`;
    };

    ctx.clearInvoicesFilter = function clearInvoicesFilter() {
      els.filterInvTeam.value = "";
      els.searchInv.value = "";
      els.filterInvDateFrom.value = "";
      els.filterInvDateTo.value = "";
      void ctx.loadInvoices();
    };

    ctx.openTeamInvoices = function openTeamInvoices(teamUsername) {
      if (!teamUsername) return;
      els.filterInvTeam.value = teamUsername;
      els.searchInv.value = "";
      els.filterInvDateFrom.value = "";
      els.filterInvDateTo.value = "";
      ctx.setActiveNav("invoices");
      void ctx.loadInvoices();
    };

    ctx.syncOrdersMap = function syncOrdersMap(list) {
      state.ordersMap = new Map(list.map((order) => [String(order.id), order]));
    };

    ctx.loadOrders = async function loadOrders() {
      const params = ctx.currentOrdersQuery();
      const data = await CleanTime.apiRequest(`/api/orders?${params.toString()}`);
      state.orders = data.orders || [];
      ctx.syncOrdersMap(state.orders);
      els.ordersCount.textContent = `${state.orders.length} عملية`;

      if (!state.orders.length) {
        els.ordersBody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:24px;">لا توجد نتائج</td></tr>';
        return;
      }

      els.ordersBody.innerHTML = state.orders
        .map((order) => `
          <tr>
            <td style="color:var(--teal);font-weight:700;white-space:nowrap">${CleanTime.escapeHtml(order.invoiceNumber)}</td>
            <td>${CleanTime.escapeHtml(order.teamName)}</td>
            <td>${CleanTime.escapeHtml(ctx.renderOrderServices(order))}</td>
            <td>${CleanTime.escapeHtml(ctx.renderOrderQuantity(order))}</td>
            <td style="color:var(--orange)">${CleanTime.getOrderDiscountTotal(order) > 0 ? `- ${CleanTime.formatCurrency(CleanTime.getOrderDiscountTotal(order))}` : "—"}</td>
            <td style="font-weight:700;color:var(--orange)">${CleanTime.formatCurrency(order.totalPrice)}</td>
            <td>${CleanTime.paymentBadge(order.paymentMethod)}</td>
            <td style="direction:ltr">${CleanTime.escapeHtml(order.customerPhone)}</td>
            <td style="color:var(--text-muted);font-size:11px;white-space:nowrap">${CleanTime.escapeHtml(CleanTime.formatDate(order.date))}</td>
            <td>
              <div class="table-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-action="print-order" data-id="${order.id}">🖨️</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="save-order-pdf" data-id="${order.id}">📄</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="share-order-pdf" data-id="${order.id}">🟢</button>
                <button type="button" class="btn-edit" data-action="edit-order" data-id="${order.id}">✏️</button>
                <button type="button" class="btn-danger" data-action="delete-order" data-id="${order.id}">🗑️</button>
              </div>
            </td>
          </tr>
        `)
        .join("");
    };

    ctx.clearOrdersFilter = function clearOrdersFilter() {
      els.filterTeam.value = "";
      els.filterService.value = "";
      els.filterPayment.value = "";
      els.filterDateFrom.value = "";
      els.filterDateTo.value = "";
      void ctx.loadOrders();
    };

    ctx.openEditModal = function openEditModal(orderId) {
      const order = state.ordersMap.get(String(orderId));
      if (!order) return;
      els.editOrderId.value = String(order.id);
      ctx.setEditItemFieldsLocked(order);
      els.editPhone.value = order.customerPhone;
      els.editPayment.value = order.paymentMethod;
      els.editCashAmount.value = order.cashAmount || 0;
      els.editNotes.value = order.notes || "";
      els.editAdminNote.value = order.adminNote || "";
      ctx.editPaymentChange();
      ctx.calcEditTotal();
      els.editModal.classList.add("open");
    };

    ctx.closeEditModal = function closeEditModal() {
      els.editModal.classList.remove("open");
    };

    ctx.editPaymentChange = function editPaymentChange() {
      els.editMixedWrap.style.display = els.editPayment.value === "مختلط" ? "block" : "none";
    };

    ctx.calcEditTotal = function calcEditTotal() {
      const order = state.ordersMap.get(String(els.editOrderId.value));
      const total = state.editOrderAllowsItemEdit
        ? Math.max(0, Number(els.editQty.value || 0) * Number(els.editUnitPrice.value || 0) - Number(els.editDiscount.value || 0))
        : Number(order?.totalPrice || 0);
      els.editTotal.textContent = CleanTime.formatCurrency(total);
      if (els.editPayment.value === "مختلط") {
        const cashAmount = Math.max(0, Number(els.editCashAmount.value || 0));
        els.editCashAmount.value = Math.min(cashAmount, total).toFixed(2);
      }
    };

    ctx.saveEdit = async function saveEdit() {
      const orderId = els.editOrderId.value;
      if (!orderId) return;
      els.saveEditBtn.disabled = true;
      els.saveEditBtn.textContent = "جاري الحفظ...";
      try {
        const body = {
          customerPhone: els.editPhone.value.trim(),
          paymentMethod: els.editPayment.value,
          cashAmount: Number(els.editCashAmount.value || 0),
          notes: els.editNotes.value.trim(),
          adminNote: els.editAdminNote.value.trim(),
        };
        if (state.editOrderAllowsItemEdit) {
          body.serviceType = els.editService.value;
          body.quantity = Number(els.editQty.value || 0);
          body.unitPrice = Number(els.editUnitPrice.value || 0);
          body.discount = Number(els.editDiscount.value || 0);
        }
        const response = await CleanTime.apiRequest(`/api/orders/${orderId}`, {
          method: "PATCH",
          body,
        });
        state.ordersMap.set(String(response.order.id), response.order);
        ctx.closeEditModal();
        await ctx.refreshCurrentPage();
      } catch (error) {
        window.alert(error.message || "تعذر حفظ التعديل");
      } finally {
        els.saveEditBtn.disabled = false;
        els.saveEditBtn.textContent = "حفظ التعديل";
      }
    };

    ctx.deleteOrder = async function deleteOrder(orderId) {
      if (!window.confirm("هل أنت متأكد من حذف هذه الفاتورة؟ لا يمكن التراجع.")) {
        return;
      }
      await CleanTime.apiRequest(`/api/orders/${orderId}`, { method: "DELETE" });
      await ctx.refreshCurrentPage();
    };

    ctx.loadInvoices = async function loadInvoices() {
      const params = ctx.currentInvoicesQuery();
      const data = await CleanTime.apiRequest(`/api/orders?${params.toString()}`);
      state.invoices = data.orders || [];
      ctx.syncOrdersMap(state.invoices);
      ctx.updateInvoiceScope();

      if (!state.invoices.length) {
        els.invoicesContent.innerHTML = '<div class="empty-state"><div style="font-size:48px">📭</div><p style="color:var(--text-muted)">لا توجد فواتير</p></div>';
        return;
      }

      els.invoicesContent.innerHTML = state.invoices
        .map((order) => {
          const discountRow =
            CleanTime.getOrderDiscountTotal(order) > 0
              ? `<div class="inv-field"><div class="key">الخصم</div><div class="val" style="color:var(--orange)">- ${CleanTime.formatCurrency(CleanTime.getOrderDiscountTotal(order))}</div></div>`
              : "";
          const mixedLabel =
            order.paymentMethod === "مختلط"
              ? `${CleanTime.paymentBadge(order.paymentMethod)} كاش: ${CleanTime.formatCurrency(order.cashAmount)} + باقي: ${CleanTime.formatCurrency(order.networkAmount)}`
              : CleanTime.paymentBadge(order.paymentMethod);

          return `
            <div class="inv-detail-card">
              <div class="inv-header-row">
                <div>
                  <div class="inv-id">${CleanTime.escapeHtml(order.invoiceNumber)}</div>
                  <div class="inv-date">${CleanTime.escapeHtml(CleanTime.formatDate(order.date))}</div>
                </div>
                <div class="inv-actions">
                  ${CleanTime.paymentBadge(order.paymentMethod)}
                  <button type="button" class="btn btn-ghost btn-sm" data-action="print-order" data-id="${order.id}">🖨️ طباعة</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-action="save-order-pdf" data-id="${order.id}">📄 PDF</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-action="share-order-pdf" data-id="${order.id}">🟢 واتساب</button>
                  <button type="button" class="btn-edit" data-action="edit-order" data-id="${order.id}">✏️ تعديل</button>
                  <button type="button" class="btn-danger" data-action="delete-order" data-id="${order.id}">🗑️ حذف</button>
                </div>
              </div>
              <div class="inv-body-grid">
                <div class="inv-field"><div class="key">الفريق</div><div class="val">${CleanTime.escapeHtml(order.teamName)}</div></div>
                <div class="inv-field"><div class="key">جوال العميل</div><div class="val" style="direction:ltr">${CleanTime.escapeHtml(order.customerPhone)}</div></div>
                <div class="inv-field"><div class="key">الخدمات</div><div class="val">${CleanTime.escapeHtml(ctx.renderOrderServices(order))}</div></div>
                <div class="inv-field"><div class="key">ملخص الكمية</div><div class="val">${CleanTime.escapeHtml(ctx.renderOrderQuantity(order))}</div></div>
                ${discountRow}
                ${ctx.renderOrderItemsDetails(order)}
                ${order.notes ? `<div class="inv-field" style="grid-column:1/-1"><div class="key">ملاحظات الفريق</div><div class="val">${CleanTime.escapeHtml(order.notes)}</div></div>` : ""}
                ${order.adminNote ? `<div class="inv-field" style="grid-column:1/-1"><div class="key" style="color:var(--orange)">ملاحظة الأدمن</div><div class="val">${CleanTime.escapeHtml(order.adminNote)}</div></div>` : ""}
              </div>
              <div class="inv-total-bar">
                <div class="inv-total-label">${mixedLabel}</div>
                <div class="inv-total-val">${CleanTime.formatCurrency(order.totalPrice)}</div>
              </div>
              <div class="admin-note-section">
                <div style="font-size:11px;color:var(--teal);font-weight:700;margin-bottom:6px;">📝 ملاحظة الأدمن</div>
                <textarea class="admin-note-input" rows="2" data-note-id="${order.id}" placeholder="أضف ملاحظة إدارية...">${CleanTime.escapeHtml(order.adminNote || "")}</textarea>
                <div class="note-actions" style="margin-top:6px;">
                  <button type="button" class="btn btn-ghost btn-sm" data-action="save-note" data-id="${order.id}">💾 حفظ</button>
                  <span id="noteSaved-${order.id}" style="font-size:11px;color:var(--success);display:none;">✅ تم الحفظ</span>
                </div>
              </div>
            </div>
          `;
        })
        .join("");
    };

    ctx.saveAdminNote = async function saveAdminNote(orderId) {
      const input = els.invoicesContent.querySelector(`[data-note-id="${orderId}"]`);
      if (!input) return;
      const response = await CleanTime.apiRequest(`/api/orders/${orderId}`, {
        method: "PATCH",
        body: { adminNote: input.value.trim() },
      });
      state.ordersMap.set(String(response.order.id), response.order);
      const saved = document.getElementById(`noteSaved-${orderId}`);
      if (saved) {
        saved.style.display = "inline";
        window.setTimeout(() => {
          saved.style.display = "none";
        }, 2000);
      }
    };
  };
})();
