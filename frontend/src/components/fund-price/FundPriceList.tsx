import { useState, useEffect } from "react";
import { fetchFundPrices } from "../../services/api";

interface FundPrice {
  id: string;
  fundCode: string;
  fundName: string;
  priceDate: string;
  bidPrice: number;
  midPrice: number;
  offerPrice: number;
  nav?: number;
  createdAt: string;
}

interface DatePrices {
  date: string;
  prices: {
    [fundCode: string]: {
      bid: number;
      mid: number;
      offer: number;
    };
  };
}

const FUND_CODES = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];

export function FundPriceList() {
  const [prices, setPrices] = useState<FundPrice[]>([]);
  const [groupedPrices, setGroupedPrices] = useState<DatePrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [total, setTotal] = useState(0);
  const [limit] = useState(100);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    loadPrices();
  }, [startDate, endDate, offset]);

  useEffect(() => {
    // Group prices by date
    const grouped = groupPricesByDate(prices);
    setGroupedPrices(grouped);
  }, [prices]);

  const loadPrices = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      params.append("limit", limit.toString());
      params.append("offset", offset.toString());

      const data = await fetchFundPrices(params);
      setPrices(data.prices || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message || "Failed to load fund prices");
    } finally {
      setLoading(false);
    }
  };

  const groupPricesByDate = (priceData: FundPrice[]): DatePrices[] => {
    const dateMap = new Map<string, DatePrices>();

    priceData.forEach((price) => {
      const dateKey = price.priceDate.split('T')[0]; // Get date part only

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          prices: {},
        });
      }

      const datePrices = dateMap.get(dateKey)!;
      datePrices.prices[price.fundCode] = {
        bid: price.bidPrice,
        mid: price.midPrice,
        offer: price.offerPrice,
      };
    });

    // Convert to array and sort by date descending
    return Array.from(dateMap.values()).sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatPrice = (price: number | undefined) => {
    if (price === undefined) return "-";
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  };

  const handlePrevPage = () => {
    if (offset > 0) {
      setOffset(offset - limit);
    }
  };

  const handleNextPage = () => {
    if (offset + limit < total) {
      setOffset(offset + limit);
    }
  };

  return (
    <div className="fund-price-list">
      <div className="card">
        <div className="card-header">
          <h2>Fund Prices</h2>
        </div>

        {/* Filters */}
        <div className="filters">
          <div className="filter-group">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <div className="filter-group">
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setOffset(0);
            }}
          >
            Clear Filters
          </button>
        </div>

        <div className="card-body">
          {loading && <div className="loading">Loading prices...</div>}

          {error && (
            <div className="alert alert-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && !error && groupedPrices.length === 0 && (
            <div className="no-data">No prices found</div>
          )}

          {!loading && !error && groupedPrices.length > 0 && (
            <>
              {/* Bid Prices Table */}
              <div className="price-section">
                <h3 className="price-type-header bid">Bid Prices</h3>
                <div className="table-container">
                  <table className="prices-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {FUND_CODES.map((code) => (
                          <th key={code}>{code}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPrices.map((datePrice) => (
                        <tr key={`bid-${datePrice.date}`}>
                          <td className="date-cell">{formatDate(datePrice.date)}</td>
                          {FUND_CODES.map((code) => (
                            <td key={code} className="price-cell">
                              {formatPrice(datePrice.prices[code]?.bid)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mid Prices Table */}
              <div className="price-section">
                <h3 className="price-type-header mid">Mid Prices</h3>
                <div className="table-container">
                  <table className="prices-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {FUND_CODES.map((code) => (
                          <th key={code}>{code}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPrices.map((datePrice) => (
                        <tr key={`mid-${datePrice.date}`}>
                          <td className="date-cell">{formatDate(datePrice.date)}</td>
                          {FUND_CODES.map((code) => (
                            <td key={code} className="price-cell">
                              {formatPrice(datePrice.prices[code]?.mid)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Offer Prices Table */}
              <div className="price-section">
                <h3 className="price-type-header offer">Offer Prices</h3>
                <div className="table-container">
                  <table className="prices-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {FUND_CODES.map((code) => (
                          <th key={code}>{code}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupedPrices.map((datePrice) => (
                        <tr key={`offer-${datePrice.date}`}>
                          <td className="date-cell">{formatDate(datePrice.date)}</td>
                          {FUND_CODES.map((code) => (
                            <td key={code} className="price-cell">
                              {formatPrice(datePrice.prices[code]?.offer)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
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
            </>
          )}
        </div>
      </div>

      <style>{`
        .fund-price-list {
          max-width: 1400px;
          margin: 0 auto;
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
          margin: 0;
          color: #333;
        }

        .filters {
          padding: 20px;
          background: #f8f9fa;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          gap: 15px;
          align-items: end;
          flex-wrap: wrap;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .filter-group label {
          font-size: 13px;
          font-weight: 500;
          color: #333;
        }

        .filter-group input {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-secondary {
          background-color: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background-color: #5a6268;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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

        .price-section {
          margin-bottom: 30px;
        }

        .price-section:last-of-type {
          margin-bottom: 20px;
        }

        .price-type-header {
          margin: 0 0 12px 0;
          padding: 10px 15px;
          border-radius: 4px;
          font-size: 16px;
          font-weight: 600;
        }

        .price-type-header.bid {
          background: #fff3cd;
          color: #856404;
        }

        .price-type-header.mid {
          background: #d1ecf1;
          color: #0c5460;
        }

        .price-type-header.offer {
          background: #d4edda;
          color: #155724;
        }

        .table-container {
          overflow-x: auto;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
        }

        .prices-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }

        .prices-table th,
        .prices-table td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #e0e0e0;
        }

        .prices-table th {
          background-color: #f8f9fa;
          font-weight: 600;
          color: #333;
          position: sticky;
          top: 0;
        }

        .prices-table tbody tr:last-child td {
          border-bottom: none;
        }

        .prices-table tbody tr:hover {
          background-color: #f8f9fa;
        }

        .date-cell {
          font-weight: 600;
          color: #495057;
          white-space: nowrap;
        }

        .price-cell {
          font-family: 'Courier New', monospace;
          text-align: right;
        }

        .pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 0 0 0;
          border-top: 1px solid #e0e0e0;
        }

        .page-info {
          font-size: 14px;
          color: #666;
        }
      `}</style>
    </div>
  );
}
