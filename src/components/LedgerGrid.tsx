"use client";
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { StatusBadge } from "./StatusBadge";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface LedgerRow {
  id: string; created_at: string; team: string; requester: string; title: string; merchant: string; category: string;
  amount: number; status: string; paypal_order_id: string; paypal_status: string; decided_by: string; reason: string;
}

const theme = themeQuartz.withParams({
  accentColor: "#4f46e5",
  borderRadius: 10,
  headerBackgroundColor: "#f8fafc",
  fontFamily: "inherit",
  rowHoverColor: "#eef2ff",
});

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const FILTERS = ["ALL", "PAID", "PENDING_APPROVAL", "REFUSED", "DECLINED", "FAILED"] as const;
const LABEL: Record<string, string> = { ALL: "All", PAID: "Paid", PENDING_APPROVAL: "Awaiting approval", REFUSED: "Refused", DECLINED: "Declined", FAILED: "Failed" };

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const shown = useMemo(() => (filter === "ALL" ? rows : rows.filter((r) => r.status === filter)), [rows, filter]);
  const totals = useMemo(
    () => [{ title: `${shown.length} requests`, amount: shown.filter((r) => r.status === "PAID").reduce((s, r) => s + r.amount, 0), status: "", requester: "Paid total" }],
    [shown],
  );

  const cols = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "created_at", headerName: "Date", width: 150, sort: "desc", valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "") },
      { field: "team", width: 120, filter: true },
      { field: "requester", width: 140, filter: true },
      { field: "title", headerName: "Item", flex: 2, minWidth: 220, filter: true, tooltipField: "title" },
      { field: "merchant", headerName: "Store", width: 140 },
      { field: "category", width: 130, filter: true },
      { field: "amount", width: 120, type: "rightAligned", valueFormatter: (p) => (typeof p.value === "number" ? money(p.value) : "") },
      { field: "status", width: 190, cellRenderer: (p: ICellRendererParams<LedgerRow>) => (p.value ? <StatusBadge status={p.value} /> : null) },
      { field: "paypal_order_id", headerName: "PayPal order", width: 190, cellClass: "font-mono text-xs" },
      { field: "decided_by", headerName: "Decided by", width: 130 },
      { field: "reason", flex: 2, minWidth: 260, tooltipField: "reason" },
    ],
    [],
  );

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filter === f ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {LABEL[f]} ({f === "ALL" ? rows.length : rows.filter((r) => r.status === f).length})
          </button>
        ))}
      </div>
      <div style={{ height: 520 }}>
        <AgGridReact<LedgerRow>
          theme={theme}
          rowData={shown}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true }}
          pinnedBottomRowData={totals as LedgerRow[]}
          getRowId={(p) => p.data.id ?? "total"}
          overlayNoRowsTemplate="No purchases yet. Ask the buying agent for something."
          tooltipShowDelay={300}
        />
      </div>
    </section>
  );
}
