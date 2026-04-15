(function () {
  const admin = (window.CleanTimeAdmin = window.CleanTimeAdmin || {});

  admin.setupExpenses = function setupExpenses(ctx) {
    const { state, els } = ctx;

    ctx.showExpenseAlert = function showExpenseAlert(message, type = "danger") {
      els.expenseAlert.innerHTML = `<div class="alert alert-${type}">${CleanTime.escapeHtml(message)}</div>`;
    };

    ctx.clearExpenseAlert = function clearExpenseAlert() {
      els.expenseAlert.innerHTML = "";
    };

    ctx.updateExpenseTypeUI = function updateExpenseTypeUI() {
      const isPrivate = els.expenseType.value === "private";
      els.expenseTeamWrap.style.display = isPrivate ? "block" : "none";
      els.expenseTeam.required = isPrivate;
      if (!isPrivate) {
        els.expenseTeam.value = "";
      }
    };

    ctx.resetExpenseForm = function resetExpenseForm() {
      els.expenseType.value = "general";
      els.expenseTeam.value = "";
      els.expenseTitle.value = "";
      els.expenseAmount.value = "";
      ctx.updateExpenseTypeUI();
      ctx.clearExpenseAlert();
    };

    ctx.loadExpenses = async function loadExpenses() {
      const [generalData, privateData] = await Promise.all([
        CleanTime.apiRequest("/api/expenses"),
        CleanTime.apiRequest("/api/team-expenses"),
      ]);

      state.generalExpenses = (generalData.expenses || []).map((expense) => ({
        ...expense,
        expenseKind: "general",
        teamName: "",
      }));
      state.privateExpenses = (privateData.teamExpenses || []).map((expense) => ({
        ...expense,
        expenseKind: "private",
      }));
      state.expenses = [...state.generalExpenses, ...state.privateExpenses].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      state.expenseEntries = new Map(state.expenses.map((expense) => [`${expense.expenseKind}:${expense.id}`, expense]));

      els.expensesCount.textContent = `${state.expenses.length} مصروف`;
      els.expensesGeneralTotal.textContent = CleanTime.formatCurrency(generalData.summary?.total || 0);
      els.expensesPrivateTotal.textContent = CleanTime.formatCurrency(privateData.summary?.total || 0);
      els.expensesTotal.textContent = CleanTime.formatCurrency(
        Number(generalData.summary?.total || 0) + Number(privateData.summary?.total || 0)
      );

      if (!state.expenses.length) {
        els.expensesBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">لا توجد مصروفات بعد</td></tr>';
        return;
      }

      els.expensesBody.innerHTML = state.expenses
        .map(
          (expense) => `
            <tr>
              <td>${expense.expenseKind === "private" ? "خاصة" : "عامة"}</td>
              <td>${expense.expenseKind === "private" ? CleanTime.escapeHtml(expense.teamName || "") : "—"}</td>
              <td>${CleanTime.escapeHtml(expense.title)}</td>
              <td style="font-weight:700;color:var(--orange)">${CleanTime.formatCurrency(expense.amount)}</td>
              <td>${CleanTime.escapeHtml(expense.createdByName)}</td>
              <td style="color:var(--text-muted);font-size:11px;white-space:nowrap">${CleanTime.escapeHtml(CleanTime.formatDate(expense.date))}</td>
              <td>
                <button type="button" class="btn-danger" data-action="delete-expense" data-id="${expense.id}" data-kind="${expense.expenseKind}">🗑️ حذف</button>
              </td>
            </tr>
          `
        )
        .join("");
    };

    ctx.addExpense = async function addExpense() {
      ctx.clearExpenseAlert();
      const expenseType = els.expenseType.value;
      const teamUsername = els.expenseTeam.value;
      const title = els.expenseTitle.value.trim();
      const amount = Number(els.expenseAmount.value || 0);

      if (!title) {
        ctx.showExpenseAlert("اكتب وصف المصروف أولًا");
        return;
      }
      if (!amount || amount <= 0) {
        ctx.showExpenseAlert("أدخل مبلغًا صحيحًا أكبر من صفر");
        return;
      }
      if (expenseType === "private" && !Object.keys(state.teams).length) {
        ctx.showExpenseAlert("لا توجد فرق متاحة لإسناد هذا المصروف");
        return;
      }
      if (expenseType === "private" && !teamUsername) {
        ctx.showExpenseAlert("اختر الفريق للمصروف الخاص");
        return;
      }

      els.addExpenseBtn.disabled = true;
      els.addExpenseBtn.textContent = "جاري الحفظ...";
      try {
        if (expenseType === "private") {
          await CleanTime.apiRequest("/api/team-expenses", {
            method: "POST",
            body: { title, amount, teamUsername },
          });
        } else {
          await CleanTime.apiRequest("/api/expenses", {
            method: "POST",
            body: { title, amount },
          });
        }
        ctx.resetExpenseForm();
        ctx.showExpenseAlert("تمت إضافة المصروف بنجاح", "success");
        await ctx.loadExpenses();
      } catch (error) {
        ctx.showExpenseAlert(error.message || "تعذر إضافة المصروف");
      } finally {
        els.addExpenseBtn.disabled = false;
        els.addExpenseBtn.textContent = "➕ إضافة";
      }
    };

    ctx.deleteExpense = async function deleteExpense(expenseId, expenseKind) {
      if (!window.confirm("هل أنت متأكد من حذف هذا المصروف؟")) {
        return;
      }
      const endpoint = expenseKind === "private" ? `/api/team-expenses/${expenseId}` : `/api/expenses/${expenseId}`;
      await CleanTime.apiRequest(endpoint, { method: "DELETE" });
      await ctx.loadExpenses();
    };
  };
})();
