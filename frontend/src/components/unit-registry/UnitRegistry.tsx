import { useState, useEffect } from "react";
import { fetchUnitRegistry } from "../../services/api";

interface Units {
  XUMMF: number;
  XUBF: number;
  XUDEF: number;
  XUREF: number;
}

interface Values {
  XUMMF: number;
  XUBF: number;
  XUDEF: number;
  XUREF: number;
}

interface UnitRegistryEntry {
  clientName: string;
  accountNumber: string;
  accountType: string;
  lastTransactionDate: string | null;
  units: Units;
  values: Values;
  totalValue: number;
}

interface Prices {
  XUMMF: number | null;
  XUBF: number | null;
  XUDEF: number | null;
  XUREF: number | null;
}

interface Summary {
  totalClients: number;
  totalUnits: Units;
  totalValue: number;
}

export function UnitRegistry() {
  const [entries, setEntries] = useState<UnitRegistryEntry[]>([]);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [prices, setPrices] = useState<Prices>({
    XUMMF: null,
    XUBF: null,
    XUDEF: null,
    XUREF: null,
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [showOnlyFunded, setShowOnlyFunded] = useState(true);
  const [fundedThreshold] = useState(5000);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Pagination
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadRegistry();
  }, [search, showOnlyFunded, offset]);

  const loadRegistry = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchUnitRegistry(search, showOnlyFunded, fundedThreshold, limit, offset);

      setEntries(data.entries || []);
      setAsOfDate(data.asOfDate);
      setPrices(data.prices);
      setSummary(data.summary);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message || "Failed to load unit registry");
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  const sortedEntries = [...entries].sort((a, b) => {
    if (!sortColumn) return 0;

    let aVal: any;
    let bVal: any;

    if (sortColumn === "clientName" || sortColumn === "accountNumber" || sortColumn === "accountType") {
      aVal = a[sortColumn as keyof UnitRegistryEntry];
      bVal = b[sortColumn as keyof UnitRegistryEntry];
    } else if (sortColumn === "totalValue") {
      aVal = a.totalValue;
      bVal = b.totalValue;
    } else if (sortColumn.startsWith("units.")) {
      const fund = sortColumn.split(".")[1] as keyof Units;
      aVal = a.units[fund];
      bVal = b.units[fund];
    } else if (sortColumn.startsWith("values.")) {
      const fund = sortColumn.split(".")[1] as keyof Values;
      aVal = a.values[fund];
      bVal = b.values[fund];
    }

    if (typeof aVal === "string") {
      return sortDirection === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatCurrency = (num: number) => {
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <span className="sort-icon">⇅</span>;
    }
    return <span className="sort-icon">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="unit-registry">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Unit Registry</h2>
            {asOfDate && (
              <p className="as-of-date">
                Prices as of {formatDate(asOfDate)}
              </p>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="filter-group">
            <input
              type="text"
              placeholder="Search by client name or account number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showOnlyFunded}
                onChange={(e) => setShowOnlyFunded(e.target.checked)}
              />
              Show only funded accounts (≥ 5,000 UGX)
            </label>
          </div>
        </div>

        <div className="card-body">
          {loading && <div className="loading">Loading unit registry...</div>}

          {error && (
            <div className="alert alert-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && !error && sortedEntries.length === 0 && (
            <div className="no-data">No client positions found</div>
          )}

          {!loading && !error && sortedEntries.length > 0 && (
            <>
              <div className="table-container">
                <table className="registry-table">
                  <thead>
                    <tr>
                      <th colSpan={2} className="group-header">Client Info</th>
                      <th colSpan={4} className="group-header">Units Held</th>
                      <th colSpan={4} className="group-header">Portfolio Value (UGX)</th>
                      <th rowSpan={2} className="group-header total-header">Total Portfolio Value</th>
                    </tr>
                    <tr>
                      <th onClick={() => handleSort("clientName")} className="sortable">
                        Client Name <SortIcon column="clientName" />
                      </th>
                      <th onClick={() => handleSort("accountNumber")} className="sortable">
                        Account Number <SortIcon column="accountNumber" />
                      </th>
                      <th onClick={() => handleSort("units.XUMMF")} className="sortable right-align">
                        XUMMF <SortIcon column="units.XUMMF" />
                      </th>
                      <th onClick={() => handleSort("units.XUBF")} className="sortable right-align">
                        XUBF <SortIcon column="units.XUBF" />
                      </th>
                      <th onClick={() => handleSort("units.XUDEF")} className="sortable right-align">
                        XUDEF <SortIcon column="units.XUDEF" />
                      </th>
                      <th onClick={() => handleSort("units.XUREF")} className="sortable right-align">
                        XUREF <SortIcon column="units.XUREF" />
                      </th>
                      <th onClick={() => handleSort("values.XUMMF")} className="sortable right-align">
                        XUMMF <SortIcon column="values.XUMMF" />
                      </th>
                      <th onClick={() => handleSort("values.XUBF")} className="sortable right-align">
                        XUBF <SortIcon column="values.XUBF" />
                      </th>
                      <th onClick={() => handleSort("values.XUDEF")} className="sortable right-align">
                        XUDEF <SortIcon column="values.XUDEF" />
                      </th>
                      <th onClick={() => handleSort("values.XUREF")} className="sortable right-align">
                        XUREF <SortIcon column="values.XUREF" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry, idx) => (
                      <tr key={`${entry.accountNumber}-${idx}`}>
                        <td className="client-name">{entry.clientName}</td>
                        <td className="account-number">{entry.accountNumber}</td>
                        <td className="right-align units">{formatNumber(entry.units.XUMMF, 4)}</td>
                        <td className="right-align units">{formatNumber(entry.units.XUBF, 4)}</td>
                        <td className="right-align units">{formatNumber(entry.units.XUDEF, 4)}</td>
                        <td className="right-align units">{formatNumber(entry.units.XUREF, 4)}</td>
                        <td className="right-align value">{formatCurrency(entry.values.XUMMF)}</td>
                        <td className="right-align value">{formatCurrency(entry.values.XUBF)}</td>
                        <td className="right-align value">{formatCurrency(entry.values.XUDEF)}</td>
                        <td className="right-align value">{formatCurrency(entry.values.XUREF)}</td>
                        <td className="right-align total-value">{formatCurrency(entry.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {summary && (
                    <tfoot>
                      <tr className="summary-row">
                        <td colSpan={2} className="summary-label">
                          <strong>Total ({summary.totalClients} clients)</strong>
                        </td>
                        <td className="right-align"><strong>{formatNumber(summary.totalUnits.XUMMF, 4)}</strong></td>
                        <td className="right-align"><strong>{formatNumber(summary.totalUnits.XUBF, 4)}</strong></td>
                        <td className="right-align"><strong>{formatNumber(summary.totalUnits.XUDEF, 4)}</strong></td>
                        <td className="right-align"><strong>{formatNumber(summary.totalUnits.XUREF, 4)}</strong></td>
                        <td colSpan={4} className="summary-spacer"></td>
                        <td className="right-align total-summary"><strong>{formatCurrency(summary.totalValue)}</strong></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="pagination">
                <button
                  className="btn btn-secondary"
                  onClick={handlePrevPage}
                  disabled={offset === 0}
                >
                  Previous
                </button>
                <span className="page-info">
                  Showing {offset + 1} - {Math.min(offset + limit, total)} of {total}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={handleNextPage}
                  disabled={offset + limit >= total}
                >
                  Next
                </button>
              </div>

              {/* Current Prices Info */}
              {prices && (
                <div className="price-info">
                  <h4>Current Mid Prices:</h4>
                  <div className="price-grid">
                    <span>XUMMF: {prices.XUMMF ? formatNumber(prices.XUMMF, 4) : "N/A"}</span>
                    <span>XUBF: {prices.XUBF ? formatNumber(prices.XUBF, 4) : "N/A"}</span>
                    <span>XUDEF: {prices.XUDEF ? formatNumber(prices.XUDEF, 4) : "N/A"}</span>
                    <span>XUREF: {prices.XUREF ? formatNumber(prices.XUREF, 4) : "N/A"}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        .unit-registry {
          max-width: 1800px;
          margin: 0 auto;
          padding: 20px;
        }

        .card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .card-header {
          padding: 20px;
          border-bottom: 1px solid #e0e0e0;
        }

        .card-header h2 {
          margin: 0 0 5px 0;
          color: #333;
        }

        .as-of-date {
          margin: 0;
          font-size: 14px;
          color: #666;
          font-style: italic;
        }

        .filters {
          padding: 20px;
          background: #f8f9fa;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          gap: 20px;
          align-items: center;
          flex-wrap: wrap;
        }

        .filter-group {
          display: flex;
          align-items: center;
        }

        .search-input {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          width: 300px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          color: #333;
          cursor: pointer;
        }

        .checkbox-label input[type="checkbox"] {
          cursor: pointer;
        }

        .card-body {
          padding: 20px;
          min-height: 300px;
        }

        .loading {
          text-align: center;
          padding: 40px;
          color: #666;
        }

        .alert {
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }

        .alert-error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .no-data {
          text-align: center;
          padding: 40px;
          color: #999;
          font-style: italic;
        }

        .table-container {
          overflow-x: auto;
          margin-bottom: 20px;
        }

        .registry-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .registry-table th,
        .registry-table td {
          padding: 10px 8px;
          border: 1px solid #e0e0e0;
        }

        .registry-table th {
          background-color: #f8f9fa;
          font-weight: 600;
          color: #333;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .group-header {
          background-color: #e9ecef !important;
          text-align: center;
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .total-header {
          background-color: #d1e7dd !important;
          vertical-align: middle;
        }

        .sortable {
          cursor: pointer;
          user-select: none;
        }

        .sortable:hover {
          background-color: #e9ecef;
        }

        .sort-icon {
          margin-left: 4px;
          font-size: 11px;
          opacity: 0.6;
        }

        .right-align {
          text-align: right;
        }

        .client-name {
          font-weight: 500;
          color: #333;
        }

        .account-number {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          color: #666;
        }

        .units {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          color: #495057;
        }

        .value {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          font-weight: 500;
          color: #0c5460;
        }

        .total-value {
          font-family: 'Courier New', monospace;
          font-weight: 700;
          font-size: 13px;
          color: #155724;
          background-color: #d4edda;
        }

        .registry-table tbody tr:hover {
          background-color: #f8f9fa;
        }

        .summary-row {
          background-color: #e9ecef !important;
        }

        .summary-row td {
          border-top: 2px solid #333;
          padding: 12px 8px;
        }

        .summary-label {
          font-size: 14px;
        }

        .summary-spacer {
          background-color: transparent !important;
          border-left: none !important;
          border-right: none !important;
        }

        .total-summary {
          font-size: 15px;
          background-color: #c3e6cb !important;
        }

        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 15px;
          padding: 15px 0;
          border-top: 1px solid #e0e0e0;
        }

        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-secondary {
          background-color: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background-color: #5a6268;
        }

        .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .page-info {
          font-size: 14px;
          color: #666;
        }

        .price-info {
          margin-top: 20px;
          padding: 15px;
          background-color: #f8f9fa;
          border-radius: 4px;
          border: 1px solid #e0e0e0;
        }

        .price-info h4 {
          margin: 0 0 10px 0;
          font-size: 14px;
          color: #495057;
        }

        .price-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          color: #333;
        }
      `}</style>
    </div>
  );
}
