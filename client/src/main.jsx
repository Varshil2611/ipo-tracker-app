import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "";

const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

const moneyPdf = (n) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;

const dateFmt = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const displayFilterDate = (v) => {
  if (!v) return "—";

  const [year, month, day] = v.split("-");

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
  ).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const dateInput = (v) => {
  if (!v) return "";

  const date = new Date(v);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
};

const blankIpo = () => ({
  id: Date.now(),
  date: new Date().toISOString().slice(0, 10),
  name: "",
  applicants: 0,
  retailAmount: 0,
  investment: 0,
  allotments: 0,
  profit: 0,
});

const blankApplicant = () => ({
  name: "",
  depository: "CDSL",
  pan: "",
  beneficiaryId: "",
});

function App() {
  const [tab, setTab] = useState("ipos");

  const [ipos, setIpos] = useState([]);
  const [apps, setApps] = useState([]);
  const [dash, setDash] = useState({});

  const [search, setSearch] = useState("");
  const [appSearch, setAppSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("dateDesc");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [lastSync, setLastSync] = useState(null);
  const [nextSync, setNextSync] = useState(null);

  const [pin, setPin] = useState("");
  const [admin, setAdmin] = useState(false);

  const [adminIpos, setAdminIpos] = useState([]);
  const [adminApps, setAdminApps] = useState([]);

  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showBackToTop, setShowBackToTop] = useState(false);

  // LOAD DATA
  async function load() {
    try {
      const [dashboardResponse, ipoResponse, applicantResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/dashboard`),
          fetch(`${API_URL}/api/ipos`),
          fetch(`${API_URL}/api/applicants`),
        ]);

      if (!dashboardResponse.ok || !ipoResponse.ok || !applicantResponse.ok) {
        throw new Error("Could not load data from server.");
      }

      const dashboardData = await dashboardResponse.json();
      const ipoData = await ipoResponse.json();
      const applicantData = await applicantResponse.json();

      setDash(dashboardData.dashboard || {});
      setIpos(ipoData.data || []);
      setApps(applicantData.data || []);

      setLastSync(
        dashboardData.lastSynced ||
          ipoData.lastSynced ||
          applicantData.lastSynced ||
          null,
      );

      setNextSync(
        dashboardData.nextSync ||
          ipoData.nextSync ||
          applicantData.nextSync ||
          null,
      );
    } catch (error) {
      console.error("Could not load data:", error);
    }
  }

  // INITIAL LOAD + 12 HOUR REFRESH
  useEffect(() => {
    load();

    const timer = setInterval(load, 12 * 60 * 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  // BACK TO TOP
  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };

    window.addEventListener("scroll", onScroll, {
      passive: true,
    });

    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // PUBLIC GOOGLE SHEETS SYNC
  const publicSync = async () => {
    if (syncing) return;

    setSyncing(true);

    try {
      const response = await fetch(`${API_URL}/api/sync`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        alert(data.error || "Could not sync Google Sheets.");
        return;
      }

      await load();
    } catch (error) {
      console.error("Public sync failed:", error);
      alert("Could not sync Google Sheets.");
    } finally {
      setSyncing(false);
    }
  };

  // FILTER + SORT
  const filtered = useMemo(() => {
    let list = ipos.filter((x) => {
      const d = x.date ? new Date(x.date).toISOString().slice(0, 10) : "";

      const ipoName = String(x.name || "").toLowerCase();

      const searchText = search.toLowerCase().trim();

      const matchesSearch = ipoName.includes(searchText);

      const matchesDateFrom = !dateFrom || d >= dateFrom;

      const matchesDateTo = !dateTo || d <= dateTo;

      const matchesStatus =
        status === "all" ||
        (status === "allotted" && Number(x.allotments) > 0) ||
        (status === "pending" && Number(x.allotments) === 0);

      return matchesSearch && matchesDateFrom && matchesDateTo && matchesStatus;
    });

    list.sort((a, b) => {
      if (sort === "dateAsc") {
        return new Date(a.date || 0) - new Date(b.date || 0);
      }

      if (sort === "dateDesc") {
        return new Date(b.date || 0) - new Date(a.date || 0);
      }

      if (sort === "profit") {
        return Number(b.profit || 0) - Number(a.profit || 0);
      }

      if (sort === "investment") {
        return (
          Number(b.investment || b.totalInvestment || 0) -
          Number(a.investment || a.totalInvestment || 0)
        );
      }

      if (sort === "roi") {
        return Number(b.roi || 0) - Number(a.roi || 0);
      }

      if (sort === "applicants") {
        return Number(b.applicants || 0) - Number(a.applicants || 0);
      }

      return 0;
    });

    return list;
  }, [ipos, search, status, dateFrom, dateTo, sort]);

  // DYNAMIC REPORT SUMMARY
  // Uses ONLY the currently filtered IPO data.
  // Investment is calculated internally only for ROI.
  const reportSummary = useMemo(() => {
    const totalApplications = filtered.reduce(
      (sum, x) => sum + Number(x.applicants || 0),
      0,
    );

    const totalAllotments = filtered.reduce(
      (sum, x) => sum + Number(x.allotments || 0),
      0,
    );

    const totalInvestment = filtered.reduce(
      (sum, x) => sum + Number(x.investment ?? x.totalInvestment ?? 0),
      0,
    );

    const totalProfit = filtered.reduce(
      (sum, x) => sum + Number(x.profit || 0),
      0,
    );

    const roi = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

    return {
      totalIpos: filtered.length,
      totalApplications,
      totalAllotments,
      totalInvestment,
      totalProfit,
      roi,
    };
  }, [filtered]);

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setSort("dateDesc");
  };

  // PDF REPORT
  const downloadReportPdf = () => {
    if (!filtered.length) {
      alert("No IPO data found for the selected filters.");
      return;
    }

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    let periodLabel = "All IPO Records";

    if (dateFrom && dateTo) {
      periodLabel = `${displayFilterDate(dateFrom)} - ${displayFilterDate(
        dateTo,
      )}`;
    } else if (dateFrom) {
      periodLabel = `From ${displayFilterDate(dateFrom)}`;
    } else if (dateTo) {
      periodLabel = `Up to ${displayFilterDate(dateTo)}`;
    }

    // PDF colors
    const navy = [24, 32, 52];
    const blue = [59, 130, 246];
    const green = [16, 185, 129];
    const purple = [139, 92, 246];
    const orange = [245, 158, 11];
    const pink = [236, 72, 153];

    const white = [255, 255, 255];
    const light = [248, 250, 252];
    const border = [226, 232, 240];
    const text = [30, 41, 59];
    const muted = [100, 116, 139];
    const profitGreen = [21, 108, 73];

    // =========================================================
    // HEADER
    // =========================================================

    doc.setFillColor(...navy);
    doc.rect(0, 0, pageWidth, 39, "F");

    doc.setFillColor(...blue);
    doc.rect(0, 37, pageWidth, 2, "F");

    // Main title
    doc.setFont("times", "bold");
    doc.setFontSize(21);
    doc.setTextColor(...white);
    doc.text("IPO PORTFOLIO", 14, 16);

    // Subtitle
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.setTextColor(203, 213, 225);
    doc.text("Investment Performance Report", 14, 24);

    // Period
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...white);
    doc.text("REPORT PERIOD", pageWidth - 14, 13, {
      align: "right",
    });

    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(periodLabel, pageWidth - 14, 20, {
      align: "right",
    });

    // Generated date
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.text(
      `Generated ${new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })}`,
      pageWidth - 14,
      27,
      {
        align: "right",
      },
    );

    // =========================================================
    // PERFORMANCE OVERVIEW
    // =========================================================

    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...text);
    doc.text("Performance Overview", 14, 50);

    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);

    doc.text(
      dateFrom || dateTo
        ? "Based on the currently selected filters"
        : "Based on all available IPO records",
      14,
      55,
    );

    // =========================================================
    // KPI CARDS
    // =========================================================

    const cards = [
      {
        label: "TOTAL IPOs",
        value: String(reportSummary.totalIpos),
        color: blue,
      },
      {
        label: "APPLICATIONS",
        value: String(reportSummary.totalApplications),
        color: green,
      },
      {
        label: "ALLOTMENTS",
        value: String(reportSummary.totalAllotments),
        color: purple,
      },
      {
        label: "TOTAL PROFIT",
        value: moneyPdf(reportSummary.totalProfit),
        color: orange,
      },
      {
        label: "ROI",
        value: `${reportSummary.roi.toFixed(2)}%`,
        color: pink,
      },
    ];

    const cardGap = 5;

    const cardWidth =
      (pageWidth - 28 - cardGap * (cards.length - 1)) / cards.length;

    const cardY = 61;
    const cardHeight = 27;

    cards.forEach((card, index) => {
      const x = 14 + index * (cardWidth + cardGap);

      // Card background
      doc.setFillColor(...white);
      doc.setDrawColor(...border);

      doc.roundedRect(x, cardY, cardWidth, cardHeight, 2.5, 2.5, "FD");

      // Colored top strip
      doc.setFillColor(...card.color);

      doc.roundedRect(x, cardY, cardWidth, 2.5, 1.2, 1.2, "F");

      // Label
      doc.setFont("times", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...muted);

      doc.text(card.label, x + 7, cardY + 11);

      // Value
      doc.setFont("times", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...text);

      doc.text(card.value, x + 7, cardY + 21);
    });

    // =========================================================
    // FILTER INFORMATION
    // =========================================================

    const statusLabel =
      status === "all"
        ? "All Status"
        : status === "allotted"
          ? "Allotted"
          : "No Allotment";

    const filterText = [
      search.trim() ? `Search: "${search.trim()}"` : null,
      status !== "all" ? `Status: ${statusLabel}` : null,
    ]
      .filter(Boolean)
      .join("  •  ");

    if (filterText) {
      doc.setFont("times", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...muted);

      doc.text(filterText, 14, 95);
    }

    const tableStartY = filterText ? 103 : 98;

    // =========================================================
    // IPO PERFORMANCE TITLE
    // =========================================================

    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...text);

    doc.text("IPO Performance", 14, tableStartY);

    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);

    doc.text(
      `${filtered.length} IPO record${filtered.length === 1 ? "" : "s"}`,
      pageWidth - 14,
      tableStartY,
      {
        align: "right",
      },
    );

    // =========================================================
    // TABLE DATA
    // =========================================================

    const tableBody = filtered.map((x) => {
      const investment = Number(x.investment ?? x.totalInvestment ?? 0);

      const profit = Number(x.profit || 0);

      const roi = investment > 0 ? (profit / investment) * 100 : 0;

      return [
        dateFmt(x.date),
        String(x.name || "—"),
        String(x.applicants ?? 0),
        moneyPdf(investment),
        String(x.allotments ?? 0),
        moneyPdf(profit),
        `${roi.toFixed(2)}%`,
      ];
    });

    // =========================================================
    // TOTAL ROW
    // IMPORTANT:
    // Added to BODY instead of FOOT.
    // Therefore it appears ONLY ONCE after the final IPO.
    // =========================================================

    tableBody.push([
      "",
      "TOTAL",
      String(reportSummary.totalApplications),
      "",
      String(reportSummary.totalAllotments),
      moneyPdf(reportSummary.totalProfit),
      `${reportSummary.roi.toFixed(2)}%`,
    ]);

    const totalRowIndex = tableBody.length - 1;

    // =========================================================
    // IPO TABLE
    // =========================================================

    autoTable(doc, {
      startY: tableStartY + 5,

      margin: {
        left: 14,
        right: 14,
        bottom: 20,
      },

      head: [
        [
          "DATE",
          "IPO",
          "APPLICATIONS",
          "INVESTMENT",
          "ALLOTMENTS",
          "PROFIT",
          "ROI",
        ],
      ],

      body: tableBody,

      theme: "plain",

      styles: {
        font: "times",
        fontStyle: "bold",
        fontSize: 10,
        textColor: text,

        cellPadding: {
          top: 4,
          right: 4,
          bottom: 4,
          left: 4,
        },

        lineColor: border,
        lineWidth: 0.25,
        valign: "middle",
      },

      headStyles: {
        fillColor: navy,
        textColor: white,
        font: "times",
        fontStyle: "bold",
        fontSize: 8,

        cellPadding: 4,

        halign: "left",
      },

      alternateRowStyles: {
        fillColor: light,
      },

      columnStyles: {
        0: {
          cellWidth: 28,
        },

        1: {
          cellWidth: 70,
          fontStyle: "bold",
        },

        2: {
          cellWidth: 29,
          halign: "center",
        },

        3: {
          cellWidth: 34,
          halign: "right",
        },

        4: {
          cellWidth: 29,
          halign: "center",
        },

        5: {
          cellWidth: 34,
          halign: "right",
          fontStyle: "bold",
        },

        6: {
          cellWidth: 27,
          halign: "right",
          fontStyle: "bold",
        },
      },

      didParseCell: (data) => {
        // ==========================================
        // TOTAL ROW
        // ==========================================

        if (data.section === "body" && data.row.index === totalRowIndex) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.textColor = text;
          data.cell.styles.font = "times";
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 8.5;
          data.cell.styles.lineWidth = 0.5;

          return;
        }

        // ==========================================
        // PROFIT
        // ==========================================

        if (data.section === "body" && data.column.index === 5) {
          data.cell.styles.textColor = profitGreen;
          data.cell.styles.font = "times";
          data.cell.styles.fontStyle = "bold";
        }

        // ==========================================
        // ROI
        // ==========================================

        if (data.section === "body" && data.column.index === 6) {
          data.cell.styles.textColor = [190, 24, 93];
          data.cell.styles.font = "times";
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    // =========================================================
    // FOOTER ON EVERY PAGE
    // =========================================================

    const totalPages = doc.getNumberOfPages();

    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);

      doc.setDrawColor(...border);
      doc.setLineWidth(0.3);

      doc.line(14, pageHeight - 13, pageWidth - 14, pageHeight - 13);

      doc.setFont("times", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...muted);

      doc.text("Built with love by Varshil", 14, pageHeight - 7);

      doc.text(
        `Page ${page} of ${totalPages}`,
        pageWidth - 14,
        pageHeight - 7,
        {
          align: "right",
        },
      );
    }

    // =========================================================
    // FILE NAME
    // =========================================================

    let filePart = "All-Data";

    if (dateFrom && dateTo) {
      filePart = `${dateFrom}-to-${dateTo}`;
    } else if (dateFrom) {
      filePart = `From-${dateFrom}`;
    } else if (dateTo) {
      filePart = `Up-to-${dateTo}`;
    }

    doc.save(`IPO-Portfolio-Report-${filePart}.pdf`);
  };

  // ADMIN LOGIN
  const adminLogin = async () => {
    if (!pin.trim()) {
      alert("Please enter the Admin PIN.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pin,
        }),
      });

      const loginData = await response.json();

      if (!response.ok || !loginData.ok) {
        alert(loginData.error || "Invalid PIN");
        return;
      }

      const dataResponse = await fetch(`${API_URL}/api/admin/data`, {
        headers: {
          "x-admin-pin": pin,
        },
      });

      const data = await dataResponse.json();

      if (!dataResponse.ok || data.error) {
        alert(data.error || "Could not load admin data.");
        return;
      }

      setAdminIpos(data.ipos || []);
      setAdminApps(data.applicants || []);

      setAdmin(true);
    } catch (error) {
      console.error("Admin login failed:", error);
      alert("Could not connect to the server.");
    }
  };

  // LOGOUT
  const logout = () => {
    setAdmin(false);
    setAdminIpos([]);
    setAdminApps([]);
    setPin("");
  };

  // ADMIN GOOGLE SHEETS SYNC
  const sync = async () => {
    if (syncing) return;

    setSyncing(true);

    try {
      const response = await fetch(`${API_URL}/api/admin/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pin,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        alert(data.error || "Could not sync Google Sheets.");
        return;
      }

      await load();

      if (admin) {
        const adminResponse = await fetch(`${API_URL}/api/admin/data`, {
          headers: {
            "x-admin-pin": pin,
          },
        });

        const adminData = await adminResponse.json();

        if (adminResponse.ok) {
          setAdminIpos(adminData.ipos || []);
          setAdminApps(adminData.applicants || []);
        }
      }
    } catch (error) {
      console.error("Admin sync failed:", error);
      alert("Could not sync Google Sheets.");
    } finally {
      setSyncing(false);
    }
  };

  // SAVE IPOs
  const saveIpos = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to save all IPO changes to Google Sheets?",
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/api/admin/ipos`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pin,
          ipos: adminIpos,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Could not save IPO changes.");
      } else {
        await load();

        const adminResponse = await fetch(`${API_URL}/api/admin/data`, {
          headers: {
            "x-admin-pin": pin,
          },
        });

        if (adminResponse.ok) {
          const adminData = await adminResponse.json();
          setAdminIpos(adminData.ipos || []);
        }

        alert("IPO changes saved to Google Sheets.");
      }
    } catch (error) {
      console.error("Save IPOs failed:", error);
      alert("Could not save IPO changes.");
    } finally {
      setSaving(false);
    }
  };

  // SAVE APPLICANTS
  const saveApps = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to save all applicant changes to Google Sheets?",
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/api/admin/applicants`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pin,
          applicants: adminApps,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Could not save applicant changes.");
      } else {
        await load();

        const adminResponse = await fetch(`${API_URL}/api/admin/data`, {
          headers: {
            "x-admin-pin": pin,
          },
        });

        if (adminResponse.ok) {
          const adminData = await adminResponse.json();
          setAdminApps(adminData.applicants || []);
        }

        alert("Applicant changes saved to Google Sheets.");
      }
    } catch (error) {
      console.error("Save applicants failed:", error);
      alert("Could not save applicant changes.");
    } finally {
      setSaving(false);
    }
  };

  // UPDATE IPO
  const updateIpo = (index, key, value) => {
    setAdminIpos((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: value,
            }
          : item,
      ),
    );
  };

  // UPDATE APPLICANT
  const updateApp = (index, key, value) => {
    setAdminApps((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: value,
            }
          : item,
      ),
    );
  };

  return (
    <div className="app">
      <header>
        <div className="brandBlock">
          <h1>IPO Tracker</h1>
          <p>Track. Manage. Grow.</p>
        </div>

        <div className="sync">
          <div className="syncInfo">
            <span className="dot" />

            <span>
              Last sync{" "}
              {lastSync
                ? new Date(lastSync).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>

            <small>
              · Next check{" "}
              {nextSync
                ? new Date(nextSync).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </small>
          </div>

          <button
            type="button"
            className="lightBtn syncNowBtn"
            onClick={publicSync}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Sync Google Sheets Now"}
          </button>
        </div>
      </header>

      <main>
        {/* DYNAMIC DASHBOARD CARDS */}
        <section className="cards reportCards">
          <Card label="Total IPOs" value={reportSummary.totalIpos} />

          <Card label="Applications" value={reportSummary.totalApplications} />

          <Card label="Allotments" value={reportSummary.totalAllotments} />

          <Card label="Total Profit" value={money(reportSummary.totalProfit)} />

          <Card label="ROI" value={`${reportSummary.roi.toFixed(2)}%`} />
        </section>

        {/* REPORT BAR */}
        <div className="dashboardReportBar">
          <div>
            <strong>
              {dateFrom || dateTo ? "Filtered Report" : "All Data Report"}
            </strong>

            <span>
              {dateFrom || dateTo
                ? ` • ${dateFrom ? displayFilterDate(dateFrom) : "Start"} → ${
                    dateTo ? displayFilterDate(dateTo) : "Today"
                  }`
                : " • All IPO records"}
            </span>

            <small>Dashboard totals and PDF use the current filters.</small>
          </div>

          <button
            type="button"
            className="pdfBtn"
            onClick={downloadReportPdf}
            disabled={filtered.length === 0}
          >
            Download PDF
          </button>
        </div>

        {/* NAVIGATION */}
        <nav>
          <button
            className={tab === "ipos" ? "active" : ""}
            onClick={() => setTab("ipos")}
          >
            IPO Summary
          </button>

          <button
            className={tab === "applicants" ? "active" : ""}
            onClick={() => setTab("applicants")}
          >
            Applicants
          </button>

          <button
            className={`adminBtn${tab === "admin" ? " active" : ""}`}
            onClick={() => setTab("admin")}
          >
            Admin
          </button>
        </nav>

        {/* IPO SUMMARY */}
        {tab === "ipos" && (
          <section className="panel">
            <FilterBar
              search={search}
              setSearch={setSearch}
              status={status}
              setStatus={setStatus}
              dateFrom={dateFrom}
              setDateFrom={setDateFrom}
              dateTo={dateTo}
              setDateTo={setDateTo}
              sort={sort}
              setSort={setSort}
              clearFilters={clearFilters}
            />

            <div className="resultCount">
              Showing {filtered.length} of {ipos.length} IPOs
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>IPO</th>
                    <th>Applicants</th>
                    <th>Investment</th>
                    <th>Allotments</th>
                    <th>Profit</th>
                    <th>ROI</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan="7">No IPOs found.</td>
                    </tr>
                  ) : (
                    filtered.map((x) => (
                      <tr key={x.id}>
                        <td data-label="Date">{dateFmt(x.date)}</td>

                        <td className="strong breakText" data-label="IPO">
                          {x.name}
                        </td>

                        <td className="num" data-label="Applicants">
                          {x.applicants ?? 0}
                        </td>

                        <td className="num" data-label="Investment">
                          {money(x.investment ?? x.totalInvestment ?? 0)}
                        </td>

                        <td data-label="Allotments">
                          <span
                            className={
                              Number(x.allotments) > 0 ? "badge good" : "badge"
                            }
                          >
                            {x.allotments ?? 0}
                          </span>
                        </td>

                        <td className="num" data-label="Profit">
                          {money(x.profit)}
                        </td>

                        <td className="num" data-label="ROI">
                          {x.roi == null ? "—" : `${Number(x.roi).toFixed(2)}%`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* APPLICANTS */}
        {tab === "applicants" && (
          <section className="panel">
            <div className="toolbar">
              <input
                placeholder="Search applicant..."
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
              />
            </div>

            <div className="resultCount">
              Sensitive fields are masked for viewers.
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Depository</th>
                    <th>PAN</th>
                    <th>Beneficiary ID</th>
                  </tr>
                </thead>

                <tbody>
                  {apps
                    .filter((x) =>
                      String(x.name || "")
                        .toLowerCase()
                        .includes(appSearch.toLowerCase()),
                    )
                    .map((x, index) => (
                      <tr key={index}>
                        <td className="strong breakText" data-label="Applicant">
                          {x.name}
                        </td>

                        <td data-label="Depository">{x.depository}</td>

                        <td className="sensitiveValue" data-label="PAN">
                          {x.pan}
                        </td>

                        <td
                          className="sensitiveValue"
                          data-label="Beneficiary ID"
                        >
                          {x.beneficiaryId}
                        </td>
                      </tr>
                    ))}

                  {apps.filter((x) =>
                    String(x.name || "")
                      .toLowerCase()
                      .includes(appSearch.toLowerCase()),
                  ).length === 0 && (
                    <tr>
                      <td colSpan="4">No applicants found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ADMIN LOGIN */}
        {tab === "admin" && !admin && (
          <section className="adminLogin">
            <h2>Admin Login</h2>

            <p>
              Enter the Admin PIN to edit IPO and applicant details and view
              unmasked sensitive data.
            </p>

            <div className="adminControls">
              <input
                type="password"
                placeholder="Admin PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    adminLogin();
                  }
                }}
              />

              <button onClick={adminLogin}>Login</button>
            </div>
          </section>
        )}

        {/* ADMIN PANEL */}
        {tab === "admin" && admin && (
          <AdminPanel
            logout={logout}
            adminIpos={adminIpos}
            setAdminIpos={setAdminIpos}
            adminApps={adminApps}
            setAdminApps={setAdminApps}
            updateIpo={updateIpo}
            updateApp={updateApp}
            saveIpos={saveIpos}
            saveApps={saveApps}
            sync={sync}
            syncing={syncing}
            saving={saving}
          />
        )}

        <footer>Built with ❤️ by Varshil</footer>
      </main>

      {showBackToTop && (
        <button
          type="button"
          className="backToTop"
          onClick={scrollToTop}
          aria-label="Back to top"
          title="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}

// FILTER BAR
function FilterBar({
  search,
  setSearch,
  status,
  setStatus,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  sort,
  setSort,
  clearFilters,
}) {
  return (
    <div className="filters">
      <div className="toolbar filterMain">
        <input
          placeholder="Search IPO..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All status</option>
          <option value="allotted">Allotted</option>
          <option value="pending">No allotment</option>
        </select>

        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="dateDesc">Newest date</option>
          <option value="dateAsc">Oldest date</option>
          <option value="profit">Highest profit</option>
          <option value="investment">Highest investment</option>
          <option value="roi">Highest ROI</option>
          <option value="applicants">Most applicants</option>
        </select>
      </div>

      <div className="toolbar filterDates">
        <label>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>

        <button className="lightBtn clearBtn" onClick={clearFilters}>
          Clear
        </button>
      </div>
    </div>
  );
}

// ADMIN PANEL
function AdminPanel({
  logout,
  adminIpos,
  setAdminIpos,
  adminApps,
  setAdminApps,
  updateIpo,
  updateApp,
  saveIpos,
  saveApps,
  sync,
  syncing,
  saving,
}) {
  const [showIpoModal, setShowIpoModal] = useState(false);

  const [showApplicantModal, setShowApplicantModal] = useState(false);

  const [newIpo, setNewIpo] = useState(blankIpo());

  const [newApplicant, setNewApplicant] = useState(blankApplicant());

  const [editIpoIndex, setEditIpoIndex] = useState(null);

  const [editIpoDraft, setEditIpoDraft] = useState(null);

  const [editApplicantIndex, setEditApplicantIndex] = useState(null);

  const [editApplicantDraft, setEditApplicantDraft] = useState(null);

  const openEditIpoModal = (index) => {
    setEditIpoIndex(index);
    setEditIpoDraft({
      ...adminIpos[index],
    });
  };

  const closeEditIpoModal = () => {
    setEditIpoIndex(null);
    setEditIpoDraft(null);
  };

  const openEditApplicantModal = (index) => {
    setEditApplicantIndex(index);
    setEditApplicantDraft({
      ...adminApps[index],
    });
  };

  const closeEditApplicantModal = () => {
    setEditApplicantIndex(null);
    setEditApplicantDraft(null);
  };

  const saveEditIpo = () => {
    if (!String(editIpoDraft.name || "").trim()) {
      alert("Please enter the IPO name.");
      return;
    }

    if (!editIpoDraft.date) {
      alert("Please select the IPO date.");
      return;
    }

    const confirmed = window.confirm(`Save changes to "${editIpoDraft.name}"?`);

    if (!confirmed) {
      return;
    }

    const investment = Number(editIpoDraft.investment) || 0;

    const profit = Number(editIpoDraft.profit) || 0;

    const updatedIpo = {
      ...editIpoDraft,
      name: String(editIpoDraft.name).trim(),
      applicants: Number(editIpoDraft.applicants) || 0,
      retailAmount: Number(editIpoDraft.retailAmount) || 0,
      investment,
      allotments: Number(editIpoDraft.allotments) || 0,
      profit,
      roi: investment > 0 ? (profit / investment) * 100 : 0,
    };

    setAdminIpos((current) =>
      current.map((item, index) =>
        index === editIpoIndex ? updatedIpo : item,
      ),
    );

    closeEditIpoModal();
  };

  const saveEditApplicant = () => {
    if (!String(editApplicantDraft.name || "").trim()) {
      alert("Please enter the applicant name.");
      return;
    }

    if (!String(editApplicantDraft.pan || "").trim()) {
      alert("Please enter the PAN card number.");
      return;
    }

    if (!String(editApplicantDraft.beneficiaryId || "").trim()) {
      alert("Please enter the beneficiary ID.");
      return;
    }

    const confirmed = window.confirm(
      `Save changes to "${editApplicantDraft.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    const updatedApplicant = {
      ...editApplicantDraft,
      name: String(editApplicantDraft.name).trim(),
      depository: String(editApplicantDraft.depository).trim(),
      pan: String(editApplicantDraft.pan).trim().toUpperCase(),
      beneficiaryId: String(editApplicantDraft.beneficiaryId).trim(),
    };

    setAdminApps((current) =>
      current.map((item, index) =>
        index === editApplicantIndex ? updatedApplicant : item,
      ),
    );

    closeEditApplicantModal();
  };

  const openIpoModal = () => {
    setNewIpo(blankIpo());
    setShowIpoModal(true);
  };

  const closeIpoModal = () => {
    setShowIpoModal(false);
    setNewIpo(blankIpo());
  };

  const openApplicantModal = () => {
    setNewApplicant(blankApplicant());
    setShowApplicantModal(true);
  };

  const closeApplicantModal = () => {
    setShowApplicantModal(false);
    setNewApplicant(blankApplicant());
  };

  useEffect(() => {
    const anyModalOpen =
      showIpoModal ||
      showApplicantModal ||
      editIpoIndex !== null ||
      editApplicantIndex !== null;

    if (!anyModalOpen) {
      return;
    }

    const onKeyDown = (e) => {
      if (e.key !== "Escape") {
        return;
      }

      if (showIpoModal) {
        closeIpoModal();
      }

      if (showApplicantModal) {
        closeApplicantModal();
      }

      if (editIpoIndex !== null) {
        closeEditIpoModal();
      }

      if (editApplicantIndex !== null) {
        closeEditApplicantModal();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showIpoModal, showApplicantModal, editIpoIndex, editApplicantIndex]);

  const addIpo = () => {
    if (!String(newIpo.name || "").trim()) {
      alert("Please enter the IPO name.");
      return;
    }

    if (!newIpo.date) {
      alert("Please select the IPO date.");
      return;
    }

    const investment = Number(newIpo.investment) || 0;

    const profit = Number(newIpo.profit) || 0;

    const confirmed = window.confirm(
      "Are you sure you want to add this IPO?\n\n" +
        "IPO Name: " +
        newIpo.name +
        "\n" +
        "Date: " +
        newIpo.date +
        "\n" +
        "Applicants: " +
        newIpo.applicants +
        "\n" +
        "Retail Amount: " +
        newIpo.retailAmount +
        "\n" +
        "Investment: " +
        newIpo.investment +
        "\n" +
        "Allotments: " +
        newIpo.allotments +
        "\n" +
        "Profit: " +
        newIpo.profit,
    );

    if (!confirmed) {
      return;
    }

    const ipoToAdd = {
      ...newIpo,
      id: newIpo.id || Date.now(),
      name: String(newIpo.name).trim(),
      applicants: Number(newIpo.applicants) || 0,
      retailAmount: Number(newIpo.retailAmount) || 0,
      investment,
      allotments: Number(newIpo.allotments) || 0,
      profit,
      roi: investment > 0 ? (profit / investment) * 100 : 0,
    };

    setAdminIpos((current) => [...current, ipoToAdd]);

    closeIpoModal();
  };

  const addApplicant = () => {
    if (!String(newApplicant.name || "").trim()) {
      alert("Please enter the applicant name.");
      return;
    }

    if (!String(newApplicant.pan || "").trim()) {
      alert("Please enter the PAN card number.");
      return;
    }

    if (!String(newApplicant.beneficiaryId || "").trim()) {
      alert("Please enter the beneficiary ID.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to add this applicant?\n\n" +
        "Applicant: " +
        newApplicant.name +
        "\n" +
        "Depository: " +
        newApplicant.depository +
        "\n" +
        "PAN: " +
        newApplicant.pan +
        "\n" +
        "Beneficiary ID: " +
        newApplicant.beneficiaryId,
    );

    if (!confirmed) {
      return;
    }

    const applicantToAdd = {
      ...newApplicant,
      name: String(newApplicant.name).trim(),
      depository: String(newApplicant.depository).trim(),
      pan: String(newApplicant.pan).trim().toUpperCase(),
      beneficiaryId: String(newApplicant.beneficiaryId).trim(),
    };

    setAdminApps((current) => [...current, applicantToAdd]);

    closeApplicantModal();
  };

  const deleteIpo = (index, name) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete IPO "${name || "this IPO"}"?`,
    );

    if (!confirmed) {
      return;
    }

    setAdminIpos((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const deleteApplicant = (index, name) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete applicant "${
        name || "this applicant"
      }"?`,
    );

    if (!confirmed) {
      return;
    }

    setAdminApps((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  return (
    <section className="adminPanel">
      <div className="adminHeader">
        <div>
          <h2>Admin Panel</h2>
          <p>Manage your IPO activity with ease and precision.</p>
        </div>

        <div className="sectionTitleActions">
          <button className="lightBtn" onClick={logout}>
            Logout
          </button>

          <button onClick={sync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Google Sheets Now"}
          </button>
        </div>
      </div>

      <div className="adminSection">
        <div className="sectionTitle">
          <h3>IPO Details</h3>

          <div>
            <button className="lightBtn" onClick={openIpoModal}>
              + Add IPO
            </button>

            <button onClick={saveIpos} disabled={saving}>
              {saving ? "Saving..." : "Save IPO Changes"}
            </button>
          </div>
        </div>

        <div className="tableWrap">
          <table className="editTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>IPO Name</th>
                <th>Applicants</th>
                <th>Retail Amount</th>
                <th>Investment</th>
                <th>Allotments</th>
                <th>Profit</th>
                <th className="actionCol">Action</th>
              </tr>
            </thead>

            <tbody>
              {adminIpos.map((x, index) => (
                <tr key={x.id || index}>
                  <td data-label="Date">{dateFmt(x.date)}</td>

                  <td className="strong breakText" data-label="IPO Name">
                    {x.name}
                  </td>

                  <td className="num" data-label="Applicants">
                    {x.applicants ?? 0}
                  </td>

                  <td className="num" data-label="Retail Amount">
                    {money(x.retailAmount)}
                  </td>

                  <td className="num" data-label="Investment">
                    {money(x.investment ?? x.totalInvestment ?? 0)}
                  </td>

                  <td className="num" data-label="Allotments">
                    {x.allotments ?? 0}
                  </td>

                  <td className="num" data-label="Profit">
                    {money(x.profit)}
                  </td>

                  <td className="actionCol" data-label="Action">
                    <div className="actionsCell">
                      <button
                        type="button"
                        className="lightBtn"
                        onClick={() => openEditIpoModal(index)}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="dangerBtn"
                        onClick={() => deleteIpo(index, x.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {adminIpos.length === 0 && (
                <tr>
                  <td colSpan="8">No IPO records.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adminSection">
        <div className="sectionTitle">
          <h3>Applicant Details</h3>

          <div>
            <button className="lightBtn" onClick={openApplicantModal}>
              + Add Applicant
            </button>

            <button onClick={saveApps} disabled={saving}>
              {saving ? "Saving..." : "Save Applicant Changes"}
            </button>
          </div>
        </div>

        <div className="tableWrap">
          <table className="editTable">
            <thead>
              <tr>
                <th>Applicant Name</th>
                <th>Depository</th>
                <th>PAN Card Number</th>
                <th>Beneficiary Number/ID</th>
                <th className="actionCol">Action</th>
              </tr>
            </thead>

            <tbody>
              {adminApps.map((x, index) => (
                <tr key={index}>
                  <td className="strong breakText" data-label="Applicant Name">
                    {x.name}
                  </td>

                  <td data-label="Depository">{x.depository}</td>

                  <td className="sensitiveValue" data-label="PAN Card Number">
                    {x.pan}
                  </td>

                  <td
                    className="sensitiveValue"
                    data-label="Beneficiary Number/ID"
                  >
                    {x.beneficiaryId}
                  </td>

                  <td className="actionCol" data-label="Action">
                    <div className="actionsCell">
                      <button
                        type="button"
                        className="lightBtn"
                        onClick={() => openEditApplicantModal(index)}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="dangerBtn"
                        onClick={() => deleteApplicant(index, x.name)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {adminApps.length === 0 && (
                <tr>
                  <td colSpan="5">No applicant records.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD IPO MODAL */}
      {showIpoModal && (
        <div
          className="modalOverlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeIpoModal();
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <h2>Add New IPO</h2>
                <p>Enter the IPO details before adding it.</p>
              </div>

              <button
                type="button"
                className="modalClose"
                onClick={closeIpoModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modalForm">
              <label>
                IPO Date
                <input
                  type="date"
                  value={dateInput(newIpo.date)}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      date: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                IPO Name
                <input
                  type="text"
                  placeholder="Enter IPO name"
                  value={newIpo.name}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      name: e.target.value,
                    })
                  }
                  autoFocus
                />
              </label>

              <label>
                Applicants
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newIpo.applicants}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      applicants: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Retail Amount
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newIpo.retailAmount}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      retailAmount: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Total Investment
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newIpo.investment}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      investment: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Allotments
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newIpo.allotments}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      allotments: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Profit
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={newIpo.profit}
                  onChange={(e) =>
                    setNewIpo({
                      ...newIpo,
                      profit: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="modalActions">
              <button
                type="button"
                className="lightBtn"
                onClick={closeIpoModal}
              >
                Cancel
              </button>

              <button type="button" onClick={addIpo}>
                Add IPO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD APPLICANT MODAL */}
      {showApplicantModal && (
        <div
          className="modalOverlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeApplicantModal();
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <h2>Add New Applicant</h2>
                <p>Enter the applicant details before adding.</p>
              </div>

              <button
                type="button"
                className="modalClose"
                onClick={closeApplicantModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modalForm">
              <label>
                Applicant Name
                <input
                  type="text"
                  placeholder="Enter applicant name"
                  value={newApplicant.name}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      name: e.target.value,
                    })
                  }
                  autoFocus
                />
              </label>

              <label>
                Depository
                <select
                  value={newApplicant.depository}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      depository: e.target.value,
                    })
                  }
                >
                  <option value="CDSL">CDSL</option>
                  <option value="NSDL">NSDL</option>
                </select>
              </label>

              <label>
                PAN Card Number
                <input
                  type="text"
                  placeholder="Enter PAN number"
                  value={newApplicant.pan}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      pan: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label>
                Beneficiary Number / ID
                <input
                  type="text"
                  placeholder="Enter beneficiary ID"
                  value={newApplicant.beneficiaryId}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      beneficiaryId: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="modalActions">
              <button
                type="button"
                className="lightBtn"
                onClick={closeApplicantModal}
              >
                Cancel
              </button>

              <button type="button" onClick={addApplicant}>
                Add Applicant
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT IPO MODAL */}
      {editIpoIndex !== null && editIpoDraft && (
        <div
          className="modalOverlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeEditIpoModal();
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <h2>Edit IPO</h2>
                <p>Update the IPO details below.</p>
              </div>

              <button
                type="button"
                className="modalClose"
                onClick={closeEditIpoModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modalForm">
              <label>
                IPO Date
                <input
                  type="date"
                  value={dateInput(editIpoDraft.date)}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      date: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                IPO Name
                <input
                  type="text"
                  placeholder="Enter IPO name"
                  value={editIpoDraft.name}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      name: e.target.value,
                    })
                  }
                  autoFocus
                />
              </label>

              <label>
                Applicants
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={editIpoDraft.applicants}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      applicants: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Retail Amount
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={editIpoDraft.retailAmount}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      retailAmount: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Total Investment
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={editIpoDraft.investment}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      investment: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Allotments
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={editIpoDraft.allotments}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      allotments: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Profit
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={editIpoDraft.profit}
                  onChange={(e) =>
                    setEditIpoDraft({
                      ...editIpoDraft,
                      profit: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="modalActions">
              <button
                type="button"
                className="lightBtn"
                onClick={closeEditIpoModal}
              >
                Cancel
              </button>

              <button type="button" onClick={saveEditIpo}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT APPLICANT MODAL */}
      {editApplicantIndex !== null && editApplicantDraft && (
        <div
          className="modalOverlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeEditApplicantModal();
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <h2>Edit Applicant</h2>
                <p>Update the applicant details below.</p>
              </div>

              <button
                type="button"
                className="modalClose"
                onClick={closeEditApplicantModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modalForm">
              <label>
                Applicant Name
                <input
                  type="text"
                  placeholder="Enter applicant name"
                  value={editApplicantDraft.name}
                  onChange={(e) =>
                    setEditApplicantDraft({
                      ...editApplicantDraft,
                      name: e.target.value,
                    })
                  }
                  autoFocus
                />
              </label>

              <label>
                Depository
                <select
                  value={editApplicantDraft.depository}
                  onChange={(e) =>
                    setEditApplicantDraft({
                      ...editApplicantDraft,
                      depository: e.target.value,
                    })
                  }
                >
                  <option value="CDSL">CDSL</option>
                  <option value="NSDL">NSDL</option>
                </select>
              </label>

              <label>
                PAN Card Number
                <input
                  type="text"
                  placeholder="Enter PAN number"
                  value={editApplicantDraft.pan}
                  onChange={(e) =>
                    setEditApplicantDraft({
                      ...editApplicantDraft,
                      pan: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label>
                Beneficiary Number / ID
                <input
                  type="text"
                  placeholder="Enter beneficiary ID"
                  value={editApplicantDraft.beneficiaryId}
                  onChange={(e) =>
                    setEditApplicantDraft({
                      ...editApplicantDraft,
                      beneficiaryId: e.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="modalActions">
              <button
                type="button"
                className="lightBtn"
                onClick={closeEditApplicantModal}
              >
                Cancel
              </button>

              <button type="button" onClick={saveEditApplicant}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// CARD
function Card({ label, value }) {
  return (
    <div className="card">
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
