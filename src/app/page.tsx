"use client";

import {
  Activity,
  ArrowDownUp,
  BarChart3,
  CalendarRange,
  Database,
  ExternalLink,
  FileJson,
  Filter,
  Flame,
  LineChart,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Status = "TRADEABLE" | "NOT TRADEABLE";
type ActiveTab = "list" | "gex" | "backtest";

type TickerSummary = {
  ticker: string;
  sector: string;
  industry: string;
  score: number;
  status: Status;
  stage: string;
  trend: string;
  rsRank: number;
  relVolume: number;
  pctFromHigh: number;
  price: number;
  flowBias: string;
  reasons: string[];
  priceHistory: number[];
  rsHistory: number[];
};

type GexRow = {
  strike: number;
  netGex: number;
  netVex: number;
};

type BacktestRow = {
  strike: number;
  dte: number;
  winRate: number;
  avgReturn: number;
  sampleSize: number;
};

type SortKey =
  | "ticker"
  | "sector"
  | "score"
  | "status"
  | "stage"
  | "trend"
  | "rsRank"
  | "relVolume"
  | "pctFromHigh"
  | "flowBias";

const sampleRows: TickerSummary[] = [
  {
    ticker: "NVDA",
    sector: "Technology",
    industry: "Semiconductors",
    score: 94,
    status: "TRADEABLE",
    stage: "2",
    trend: "Uptrend",
    rsRank: 98,
    relVolume: 1.7,
    pctFromHigh: -3.8,
    price: 148.12,
    flowBias: "Bullish",
    reasons: ["RS new high", "Above 50/200 MA", "Constructive volume"],
    priceHistory: [122, 125, 128, 131, 130, 137, 141, 144, 148],
    rsHistory: [88, 89, 90, 91, 90, 94, 96, 97, 98],
  },
  {
    ticker: "LLY",
    sector: "Health Care",
    industry: "Pharmaceuticals",
    score: 88,
    status: "TRADEABLE",
    stage: "2",
    trend: "Uptrend",
    rsRank: 91,
    relVolume: 1.2,
    pctFromHigh: -6.4,
    price: 912.48,
    flowBias: "Neutral",
    reasons: ["Tight pullback", "RS leadership"],
    priceHistory: [840, 852, 860, 875, 890, 881, 902, 910, 912],
    rsHistory: [84, 85, 86, 88, 89, 87, 90, 91, 91],
  },
  {
    ticker: "TSLA",
    sector: "Consumer Discretionary",
    industry: "Automobiles",
    score: 49,
    status: "NOT TRADEABLE",
    stage: "3",
    trend: "Sideways",
    rsRank: 54,
    relVolume: 0.9,
    pctFromHigh: -31.2,
    price: 231.2,
    flowBias: "Bearish",
    reasons: ["Below RS threshold", "Choppy trend"],
    priceHistory: [250, 246, 241, 238, 229, 235, 232, 228, 231],
    rsHistory: [61, 59, 56, 55, 52, 55, 54, 53, 54],
  },
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const compactNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const importedRowsStorageKey = "trade-confluence:imported-rows";

export default function Home() {
  const initialQuery = getInitialQueryState();
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialQuery.tab);
  const [rows, setRows] = useState<TickerSummary[]>(sampleRows);
  const [selectedTicker, setSelectedTicker] = useState(initialQuery.ticker);
  const [selectedRow, setSelectedRow] = useState<TickerSummary | null>(sampleRows[0]);
  const [importName, setImportName] = useState("Sample import");
  const [importError, setImportError] = useState("");
  const [tradeableOnly, setTradeableOnly] = useState(true);
  const [sector, setSector] = useState("All");
  const [stage, setStage] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [gexMetric, setGexMetric] = useState<"netGex" | "netVex">("netGex");
  const [gexRows, setGexRows] = useState<GexRow[]>([]);
  const [gexPrice, setGexPrice] = useState<number | null>(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexError, setGexError] = useState("");
  const [backtestRows, setBacktestRows] = useState<BacktestRow[]>([]);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [setupType, setSetupType] = useState("stage-2-rs-high");
  const [dateFrom, setDateFrom] = useState("2025-01-01");
  const [dateTo, setDateTo] = useState("2026-06-30");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.setTimeout(() => {
      const cached = readCachedRows();
      if (!cached) return;
      setRows(cached.rows);
      setImportName(cached.importName);
      setSelectedRow(cached.rows[0] ?? null);
      if (cached.rows[0]) setSelectedTicker(cached.rows[0].ticker);
    }, 0);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserEmail(data.session?.user.email ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const metrics = useMemo(() => {
    const total = rows.length;
    const tradeable = rows.filter((row) => row.status === "TRADEABLE").length;
    const avgScore = total
      ? rows.reduce((sum, row) => sum + row.score, 0) / total
      : 0;
    return {
      total,
      tradeable,
      notTradeable: total - tradeable,
      avgScore,
    };
  }, [rows]);

  const sectors = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((row) => row.sector).filter(Boolean))).sort()],
    [rows],
  );

  const stages = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((row) => row.stage).filter(Boolean))).sort()],
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalized = [...rows].filter((row) => {
      if (tradeableOnly && row.status !== "TRADEABLE") return false;
      if (sector !== "All" && row.sector !== sector) return false;
      if (stage !== "All" && row.stage !== stage) return false;
      if (row.score < minScore) return false;
      return true;
    });

    normalized.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? result : -result;
    });

    return normalized;
  }, [rows, tradeableOnly, sector, stage, minScore, sortKey, sortDir]);

  const sparklineData = useMemo(() => {
    if (!selectedRow) return [];
    return selectedRow.priceHistory.map((price, index) => ({
      index,
      price,
      rs: selectedRow.rsHistory[index] ?? null,
    }));
  }, [selectedRow]);

  const walls = useMemo(() => {
    if (!gexRows.length) return null;
    const putWall = [...gexRows].sort((a, b) => b.netGex - a.netGex)[0];
    const callWall = [...gexRows].sort((a, b) => a.netGex - b.netGex)[0];
    const flip = findZeroGammaFlip(gexRows, gexPrice);
    return { putWall, callWall, flip };
  }, [gexRows, gexPrice]);

  async function handleImport(file: File) {
    setImportError("");
    try {
      const parsed = JSON.parse(await file.text());
      const flattened = flattenImport(parsed);
      if (!flattened.length) {
        throw new Error("No ticker entries were found in this export.");
      }
      setRows(flattened);
      setSelectedRow(flattened[0]);
      setSelectedTicker(flattened[0].ticker);
      setImportName(file.name);
      cacheRows(flattened, file.name);
      void fetch("/api/tickers/import-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: flattened.map(toPersistableTicker) }),
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    }
  }

  function navigate(tab: ActiveTab, ticker = selectedTicker) {
    const nextTicker = ticker.toUpperCase();
    setActiveTab(tab);
    setSelectedTicker(nextTicker);
    const params = new URLSearchParams({ tab, ticker: nextTicker });
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function updateSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("desc");
  }

  async function fetchGex() {
    setGexLoading(true);
    setGexError("");
    try {
      const response = await fetch(`/api/bullflow/gex-vex?ticker=${encodeURIComponent(selectedTicker)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load GEX/VEX data.");
      setGexRows(data.rows);
      setGexPrice(data.currentPrice ?? null);
    } catch (error) {
      setGexError(error instanceof Error ? error.message : "Unable to load GEX/VEX data.");
      setGexRows([]);
    } finally {
      setGexLoading(false);
    }
  }

  async function runBacktest() {
    setBacktestLoading(true);
    setBacktestError("");
    try {
      const response = await fetch("/api/bullflow/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: selectedTicker,
          setupType,
          dateFrom,
          dateTo,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to run backtest.");
      setBacktestRows(data.rows);
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : "Unable to run backtest.");
      setBacktestRows([]);
    } finally {
      setBacktestLoading(false);
    }
  }

  async function signInWithGoogle() {
    setAuthError("");
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setAuthError("Supabase public URL and anon key are not configured.");
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
      },
    });
    if (error) setAuthError(error.message);
  }

  async function signOut() {
    const supabase = getSupabaseBrowser();
    if (supabase) await supabase.auth.signOut();
  }

  return (
    <main className="min-h-screen bg-[#f4f2ee] text-[#1f2933]">
      <section className="border-b border-[#d7d2c8] bg-[#fbfaf7]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#55705f]">
                RS + Flow Workbench
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-[#192126] sm:text-4xl">
                Trade confluence dashboard
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex h-10 max-w-full items-center gap-2 rounded-md border border-dashed border-[#9ba892] bg-white px-2 text-sm"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void handleImport(file);
                }}
              >
                <Upload className="shrink-0 text-[#55705f]" size={16} />
                <span className="hidden max-w-48 truncate text-[#66706a] sm:inline">{importName}</span>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleImport(file);
                  }}
                />
                <button
                  className="inline-flex h-7 items-center gap-1 rounded bg-[#edf3ea] px-2 text-xs font-bold text-[#31593d] hover:bg-[#dce8d7]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileJson size={13} />
                  Import JSON
                </button>
              </div>
              <TickerInput value={selectedTicker} onChange={setSelectedTicker} />
              {userEmail ? (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b8c1b3] bg-white px-3 text-sm font-semibold text-[#1f2933] hover:bg-[#edf3ea]"
                  onClick={signOut}
                  title={userEmail}
                >
                  Sign out
                </button>
              ) : (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b8c1b3] bg-white px-3 text-sm font-semibold text-[#1f2933] hover:bg-[#edf3ea]"
                  onClick={signInWithGoogle}
                >
                  Sign in
                </button>
              )}
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1f2933] px-3 text-sm font-semibold text-white hover:bg-[#111820]"
                onClick={() => navigate("gex")}
              >
                <BarChart3 size={16} />
                GEX/VEX
              </button>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b8c1b3] bg-white px-3 text-sm font-semibold text-[#1f2933] hover:bg-[#edf3ea]"
                onClick={() => navigate("backtest")}
              >
                <CalendarRange size={16} />
                Backtest
              </button>
            </div>
          </div>
          {(authError || importError) && (
            <p className="text-sm font-medium text-[#a33d2f]">{authError || importError}</p>
          )}
          <nav className="flex flex-wrap gap-2">
            <TabButton active={activeTab === "list"} onClick={() => navigate("list")} icon={<FileJson size={16} />} label="Tradeable List" />
            <TabButton active={activeTab === "gex"} onClick={() => navigate("gex")} icon={<BarChart3 size={16} />} label="GEX / VEX Map" />
            <TabButton active={activeTab === "backtest"} onClick={() => navigate("backtest")} icon={<LineChart size={16} />} label="Strike Backtester" />
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === "list" && (
          <section className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Total scanned" value={metrics.total.toString()} icon={<Database size={18} />} />
                <Metric label="Tradeable" value={metrics.tradeable.toString()} icon={<Flame size={18} />} />
                <Metric label="Not tradeable" value={metrics.notTradeable.toString()} icon={<Activity size={18} />} />
                <Metric label="Average score" value={metrics.avgScore.toFixed(1)} icon={<LineChart size={18} />} />
              </div>

              <section className="rounded-lg border border-[#d7d2c8] bg-[#fbfaf7] p-4">
                {selectedRow ? (
                  <div className="grid gap-4 lg:grid-cols-[280px_minmax(280px,1fr)_300px] lg:items-center">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-2xl font-bold">{selectedRow.ticker}</h2>
                          <p className="text-sm text-[#66706a]">{selectedRow.sector} / {selectedRow.industry}</p>
                        </div>
                        <StatusBadge status={selectedRow.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <MiniStat label="Price" value={currency.format(selectedRow.price)} />
                        <MiniStat label="Score" value={selectedRow.score.toString()} />
                        <MiniStat label="RS rank" value={formatRsRank(selectedRow.rsRank)} />
                        <MiniStat label="Flow bias" value={selectedRow.flowBias} />
                      </div>
                    </div>
                    <div className="h-44 min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={sparklineData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                          <CartesianGrid stroke="#e4ded3" vertical={false} />
                          <XAxis dataKey="index" hide />
                          <YAxis hide domain={["dataMin", "dataMax"]} />
                          <Tooltip />
                          <Area type="monotone" dataKey="price" stroke="#55705f" fill="#dce8d7" strokeWidth={2} />
                          <Line type="monotone" dataKey="rs" stroke="#b76742" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1f2933] px-3 text-sm font-semibold text-white" onClick={() => navigate("gex", selectedRow.ticker)}>
                          <ExternalLink size={15} />
                          View GEX/VEX map
                        </button>
                        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c1b3] bg-white px-3 text-sm font-semibold" onClick={() => navigate("backtest", selectedRow.ticker)}>
                          <ExternalLink size={15} />
                          Backtest this setup
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedRow.reasons.slice(0, 3).map((reason) => (
                          <p key={reason} className="rounded-md bg-[#eeeae2] px-3 py-2 text-xs">{reason}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#66706a]">Select a ticker to inspect its RS and price context.</p>
                )}
              </section>

              <div className="rounded-lg border border-[#d7d2c8] bg-[#fbfaf7]">
                <div className="flex flex-col gap-4 border-b border-[#d7d2c8] p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Filter size={16} />
                    Filters
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={tradeableOnly}
                        onChange={(event) => setTradeableOnly(event.target.checked)}
                      />
                      TRADEABLE only
                    </label>
                    <select className="h-9 rounded-md border border-[#c9c3b8] bg-white px-2 text-sm" value={sector} onChange={(event) => setSector(event.target.value)}>
                      {sectors.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <select className="h-9 rounded-md border border-[#c9c3b8] bg-white px-2 text-sm" value={stage} onChange={(event) => setStage(event.target.value)}>
                      {stages.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="whitespace-nowrap">Min {minScore}</span>
                      <input className="w-full accent-[#55705f]" type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} />
                    </label>
                  </div>
                </div>
                <div>
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-[#e9e5dc] text-xs uppercase text-[#56615b]">
                      <tr>
                        {[
                          ["ticker", "Ticker", "w-[76px]"],
                          ["sector", "Sector", ""],
                          ["score", "Score", "w-[72px]"],
                          ["status", "Status", "hidden md:table-cell w-[116px]"],
                          ["stage", "Stage", "hidden lg:table-cell w-[72px]"],
                          ["trend", "Trend", "hidden xl:table-cell w-[106px]"],
                          ["rsRank", "RS", "hidden sm:table-cell w-[64px]"],
                          ["relVolume", "Vol", "hidden xl:table-cell w-[70px]"],
                          ["pctFromHigh", "High", "hidden 2xl:table-cell w-[82px]"],
                          ["flowBias", "Flow", "hidden lg:table-cell w-[92px]"],
                        ].map(([key, label, className]) => (
                          <th key={key} className={`px-3 py-3 ${className}`}>
                            <button className="inline-flex items-center gap-1 font-semibold" onClick={() => updateSort(key as SortKey)}>
                              {label}
                              <ArrowDownUp size={12} />
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4ded3]">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.ticker}
                          className="cursor-pointer hover:bg-[#f0eee7]"
                          onClick={() => {
                            setSelectedRow(row);
                            setSelectedTicker(row.ticker);
                          }}
                        >
                          <td className="px-3 py-3 font-bold">{row.ticker}</td>
                          <td className="truncate px-3 py-3">{row.sector || "Unclassified"}</td>
                          <td className="px-3 py-3 font-semibold">{row.score}</td>
                          <td className="hidden px-3 py-3 md:table-cell"><StatusBadge status={row.status} /></td>
                          <td className="hidden px-3 py-3 lg:table-cell">{row.stage}</td>
                          <td className="hidden truncate px-3 py-3 xl:table-cell">{row.trend}</td>
                          <td className="hidden px-3 py-3 sm:table-cell">
                            <ScoreBadge value={formatRsRank(row.rsRank)} />
                          </td>
                          <td className="hidden whitespace-nowrap px-3 py-3 xl:table-cell">{formatRelVolume(row.relVolume)}</td>
                          <td className="hidden px-3 py-3 2xl:table-cell">{percent.format(row.pctFromHigh)}%</td>
                          <td className="hidden px-3 py-3 lg:table-cell">{row.flowBias}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
          </section>
        )}

        {activeTab === "gex" && (
          <section className="space-y-5">
            <PanelTitle icon={<BarChart3 size={18} />} title="GEX / VEX by strike" subtitle="Live Bullflow data is requested through a server-only API route and is not stored in Postgres." />
            <div className="flex flex-wrap items-center gap-3">
              <TickerInput value={selectedTicker} onChange={setSelectedTicker} />
              <div className="inline-flex rounded-md border border-[#c9c3b8] bg-white p-1">
                <button className={`rounded px-3 py-1.5 text-sm font-semibold ${gexMetric === "netGex" ? "bg-[#1f2933] text-white" : ""}`} onClick={() => setGexMetric("netGex")}>GEX</button>
                <button className={`rounded px-3 py-1.5 text-sm font-semibold ${gexMetric === "netVex" ? "bg-[#1f2933] text-white" : ""}`} onClick={() => setGexMetric("netVex")}>VEX</button>
              </div>
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1f2933] px-3 text-sm font-semibold text-white" onClick={fetchGex} disabled={gexLoading}>
                {gexLoading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                Fetch map
              </button>
            </div>
            {gexError && <p className="rounded-md border border-[#e0b5aa] bg-[#fff4f1] px-3 py-2 text-sm font-medium text-[#a33d2f]">{gexError}</p>}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="h-[480px] rounded-lg border border-[#d7d2c8] bg-[#fbfaf7] p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gexRows} margin={{ left: 8, right: 18, top: 20, bottom: 20 }}>
                    <CartesianGrid stroke="#e4ded3" vertical={false} />
                    <XAxis dataKey="strike" />
                    <YAxis />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#1f2933" />
                    {gexPrice && <ReferenceLine x={gexPrice} stroke="#b76742" label="Price" />}
                    <Bar dataKey={gexMetric}>
                      {gexRows.map((row) => (
                        <Cell key={row.strike} fill={row[gexMetric] >= 0 ? "#55705f" : "#b76742"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-lg border border-[#d7d2c8] bg-[#fbfaf7] p-4">
                <h2 className="text-base font-bold">Auto labels</h2>
                <div className="mt-4 space-y-3">
                  <MiniStat label="Current price" value={gexPrice ? currency.format(gexPrice) : "Fetch required"} />
                  <MiniStat label="Put wall" value={walls?.putWall ? `${walls.putWall.strike}` : "-"} />
                  <MiniStat label="Call wall" value={walls?.callWall ? `${walls.callWall.strike}` : "-"} />
                  <MiniStat label="Zero-gamma flip" value={walls?.flip ? `${walls.flip}` : "-"} />
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "backtest" && (
          <section className="space-y-5">
            <PanelTitle icon={<CalendarRange size={18} />} title="Strike / expiration backtester" subtitle="Historical, not predictive. Every win rate and return statistic includes sample size." />
            <div className="grid gap-3 rounded-lg border border-[#d7d2c8] bg-[#fbfaf7] p-4 md:grid-cols-5">
              <TickerInput value={selectedTicker} onChange={setSelectedTicker} />
              <select className="h-10 rounded-md border border-[#c9c3b8] bg-white px-2 text-sm" value={setupType} onChange={(event) => setSetupType(event.target.value)}>
                <option value="stage-2-rs-high">Stage 2 + RS new high</option>
                <option value="bullish-flow">Bullish flow bias</option>
                <option value="pullback-leader">Pullback leader</option>
              </select>
              <input className="h-10 rounded-md border border-[#c9c3b8] bg-white px-2 text-sm" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <input className="h-10 rounded-md border border-[#c9c3b8] bg-white px-2 text-sm" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1f2933] px-3 text-sm font-semibold text-white" onClick={runBacktest} disabled={backtestLoading}>
                {backtestLoading ? <Loader2 className="animate-spin" size={16} /> : <Activity size={16} />}
                Run
              </button>
            </div>
            {backtestError && <p className="rounded-md border border-[#e0b5aa] bg-[#fff4f1] px-3 py-2 text-sm font-medium text-[#a33d2f]">{backtestError}</p>}
            <div className="overflow-x-auto rounded-lg border border-[#d7d2c8] bg-[#fbfaf7]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[#e9e5dc] text-xs uppercase text-[#56615b]">
                  <tr>
                    <th className="px-3 py-3">Strike</th>
                    <th className="px-3 py-3">DTE</th>
                    <th className="px-3 py-3">Win rate with n</th>
                    <th className="px-3 py-3">Average peak return with n</th>
                    <th className="px-3 py-3">Sample size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4ded3]">
                  {backtestRows.map((row) => (
                    <tr key={`${row.strike}-${row.dte}`}>
                      <td className="px-3 py-3 font-semibold">{row.strike}</td>
                      <td className="px-3 py-3">{row.dte}</td>
                      <td className="px-3 py-3">{percent.format(row.winRate)}% (n={row.sampleSize})</td>
                      <td className="px-3 py-3">{percent.format(row.avgReturn)}% (n={row.sampleSize})</td>
                      <td className="px-3 py-3">{row.sampleSize}</td>
                    </tr>
                  ))}
                  {!backtestRows.length && (
                    <tr>
                      <td className="px-3 py-8 text-center text-[#66706a]" colSpan={5}>Run a historical backtest to populate aggregated rows.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function flattenImport(payload: unknown): TickerSummary[] {
  return extractImportEntries(payload)
    .map((entry) => {
      const item = asRecord(entry);
      const qualification = asRecord(item.qualification);
      const snapshot = asRecord(item.rs_snapshot);
      const flow = asRecord(item.flow);
      const status: Status = qualification.status === "TRADEABLE" ? "TRADEABLE" : "NOT TRADEABLE";
      return {
        ticker: String(item.ticker ?? "").toUpperCase(),
        sector: String(snapshot.sector ?? "Unclassified"),
        industry: String(snapshot.industry ?? "Unclassified"),
        score: Number(qualification.score ?? 0),
        status,
        stage: String(snapshot.stage ?? "-"),
        trend: String(snapshot.trend ?? "-"),
        rsRank: normalizeRsRank(snapshot.rs_rank),
        relVolume: Number(snapshot.rel_volume ?? 0),
        pctFromHigh: normalizePercentValue(snapshot.pct_from_high),
        price: Number(snapshot.price ?? 0),
        flowBias: String(flow.bias ?? "Unknown"),
        reasons: Array.isArray(qualification.reasons) ? qualification.reasons.map(String) : [],
        priceHistory: normalizeHistory(snapshot.price_history, "price"),
        rsHistory: normalizeHistory(snapshot.rs_history, "rs"),
      };
    })
    .filter((row) => row.ticker);
}

function extractImportEntries(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (Array.isArray(root.tickers)) return root.tickers;

  const groups = asRecord(root.trade_context);
  return Object.values(groups).flatMap((group) => {
    if (Array.isArray(group)) return group;

    const nested = asRecord(group);
    return Object.values(nested).flatMap((value) => (Array.isArray(value) ? value : []));
  });
}

function readCachedRows(): { rows: TickerSummary[]; importName: string } | null {
  try {
    const raw = window.localStorage.getItem(importedRowsStorageKey);
    if (!raw) return null;
    const parsed = asRecord(JSON.parse(raw));
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    if (!rows.length) return null;
    return {
      rows: rows.map(normalizeCachedRow).filter(Boolean) as TickerSummary[],
      importName: String(parsed.importName ?? "Cached import"),
    };
  } catch {
    return null;
  }
}

function cacheRows(rows: TickerSummary[], importName: string) {
  try {
    window.localStorage.setItem(importedRowsStorageKey, JSON.stringify({ rows, importName }));
  } catch {
    // The import still works in memory if browser storage is unavailable.
  }
}

function normalizeCachedRow(value: unknown): TickerSummary | null {
  const row = asRecord(value);
  const ticker = String(row.ticker ?? "").toUpperCase();
  if (!ticker) return null;

  return {
    ticker,
    sector: String(row.sector ?? "Unclassified"),
    industry: String(row.industry ?? "Unclassified"),
    score: Number(row.score ?? 0),
    status: row.status === "TRADEABLE" ? "TRADEABLE" : "NOT TRADEABLE",
    stage: String(row.stage ?? "-"),
    trend: String(row.trend ?? "-"),
    rsRank: normalizeRsRank(row.rsRank),
    relVolume: Number(row.relVolume ?? 0),
    pctFromHigh: normalizePercentValue(row.pctFromHigh),
    price: Number(row.price ?? 0),
    flowBias: String(row.flowBias ?? "Unknown"),
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    priceHistory: Array.isArray(row.priceHistory) ? row.priceHistory.map(Number) : [],
    rsHistory: Array.isArray(row.rsHistory) ? row.rsHistory.map(Number) : [],
  };
}

function getInitialQueryState(): { tab: ActiveTab; ticker: string } {
  if (typeof window === "undefined") return { tab: "list", ticker: "NVDA" };

  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const ticker = params.get("ticker");

  return {
    tab: tab === "gex" || tab === "backtest" || tab === "list" ? tab : "list",
    ticker: ticker ? ticker.toUpperCase() : "NVDA",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizePercentValue(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function normalizeRsRank(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function formatRsRank(value: number) {
  return compactNumber.format(Math.round(value * 10) / 10);
}

function formatRelVolume(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${compactNumber.format(value)}x`;
}

function normalizeHistory(value: unknown, key: string): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (typeof point === "number") return point;
      if (point && typeof point === "object") return Number((point as Record<string, unknown>)[key] ?? (point as Record<string, unknown>).value);
      return 0;
    })
    .filter((point) => Number.isFinite(point));
}

function toPersistableTicker(row: TickerSummary) {
  return {
    ticker: row.ticker,
    sector: row.sector,
    latest_score: row.score,
    latest_status: row.status,
    latest_stage: row.stage,
    latest_trend: row.trend,
    latest_price: row.price,
  };
}

function findZeroGammaFlip(rows: GexRow[], price: number | null) {
  const candidates = [...rows]
    .sort((a, b) => a.strike - b.strike)
    .filter((row, index, sorted) => index > 0 && Math.sign(row.netGex) !== Math.sign(sorted[index - 1].netGex));
  if (!candidates.length) return null;
  if (!price) return candidates[0].strike;
  return candidates.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0].strike;
}

function TickerInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">Ticker</span>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#66706a]" size={16} />
      <input
        className="h-10 w-36 rounded-md border border-[#c9c3b8] bg-white pl-9 pr-3 text-sm font-bold uppercase"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
    </label>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      className={`inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
        active ? "bg-[#1f2933] text-white" : "border border-[#c9c3b8] bg-white text-[#1f2933] hover:bg-[#edf3ea]"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#d7d2c8] bg-[#fbfaf7] p-4">
      <div className="flex items-center justify-between text-[#55705f]">{icon}</div>
      <p className="mt-4 text-sm text-[#66706a]">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#eeeae2] p-3">
      <p className="text-xs uppercase text-[#66706a]">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${status === "TRADEABLE" ? "bg-[#dce8d7] text-[#31593d]" : "bg-[#f5ddd5] text-[#8a3a25]"}`}>
      {status}
    </span>
  );
}

function ScoreBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex min-w-10 justify-center rounded bg-[#e6ece2] px-2 py-1 text-xs font-bold text-[#31593d]">
      {value}
    </span>
  );
}

function PanelTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-[#1f2933] p-2 text-white">{icon}</div>
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-[#66706a]">{subtitle}</p>
      </div>
    </div>
  );
}
