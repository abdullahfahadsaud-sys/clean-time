(() => {
  const state = {
    user: null,
    csrfToken: "",
    catalog: null,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatCurrency(value) {
    const number = Number(value || 0);
    return `${number.toFixed(2)} ريال`;
  }

  function formatShortCurrency(value) {
    const number = Number(value || 0);
    return `${number.toFixed(0)} ر`;
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function pageForRole(role) {
    return role === "admin" ? "/admin-dashboard.html" : "/team-dashboard.html";
  }

  function paymentBadge(method) {
    if (method === "كاش") return '<span class="badge badge-cash">كاش</span>';
    if (method === "شبكة") return '<span class="badge badge-network">شبكة</span>';
    if (method === "تحويل") return '<span class="badge badge-transfer">تحويل</span>';
    if (method === "مختلط") return '<span class="badge badge-mixed">مختلط</span>';
    return escapeHtml(method);
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    if (Number.isInteger(number)) return String(number);
    return String(number);
  }

  function getOrderItems(order) {
    if (Array.isArray(order?.items) && order.items.length) {
      return order.items;
    }

    if (!order || !order.serviceType) {
      return [];
    }

    return [
      {
        serviceType: order.serviceType,
        unit: order.unit,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        discount: order.discount || 0,
        totalPrice: order.totalPrice,
      },
    ];
  }

  function getOrderServicesSummary(order) {
    const items = getOrderItems(order);
    if (!items.length) return "—";
    return items.map((item) => item.serviceType).join(" + ");
  }

  function getOrderQuantitySummary(order) {
    const items = getOrderItems(order);
    if (!items.length) return "—";

    if (items.length === 1) {
      return `${formatNumber(items[0].quantity)} ${items[0].unit || ""}`.trim();
    }

    return `${items.length} بنود`;
  }

  function getOrderDiscountTotal(order) {
    const items = getOrderItems(order);
    if (!items.length) {
      return Number(order?.discount || 0);
    }

    return items.reduce((sum, item) => sum + Number(item.discount || 0), 0);
  }

  async function apiRequest(path, options = {}) {
    const method = options.method || "GET";
    const headers = new Headers(options.headers || {});
    const config = {
      method,
      credentials: "same-origin",
      headers,
      cache: "no-store",
    };

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      config.body = JSON.stringify(options.body);
    }

    if (!["GET", "HEAD"].includes(method) && state.csrfToken) {
      headers.set("X-CSRF-Token", state.csrfToken);
    }

    const response = await fetch(path, config);
    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (response.status === 401 && !options.allow401) {
      state.user = null;
      state.csrfToken = "";
      window.location.href = "/login.html";
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      throw new Error(data.message || `Request failed (${response.status})`);
    }

    if (data.csrfToken) {
      state.csrfToken = data.csrfToken;
    }

    return data;
  }

  async function getSession() {
    const data = await apiRequest("/api/auth/me", { allow401: true });

    if (!data.authenticated) {
      state.user = null;
      state.csrfToken = "";
      return null;
    }

    state.user = data.user;
    state.csrfToken = data.csrfToken || "";
    return data.user;
  }

  async function ensureRole(role) {
    const user = await getSession();

    if (!user) {
      window.location.href = "/login.html";
      return null;
    }

    if (role && user.role !== role) {
      window.location.href = pageForRole(user.role);
      return null;
    }

    return user;
  }

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      state.user = null;
      state.csrfToken = "";
      window.location.href = "/login.html";
    }
  }

  async function loadCatalog() {
    if (state.catalog) {
      return state.catalog;
    }

    const data = await apiRequest("/api/catalog");
    state.catalog = data;
    return data;
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function exportOrdersToCsv(orders, filename) {
    const headers = [
      "رقم الفاتورة",
      "الفريق",
      "الخدمة",
      "الكمية",
      "الوحدة",
      "سعر الوحدة",
      "الخصم",
      "الإجمالي",
      "طريقة الدفع",
      "جوال العميل",
      "التاريخ",
      "ملاحظات الفريق",
      "ملاحظة الأدمن",
    ];

    const rows = orders.map((order) => [
      order.invoiceNumber,
      order.teamName,
      getOrderServicesSummary(order),
      getOrderQuantitySummary(order),
      getOrderItems(order).length === 1 ? getOrderItems(order)[0].unit : "متعدد",
      getOrderItems(order).length === 1 ? getOrderItems(order)[0].unitPrice : "متعدد",
      getOrderDiscountTotal(order).toFixed(2),
      Number(order.totalPrice || 0).toFixed(2),
      order.paymentMethod,
      order.customerPhone,
      formatDate(order.date),
      order.notes || "",
      order.adminNote || "",
    ]);

    const csv =
      "\uFEFF" +
      [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function truncateText(value, maxLength) {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  function wrapText(value, maxChars) {
    const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = "";

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    });

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read blob."));
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image."));
      image.src = src;
    });
  }

  function concatUint8Arrays(parts) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });

    return output;
  }

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function triggerBlobDownload(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function saveBlobToFile(blob, filename) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "PDF",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (error) {
        if (error?.name === "AbortError") {
          return false;
        }
      }
    }

    triggerBlobDownload(blob, filename);
    return true;
  }

  function buildInvoiceFilename(order) {
    const baseName = String(order?.invoiceNumber || `invoice-${Date.now()}`)
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    return `${baseName || "invoice"}.pdf`;
  }

  function buildInvoiceViewModel(order) {
    const rawItems = getOrderItems(order);
    const items = rawItems.length
      ? rawItems
      : [
          {
            serviceType: "",
            unit: "",
            quantity: "",
            unitPrice: "",
            discount: "",
            totalPrice: "",
          },
        ];

    const maxRows = 10;
    const orderDate = order?.date ? new Date(order.date) : new Date();
    const gregDay = String(orderDate.getDate()).padStart(2, "0");
    const gregMonth = String(orderDate.getMonth() + 1).padStart(2, "0");
    const gregYear = String(orderDate.getFullYear());
    const invoiceNumber = order.invoiceNumber || "—";
    const customerPhone = order.customerPhone || "—";
    const teamName = order.teamName || "—";
    const paymentMethod = order.paymentMethod || "—";
    const paymentInfo =
      paymentMethod === "مختلط"
        ? `كاش: ${formatCurrency(order.cashAmount)} + شبكة: ${formatCurrency(order.networkAmount)}`
        : paymentMethod;
    const discountTotal = getOrderDiscountTotal(order);
    const totalPrice = Number(order.totalPrice || 0);
    const subtotal = totalPrice + discountTotal;
    const logoUrl = new URL("/static/logo.jpg", window.location.href).href;
    const stampUrl = new URL("/static/ktm.png", window.location.href).href;
    const documentBaseHref = new URL("/", window.location.href).href;
    const itemRows = items.slice(0, maxRows).map((item, index) => ({
      index: index + 1,
      serviceType: item.serviceType || "",
      quantity:
        item.quantity !== undefined && item.quantity !== null && item.quantity !== ""
          ? formatNumber(item.quantity)
          : "",
      unit: item.unit || "",
      unitPrice:
        item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== ""
          ? Number(item.unitPrice || 0).toFixed(2)
          : "",
      discount:
        item.discount !== undefined &&
        item.discount !== null &&
        item.discount !== "" &&
        Number(item.discount || 0) !== 0
          ? Number(item.discount || 0).toFixed(2)
          : "",
      total:
        item.totalPrice !== undefined && item.totalPrice !== null && item.totalPrice !== ""
          ? Number(item.totalPrice || 0).toFixed(2)
          : "",
    }));
    const blankRows = Array.from(
      { length: Math.max(0, maxRows - Math.min(items.length, maxRows)) },
      (_, index) => ({
        index: itemRows.length + index + 1,
        serviceType: "",
        quantity: "",
        unit: "",
        unitPrice: "",
        discount: "",
        total: "",
        blank: true,
      })
    );
    const notes = [];

    if (order.notes) {
      notes.push({ label: "ملاحظات الفريق", text: order.notes, admin: false });
    }
    if (order.adminNote) {
      notes.push({ label: "ملاحظة الإدارة", text: order.adminNote, admin: true });
    }

    return {
      logoUrl,
      stampUrl,
      documentBaseHref,
      dateText: `${gregDay}/${gregMonth}/${gregYear}`,
      invoiceNumber,
      customerPhone,
      teamName,
      paymentInfo,
      subtotal,
      subtotalText: formatCurrency(subtotal),
      discountTotal,
      totalPrice,
      totalPriceText: formatCurrency(totalPrice),
      rows: [...itemRows, ...blankRows],
      notes,
      canvasWidth: 1654,
      canvasHeight: 2339,
    };
  }

  function buildInvoiceHtml(order) {
    const view = buildInvoiceViewModel(order);
    const rowsMarkup = view.rows
      .map(
        (row) => `
          <tr${row.blank ? ' class="blank-row"' : ""}>
            <td class="col-no">${row.blank ? "&nbsp;" : row.index}</td>
            <td class="col-desc">${row.blank ? "&nbsp;" : escapeHtml(row.serviceType)}</td>
            <td class="col-qty">${row.blank ? "&nbsp;" : escapeHtml(row.quantity)}</td>
            <td class="col-unit">${row.blank ? "&nbsp;" : escapeHtml(row.unit)}</td>
            <td class="col-price">${row.blank ? "&nbsp;" : escapeHtml(row.unitPrice)}</td>
            <td class="col-discount">${row.blank ? "&nbsp;" : escapeHtml(row.discount)}</td>
            <td class="col-total">${row.blank ? "&nbsp;" : escapeHtml(row.total)}</td>
          </tr>
        `
      )
      .join("");
    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <base href="${escapeHtml(view.documentBaseHref)}">
        <title>فاتورة ${escapeHtml(view.invoiceNumber)}</title>
        <style>
          :root {
            --primary: #163a70;
            --primary-2: #214c8f;
            --primary-3: #2b5ca7;
            --line: #d9e3ef;
            --soft: #f4f7fb;
            --soft-2: #eef3f9;
            --text: #17335c;
            --muted: #6b7f99;
            --footer: #132f5c;
          }

          @page { size: A4; margin: 0; }
          * { box-sizing: border-box; }

          html, body {
            margin: 0;
            padding: 0;
            font-family: Tahoma, Arial, sans-serif;
            background: #eef3f9;
            color: var(--text);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body {
            padding: 18px;
          }

          .page {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: #fff;
            border-radius: 22px;
            box-shadow: 0 20px 46px rgba(17, 34, 68, 0.14);
            overflow: hidden;
            position: relative;
            padding: 0;
          }

          .page::before {
            content: "";
            display: block;
            height: 10px;
            background: linear-gradient(90deg, var(--primary), var(--primary-3));
          }

          .content {
            padding: 14mm 12mm 0;
          }

          .header {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            gap: 14px;
            align-items: start;
            border-bottom: 1px solid #edf2f8;
            padding-bottom: 18px;
            margin-bottom: 18px;
          }

          .date-card {
            border: 1px solid var(--line);
            background: linear-gradient(180deg, #fbfdff 0%, #f4f8fd 100%);
            border-radius: 16px;
            padding: 13px 15px;
            min-height: 88px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            font-size: 14px;
            font-weight: 800;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
          }

          .date-card span {
            color: var(--muted);
            font-size: 13px;
            margin-bottom: 6px;
            display: block;
          }

          .logo-wrap {
            text-align: center;
            min-width: 256px;
          }

          .logo-frame {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #fff;
            border: 1px solid var(--line);
            border-radius: 28px;
            padding: 16px 20px;
            box-shadow: 0 16px 32px rgba(23, 51, 92, 0.13);
          }

          .logo {
            width: 172px;
            height: auto;
            display: block;
          }

          .invoice-title {
            margin-top: 14px;
            font-size: 34px;
            color: var(--primary);
            font-weight: 900;
            letter-spacing: 0.5px;
          }

          .invoice-subtitle {
            margin-top: 4px;
            color: var(--muted);
            font-size: 14px;
            font-weight: 700;
          }

          .meta-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 18px;
          }

          .meta-card {
            border: 1px solid var(--line);
            background: linear-gradient(180deg, #fbfdff 0%, #f5f8fc 100%);
            border-radius: 16px;
            padding: 12px 14px;
            min-height: 84px;
          }

          .meta-card span {
            display: block;
            font-size: 13px;
            color: var(--muted);
            margin-bottom: 6px;
            font-weight: 700;
          }

          .meta-card strong {
            display: block;
            font-size: 15px;
            line-height: 1.6;
            color: var(--text);
            word-break: break-word;
          }

          .meta-card.phone strong {
            direction: ltr;
            text-align: left;
            letter-spacing: 0.3px;
          }

          .meta-card.payment strong {
            font-size: 14px;
          }

          .table-shell {
            border: 1px solid var(--line);
            border-radius: 18px;
            overflow: hidden;
            margin-top: 10px;
            position: relative;
            background: #fff;
          }

          .table-shell::before {
            content: "";
            position: absolute;
            inset: 80px 40px 80px 40px;
            background: url("${escapeHtml(view.logoUrl)}") center/42% no-repeat;
            opacity: 0.035;
            pointer-events: none;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            position: relative;
            z-index: 1;
            direction: rtl;
          }

          thead tr {
            background: linear-gradient(135deg, var(--primary), var(--primary-2));
            color: #fff;
          }

          th {
            padding: 15px 8px;
            font-size: 14px;
            font-weight: 800;
            text-align: center;
          }

          td {
            padding: 14px 8px;
            font-size: 14px;
            color: var(--text);
            text-align: center;
            border-bottom: 1px solid #e4ebf4;
          }

          tbody tr:nth-child(even) {
            background: #fbfdff;
          }

          .col-desc { width: 30%; text-align: right; font-weight: 800; }
          .col-qty { width: 10%; }
          .col-unit { width: 12%; }
          .col-price { width: 14%; }
          .col-discount { width: 12%; }
          .col-total { width: 16%; font-weight: 900; }
          .col-no { width: 6%; font-weight: 800; }
          .blank-row td { color: transparent; }

          .summary-grid {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr;
            gap: 14px;
            margin-top: 16px;
            direction: ltr;
          }

          .signature-panel,
          .totals {
            border: 1px solid var(--line);
            border-radius: 18px;
            background: linear-gradient(180deg, #fbfdff 0%, #f6f9fd 100%);
            padding: 16px;
            direction: rtl;
          }

          .section-title {
            font-size: 17px;
            color: var(--primary);
            font-weight: 900;
            margin-bottom: 12px;
          }

          .signature-panel {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 290px;
          }

          .signature-panel img {
            width: 680px;
            max-width: 100%;
            max-height: 360px;
            object-fit: contain;
            display: block;
          }

          .total-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            background: #fff;
            border: 1px solid #e8eef6;
            border-radius: 14px;
            padding: 12px 14px;
            margin-bottom: 8px;
            font-size: 15px;
            font-weight: 800;
          }

          .total-row.final {
            background: linear-gradient(135deg, var(--primary), var(--primary-2));
            color: #fff;
            border-color: transparent;
            margin-top: 10px;
            font-size: 16px;
          }

          .footer {
            margin-top: 18px;
            background: var(--footer);
            color: #fff;
            text-align: center;
            padding: 16px 18px 18px;
            line-height: 1.9;
          }

          .footer .line-ar {
            font-size: 14px;
            font-weight: 700;
          }

          .footer .line-en {
            font-size: 13px;
            opacity: 0.94;
          }

          @media print {
            html, body {
              width: 210mm;
              height: 297mm;
              background: #fff;
            }

            body {
              background: #fff;
              padding: 0;
            }

            .page {
              width: 210mm;
              min-height: 297mm;
              margin: 0;
              box-shadow: none;
              border-radius: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="content">
            <div class="header">
              <div class="date-card">
                <span>التاريخ</span>
                ${escapeHtml(view.dateText)}
              </div>

              <div class="logo-wrap">
                <div class="logo-frame">
                  <img id="invoiceLogo" class="logo" src="${escapeHtml(view.logoUrl)}" alt="Clean Time Logo">
                </div>
                <div class="invoice-title">فاتورة</div>
                <div class="invoice-subtitle">Clean Time Invoice</div>
              </div>

              <div class="date-card">
                <span>رقم الفاتورة</span>
                ${escapeHtml(view.invoiceNumber)}
              </div>
            </div>

            <div class="meta-grid">
              <div class="meta-card">
                <span>رقم الفاتورة</span>
                <strong>${escapeHtml(view.invoiceNumber)}</strong>
              </div>
              <div class="meta-card">
                <span>التاريخ</span>
                <strong>${escapeHtml(view.dateText)}</strong>
              </div>
              <div class="meta-card phone">
                <span>رقم العميل</span>
                <strong dir="ltr">${escapeHtml(view.customerPhone)}</strong>
              </div>
              <div class="meta-card">
                <span>الفريق</span>
                <strong>${escapeHtml(view.teamName)}</strong>
              </div>
              <div class="meta-card payment">
                <span>طريقة الدفع</span>
                <strong>${escapeHtml(view.paymentInfo)}</strong>
              </div>
            </div>

            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th class="col-no">#</th>
                    <th class="col-desc">الخدمة</th>
                    <th class="col-qty">الكمية</th>
                    <th class="col-unit">الوحدة</th>
                    <th class="col-price">سعر الوحدة</th>
                    <th class="col-discount">الخصم</th>
                    <th class="col-total">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>${rowsMarkup}</tbody>
              </table>
            </div>

            <div class="summary-grid">
              <div class="signature-panel">
                <div>
                  <img
                    src="${escapeHtml(view.stampUrl)}"
                    alt="شعار المؤسسة"
                    onerror="this.closest('.signature-panel').style.display='none';"
                  >
                </div>
              </div>

              <div class="totals">
                <div class="section-title">ملخص الإجمالي</div>
                <div class="total-row">
                  <span>المجموع</span>
                  <span>${escapeHtml(view.subtotalText)}</span>
                </div>
                <div class="total-row">
                  <span>الخصم</span>
                  <span>${escapeHtml(formatCurrency(view.discountTotal))}</span>
                </div>
                <div class="total-row final">
                  <span>الإجمالي النهائي بعد الخصم</span>
                  <span>${escapeHtml(view.totalPriceText)}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="footer">
            <div class="line-ar">المملكة العربية السعودية - القصيم - المذنب - تليفون ٠٥٠٠٣٦٢٦٩٦</div>
            <div class="line-en">Kingdom of Saudi Arabia - Al-Qassim - Al-Mithnab - Tel 0500362696</div>
          </div>
        </div>

        <script>
          window.addEventListener("load", () => {
            window.focus();
            setTimeout(() => window.print(), 250);
          }, { once: true });
        <\/script>
      </body>
      </html>
    `;
  }

  const assetDataUrlPromises = new Map();

  async function getStaticAssetDataUrl(assetPath) {
    if (!assetDataUrlPromises.has(assetPath)) {
      const assetUrl = new URL(assetPath, window.location.href).href;
      const promise = fetch(assetUrl, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${assetPath}.`);
          }
          return response.blob();
        })
        .then(blobToDataUrl)
        .catch(() => "");
      assetDataUrlPromises.set(assetPath, promise);
    }

    return assetDataUrlPromises.get(assetPath) || "";
  }

  async function getLogoDataUrl() {
    return getStaticAssetDataUrl("/static/logo.jpg");
  }

  async function getStampDataUrl() {
    return getStaticAssetDataUrl("/static/ktm.png");
  }

  function buildInvoiceSvgMarkup(view, logoDataUrl, stampDataUrl) {
    const pageWidth = view.canvasWidth;
    const pageHeight = view.canvasHeight;
    const marginX = 82;
    const contentWidth = pageWidth - marginX * 2;
    const tableX = marginX;
    const tableY = 520;
    const tableWidth = contentWidth;
    const headerHeight = 74;
    const rowHeight = 88;
    const metaY = 330;
    const metaGap = 18;
    const metaWidth = (contentWidth - metaGap * 4) / 5;
    const metaHeight = 108;
    const columns = [
      { key: "total", label: "الإجمالي", width: 290 },
      { key: "discount", label: "الخصم", width: 170 },
      { key: "unitPrice", label: "سعر الوحدة", width: 180 },
      { key: "unit", label: "الوحدة", width: 130 },
      { key: "quantity", label: "الكمية", width: 150 },
      { key: "serviceType", label: "الخدمة", width: 480, align: "end" },
      { key: "index", label: "#", width: 90 },
    ];
    const tableHeight = headerHeight + rowHeight * view.rows.length;
    const summaryY = tableY + tableHeight + 34;
    const footerY = pageHeight - 132;
    const summaryGap = 22;
    const notesWidth = 928;
    const totalsWidth = contentWidth - notesWidth - summaryGap;
    const summaryHeight = footerY - summaryY - 24;
    const notesX = marginX;
    const totalsX = notesX + notesWidth + summaryGap;
    const hasStamp = Boolean(stampDataUrl);
    const stampPaddingX = 12;
    const stampPaddingY = 24;
    const stampImageWidth = notesWidth - stampPaddingX * 2;
    const stampImageHeight = summaryHeight - stampPaddingY * 2;
    const stampImageX = notesX + stampPaddingX;
    const stampImageY = summaryY + stampPaddingY;
    const xPositions = [];
    let runningX = tableX;
    const metaCards = [
      { label: "رقم الفاتورة", lines: [truncateText(view.invoiceNumber, 18)] },
      { label: "التاريخ", lines: [view.dateText] },
      { label: "رقم العميل", lines: [view.customerPhone], phone: true },
      { label: "الفريق", lines: [truncateText(view.teamName, 16)] },
      { label: "طريقة الدفع", lines: wrapText(view.paymentInfo, 15).slice(0, 2), compact: true },
    ];

    columns.forEach((column) => {
      xPositions.push(runningX);
      runningX += column.width;
    });

    const tableHeaderMarkup = columns
      .map((column, index) => {
        const x = xPositions[index] + column.width / 2;
        return `<text x="${x}" y="${tableY + 47}" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(column.label)}</text>`;
      })
      .join("");

    const columnLinesMarkup = columns
      .slice(1)
      .map((_, index) => {
        const x = xPositions[index + 1];
        return `<line x1="${x}" y1="${tableY}" x2="${x}" y2="${tableY + tableHeight}" stroke="#dfe6f2" stroke-width="1"/>`;
      })
      .join("");

    const rowLinesMarkup = Array.from({ length: view.rows.length + 1 }, (_, index) => {
      const y = tableY + headerHeight + rowHeight * index;
      return `<line x1="${tableX}" y1="${y}" x2="${tableX + tableWidth}" y2="${y}" stroke="#dfe6f2" stroke-width="1"/>`;
    }).join("");

    const rowsMarkup = view.rows
      .map((row, rowIndex) => {
        const y = tableY + headerHeight + rowHeight * rowIndex;
        const rowFill = rowIndex % 2 === 0 ? "#ffffff" : "#fbfdff";
        const cellMarkup = columns
          .map((column, columnIndex) => {
            const rawValue = column.key === "index" ? String(row.index) : String(row[column.key] ?? "");
            const value = row.blank ? "" : truncateText(rawValue, column.key === "serviceType" ? 24 : 13);
            const x = column.align === "end" ? xPositions[columnIndex] + column.width - 16 : xPositions[columnIndex] + column.width / 2;
            const anchor = column.align === "end" ? "end" : "middle";
            return `<text x="${x}" y="${y + 55}" font-size="25" font-weight="${column.key === "serviceType" || column.key === "total" || column.key === "index" ? "700" : "500"}" fill="${row.blank ? "#ffffff" : "#17335c"}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
          })
          .join("");

        return `
          <rect x="${tableX}" y="${y}" width="${tableWidth}" height="${rowHeight}" fill="${rowFill}"/>
          ${cellMarkup}
        `;
      })
      .join("");

    const totalsMarkup = `
      <rect x="${totalsX}" y="${summaryY}" width="${totalsWidth}" height="${summaryHeight}" rx="24" fill="#f8fbff" stroke="#d9e3ef" stroke-width="2"/>
      <text x="${totalsX + totalsWidth - 26}" y="${summaryY + 48}" font-size="32" font-weight="800" fill="#163a70" text-anchor="end">ملخص الإجمالي</text>
      <rect x="${totalsX + 24}" y="${summaryY + 78}" width="${totalsWidth - 48}" height="74" rx="16" fill="#ffffff" stroke="#dfe6f2" stroke-width="2"/>
      <text x="${totalsX + totalsWidth - 26}" y="${summaryY + 123}" font-size="24" font-weight="700" fill="#17335c" text-anchor="end">المجموع</text>
      <text x="${totalsX + 34}" y="${summaryY + 123}" font-size="23" font-weight="700" fill="#163a70" text-anchor="start">${escapeXml(view.subtotalText)}</text>
      <rect x="${totalsX + 24}" y="${summaryY + 166}" width="${totalsWidth - 48}" height="74" rx="16" fill="#ffffff" stroke="#dfe6f2" stroke-width="2"/>
      <text x="${totalsX + totalsWidth - 26}" y="${summaryY + 211}" font-size="24" font-weight="700" fill="#17335c" text-anchor="end">الخصم</text>
      <text x="${totalsX + 34}" y="${summaryY + 211}" font-size="23" font-weight="700" fill="#163a70" text-anchor="start">${escapeXml(formatCurrency(view.discountTotal))}</text>
      <rect x="${totalsX + 24}" y="${summaryY + summaryHeight - 126}" width="${totalsWidth - 48}" height="94" rx="18" fill="#163a70"/>
      <text x="${totalsX + totalsWidth / 2}" y="${summaryY + summaryHeight - 78}" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle">الإجمالي النهائي بعد الخصم</text>
      <text x="${totalsX + totalsWidth / 2}" y="${summaryY + summaryHeight - 40}" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(view.totalPriceText)}</text>
    `;

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">
        <rect width="${pageWidth}" height="${pageHeight}" fill="#ffffff"/>
        <rect x="0" y="0" width="${pageWidth}" height="18" fill="#163a70"/>

        <rect x="${marginX}" y="78" width="270" height="108" rx="20" fill="#f5f8fd" stroke="#d9e3ef" stroke-width="2"/>
        <text x="${marginX + 240}" y="120" font-size="22" font-weight="700" fill="#6b7f99" text-anchor="end">التاريخ</text>
        <text x="${marginX + 135}" y="156" font-size="32" font-weight="800" fill="#17335c" text-anchor="middle">${escapeXml(view.dateText)}</text>

        <rect x="${pageWidth - marginX - 270}" y="78" width="270" height="108" rx="20" fill="#f5f8fd" stroke="#d9e3ef" stroke-width="2"/>
        <text x="${pageWidth - marginX - 24}" y="120" font-size="22" font-weight="700" fill="#6b7f99" text-anchor="end">رقم الفاتورة</text>
        <text x="${pageWidth - marginX - 135}" y="156" font-size="28" font-weight="800" fill="#17335c" text-anchor="middle">${escapeXml(view.invoiceNumber)}</text>

        <g transform="translate(${pageWidth / 2 - 165}, 46)">
          <rect x="0" y="0" width="330" height="170" rx="28" fill="#ffffff" stroke="#d9e3ef" stroke-width="2"/>
          ${logoDataUrl ? `<image href="${logoDataUrl}" x="42" y="14" width="246" height="140" preserveAspectRatio="xMidYMid meet"/>` : ""}
        </g>
        <text x="${pageWidth / 2}" y="266" font-size="54" font-weight="800" fill="#163a70" text-anchor="middle">فاتورة</text>
        <text x="${pageWidth / 2}" y="304" font-size="24" font-weight="600" fill="#6b7f99" text-anchor="middle">Clean Time Invoice</text>

        ${Array.from({ length: metaCards.length }, (_, index) => {
          const cardX = marginX + index * (metaWidth + metaGap);
          const card = metaCards[index];
          const lines = (card.lines && card.lines.length ? card.lines : ["—"]).map((line) =>
            card.compact ? truncateText(line, 18) : truncateText(line, 20)
          );
          const fontSize = card.compact ? 20 : card.phone ? 24 : 25;
          const textX = card.phone ? cardX + 18 : cardX + metaWidth - 18;
          const textAnchor = card.phone ? "start" : "end";
          const directionAttrs = card.phone ? ' direction="ltr" unicode-bidi="embed"' : "";
          const baseY = lines.length > 1 ? metaY + 66 : metaY + 76;
          const valueMarkup = lines
            .map(
              (line, lineIndex) => `
                <text x="${textX}" y="${baseY + lineIndex * 24}" font-size="${fontSize}" font-weight="700" fill="#17335c" text-anchor="${textAnchor}"${directionAttrs}>${escapeXml(line)}</text>
              `
            )
            .join("");
          return `
            <rect x="${cardX}" y="${metaY}" width="${metaWidth}" height="${metaHeight}" rx="18" fill="#f8fbff" stroke="#d9e3ef" stroke-width="2"/>
            <text x="${cardX + metaWidth - 18}" y="${metaY + 38}" font-size="19" font-weight="700" fill="#6b7f99" text-anchor="end">${escapeXml(card.label)}</text>
            ${valueMarkup}
          `;
        }).join("")}

        <rect x="${tableX}" y="${tableY}" width="${tableWidth}" height="${tableHeight}" rx="22" fill="#ffffff" stroke="#d9e3ef" stroke-width="2"/>
        ${
          logoDataUrl
            ? `<image href="${logoDataUrl}" x="${tableX + tableWidth * 0.18}" y="${tableY + 112}" width="${tableWidth * 0.64}" height="${tableHeight * 0.58}" opacity="0.038" preserveAspectRatio="xMidYMid meet"/>`
            : ""
        }
        <rect x="${tableX}" y="${tableY}" width="${tableWidth}" height="${headerHeight}" rx="22" fill="#163a70"/>
        ${tableHeaderMarkup}
        ${rowsMarkup}
        ${columnLinesMarkup}
        ${rowLinesMarkup}

        <rect x="${notesX}" y="${summaryY}" width="${notesWidth}" height="${summaryHeight}" rx="24" fill="#f8fbff" stroke="#d9e3ef" stroke-width="2"/>
        ${
          hasStamp
            ? `
              <image href="${stampDataUrl}" x="${stampImageX}" y="${stampImageY}" width="${stampImageWidth}" height="${stampImageHeight}" preserveAspectRatio="xMidYMid meet"/>
            `
            : ""
        }
        ${totalsMarkup}

        <rect x="0" y="${footerY}" width="${pageWidth}" height="${pageHeight - footerY}" fill="#132f5c"/>
        <text x="${pageWidth / 2}" y="${footerY + 54}" font-size="25" font-weight="700" fill="#ffffff" text-anchor="middle">المملكة العربية السعودية - القصيم - المذنب - تليفون ٠٥٠٠٣٦٢٦٩٦</text>
        <text x="${pageWidth / 2}" y="${footerY + 94}" font-size="20" font-weight="500" fill="#ffffff" text-anchor="middle">Kingdom of Saudi Arabia - Al-Qassim - Al-Mithnab - Tel 0500362696</text>
      </svg>
    `;
  }

  async function renderInvoiceToJpegDataUrl(order) {
    const view = buildInvoiceViewModel(order);
    const [logoDataUrl, stampDataUrl] = await Promise.all([getLogoDataUrl(), getStampDataUrl()]);
    const svgMarkup = buildInvoiceSvgMarkup(view, logoDataUrl, stampDataUrl);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    const image = await loadImage(svgDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = view.canvasWidth;
    canvas.height = view.canvasHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("تعذر تجهيز ملف PDF.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.96);
  }

  function createPdfBlobFromJpegDataUrl(jpegDataUrl, imageWidth, imageHeight) {
    const base64Marker = ";base64,";
    const markerIndex = jpegDataUrl.indexOf(base64Marker);
    if (markerIndex === -1) {
      throw new Error("تعذر إنشاء ملف PDF.");
    }

    const jpegBytes = base64ToUint8Array(jpegDataUrl.slice(markerIndex + base64Marker.length));
    const encoder = new TextEncoder();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const drawCommand = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;
    const drawBytes = encoder.encode(drawCommand);
    const objects = {
      1: encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
      2: encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      3: encoder.encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`
      ),
      4: concatUint8Arrays([
        encoder.encode(
          `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
        ),
        jpegBytes,
        encoder.encode("\nendstream"),
      ]),
      5: encoder.encode(`<< /Length ${drawBytes.length} >>\nstream\n${drawCommand}\nendstream`),
    };

    const parts = [];
    const header = encoder.encode("%PDF-1.3\n%\xFF\xFF\xFF\xFF\n");
    parts.push(header);
    const offsets = [0];
    let offset = header.length;

    for (let objectId = 1; objectId <= 5; objectId += 1) {
      const prefix = encoder.encode(`${objectId} 0 obj\n`);
      const suffix = encoder.encode("\nendobj\n");
      offsets[objectId] = offset;
      parts.push(prefix, objects[objectId], suffix);
      offset += prefix.length + objects[objectId].length + suffix.length;
    }

    const xrefOffset = offset;
    let xref = "xref\n0 6\n0000000000 65535 f \n";
    for (let objectId = 1; objectId <= 5; objectId += 1) {
      xref += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(encoder.encode(xref));

    return new Blob(parts, { type: "application/pdf" });
  }

  async function createInvoicePdfBlob(order) {
    const view = buildInvoiceViewModel(order);
    const jpegDataUrl = await renderInvoiceToJpegDataUrl(order);
    return createPdfBlobFromJpegDataUrl(jpegDataUrl, view.canvasWidth, view.canvasHeight);
  }

  async function downloadInvoicePdf(order) {
    const pdfBlob = await createInvoicePdfBlob(order);
    const filename = buildInvoiceFilename(order);
    await saveBlobToFile(pdfBlob, filename);
    return { blob: pdfBlob, filename };
  }

  async function shareInvoicePdf(order) {
    const pdfBlob = await createInvoicePdfBlob(order);
    const filename = buildInvoiceFilename(order);
    const pdfFile = new File([pdfBlob], filename, { type: "application/pdf" });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      await navigator.share({
        files: [pdfFile],
        title: `فاتورة ${order?.invoiceNumber || ""}`.trim(),
        text: `فاتورة رقم ${order?.invoiceNumber || ""}`.trim(),
      });
      return { shared: true, filename };
    }

    await saveBlobToFile(pdfBlob, filename);
    const whatsappText = [
      `فاتورة رقم ${order?.invoiceNumber || "—"}`,
      "تم تنزيل ملف PDF على الجهاز.",
      "إذا لم يتم إرفاقه تلقائيًا، أرفقه يدويًا داخل واتساب.",
    ].join("\n");
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    return { shared: false, filename };
  }

  function printInvoice(order) {
    const win = window.open("", "_blank");

    if (!win) {
      window.alert("تعذر فتح نافذة الطباعة. تأكد من السماح بالنوافذ المنبثقة لهذا الموقع.");
      return;
    }

    win.document.open();
    win.document.write(buildInvoiceHtml(order));
    win.document.close();
  }

  function playSuccessSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();

      [523, 659, 784].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);

        const t = ctx.currentTime + index * 0.12;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.start(t);
        osc.stop(t + 0.24);
      });
    } catch {}
  }

  window.CleanTime = {
    state,
    apiRequest,
    downloadInvoicePdf,
    ensureRole,
    escapeHtml,
    exportOrdersToCsv,
    formatCurrency,
    formatDate,
    formatShortCurrency,
    getOrderDiscountTotal,
    getOrderItems,
    getOrderQuantitySummary,
    getOrderServicesSummary,
    getSession,
    loadCatalog,
    logout,
    pageForRole,
    paymentBadge,
    playSuccessSound,
    printInvoice,
    shareInvoicePdf,
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='logout']");
    if (!target) return;

    event.preventDefault();
    logout();
  });
})();
