import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { fetchUnitRegistry, fetchAccountGoalBreakdown } from '../../services/api';

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
  accountId: string;
  clientName: string;
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  goalCount: number;
  lastTransactionDate: string | null;
  units: Units;
  values: Values;
  totalValue: number;
}

interface GoalBalance {
  goalId: string;
  goalNumber: string;
  goalTitle: string;
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
  totalValues: Values;
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
  const [search, setSearch] = useState('');
  const [showOnlyFunded, setShowOnlyFunded] = useState(true);
  const [fundedThreshold] = useState(5000);
  const [accountType, setAccountType] = useState('');
  const [accountCategory, setAccountCategory] = useState('');
  const [asOfDateFilter, setAsOfDateFilter] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const limit = 100; // Fixed limit for pagination
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // Expandable rows for goal breakdown
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [goalBreakdowns, setGoalBreakdowns] = useState<Map<string, GoalBalance[]>>(new Map());
  const [loadingGoals, setLoadingGoals] = useState<Set<string>>(new Set());
  const [matchedGoalIds, setMatchedGoalIds] = useState<Array<{goalId: string; accountId: string}>>([]);

  useEffect(() => {
    loadRegistry();
  }, [search, showOnlyFunded, accountType, accountCategory, asOfDateFilter, offset]);

  const loadRegistry = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await fetchUnitRegistry(
        search,
        showOnlyFunded,
        fundedThreshold,
        limit,
        offset,
        accountType,
        accountCategory,
        asOfDateFilter
      );

      setEntries(data.entries || []);
      setAsOfDate(data.asOfDate);
      setPrices(data.prices);
      setSummary(data.summary);
      setTotal(data.total || 0);
      setMatchedGoalIds(data.matchedGoalIds || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load unit registry');
    } finally {
      setLoading(false);
    }
  };

  // Auto-expand accounts with matching goals
  useEffect(() => {
    if (matchedGoalIds.length > 0 && entries.length > 0) {
      const accountsToExpand = new Set(matchedGoalIds.map(m => m.accountId));
      setExpandedAccounts(accountsToExpand);

      // Pre-fetch goal breakdowns for matched accounts
      accountsToExpand.forEach(accountId => {
        fetchGoalBreakdown(accountId);
      });
    } else if (search === '') {
      // Clear expansions when search is cleared
      setExpandedAccounts(new Set());
    }
  }, [matchedGoalIds, entries]);

  const toggleAccountExpansion = async (accountId: string) => {
    const newExpanded = new Set(expandedAccounts);

    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
      if (!goalBreakdowns.has(accountId)) {
        await fetchGoalBreakdown(accountId);
      }
    }

    setExpandedAccounts(newExpanded);
  };

  const fetchGoalBreakdown = async (accountId: string) => {
    setLoadingGoals(prev => new Set(prev).add(accountId));

    try {
      const goals = await fetchAccountGoalBreakdown(accountId, asOfDateFilter);
      setGoalBreakdowns(prev => new Map(prev).set(accountId, goals));
    } catch (err) {
      console.error('Failed to fetch goal breakdown:', err);
    } finally {
      setLoadingGoals(prev => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  const handleGoToPage = (page: number) => {
    const newOffset = (page - 1) * limit;
    setOffset(newOffset);
  };

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('pageNumber') as HTMLInputElement;
    const pageNum = parseInt(input.value);
    const totalPages = Math.ceil(total / limit);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      handleGoToPage(pageNum);
      input.value = '';
    }
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      // Show pages around current page
      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const sortedEntries = [...entries].sort((a, b) => {
    if (!sortColumn) return 0;

    let aVal: any;
    let bVal: any;

    if (
      sortColumn === 'clientName' ||
      sortColumn === 'accountNumber' ||
      sortColumn === 'accountType'
    ) {
      aVal = a[sortColumn as keyof UnitRegistryEntry];
      bVal = b[sortColumn as keyof UnitRegistryEntry];
    } else if (sortColumn === 'totalValue') {
      aVal = a.totalValue;
      bVal = b.totalValue;
    } else if (sortColumn.startsWith('units.')) {
      const fund = sortColumn.split('.')[1] as keyof Units;
      aVal = a.units[fund];
      bVal = b.units[fund];
    } else if (sortColumn.startsWith('values.')) {
      const fund = sortColumn.split('.')[1] as keyof Values;
      aVal = a.values[fund];
      bVal = b.values[fund];
    }

    if (typeof aVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    } else {
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    }
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatNumber = (num: number, decimals: number = 2) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatCurrency = (num: number) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const formatName = (name: string) => {
    if (!name) return '';
    return name
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <span className="sort-icon">⇅</span>;
    }
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="unit-registry">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Unit Registry</h2>
            {asOfDate && <p className="as-of-date">Prices as of {formatDate(asOfDate)}</p>}
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
            <label htmlFor="accountType" className="filter-label">
              Account Type:
            </label>
            <select
              id="accountType"
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value);
                setOffset(0); // Reset to first page when filter changes
              }}
              className="filter-select"
            >
              <option value="">All Types</option>
              <option value="PERSONAL">Personal</option>
              <option value="POOLED">Pooled</option>
              <option value="JOINT">Joint</option>
              <option value="LINKED">Linked</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="accountCategory" className="filter-label">
              Account Category:
            </label>
            <select
              id="accountCategory"
              value={accountCategory}
              onChange={(e) => {
                setAccountCategory(e.target.value);
                setOffset(0); // Reset to first page when filter changes
              }}
              className="filter-select"
            >
              <option value="">All Categories</option>
              <option value="GENERAL">General</option>
              <option value="FAMILY">Family</option>
              <option value="INVESTMENT_CLUBS">Investment Clubs</option>
              <option value="RETIREMENTS_BENEFIT_SCHEME">Retirements Benefit Scheme</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="asOfDate" className="filter-label">
              As of Date:
            </label>
            <input
              id="asOfDate"
              type="date"
              value={asOfDateFilter}
              onChange={(e) => {
                setAsOfDateFilter(e.target.value);
                setOffset(0); // Reset to first page when date changes
              }}
              className="filter-input"
              placeholder="Select date..."
            />
            {asOfDateFilter && (
              <button
                onClick={() => {
                  setAsOfDateFilter('');
                  setOffset(0);
                }}
                className="clear-date-btn"
                title="Clear date filter"
              >
                ✕
              </button>
            )}
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

          {!loading && !error && summary && (
            <div className="stats-grid">
              <div className="stat-card stat-card-primary">
                <div className="stat-label">Active Clients</div>
                <div className="stat-value">{formatNumber(summary.totalClients, 0)}</div>
                <div className="stat-subtitle">Total accounts</div>
              </div>

              <div className="stat-card stat-card-success">
                <div className="stat-label">Total AUM</div>
                <div className="stat-value">{formatCurrency(summary.totalValue)}</div>
                <div className="stat-subtitle">All funds combined</div>
              </div>

              <div className="stat-card stat-card-fund">
                <div className="stat-label">XUMMF</div>
                <div className="stat-value">{formatCurrency(summary.totalValues.XUMMF)}</div>
                <div className="stat-subtitle">
                  {formatNumber(summary.totalUnits.XUMMF, 2)} units
                </div>
              </div>

              <div className="stat-card stat-card-fund">
                <div className="stat-label">XUBF</div>
                <div className="stat-value">{formatCurrency(summary.totalValues.XUBF)}</div>
                <div className="stat-subtitle">
                  {formatNumber(summary.totalUnits.XUBF, 2)} units
                </div>
              </div>

              <div className="stat-card stat-card-fund">
                <div className="stat-label">XUDEF</div>
                <div className="stat-value">{formatCurrency(summary.totalValues.XUDEF)}</div>
                <div className="stat-subtitle">
                  {formatNumber(summary.totalUnits.XUDEF, 2)} units
                </div>
              </div>

              <div className="stat-card stat-card-fund">
                <div className="stat-label">XUREF</div>
                <div className="stat-value">{formatCurrency(summary.totalValues.XUREF)}</div>
                <div className="stat-subtitle">
                  {formatNumber(summary.totalUnits.XUREF, 2)} units
                </div>
              </div>
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
                      <th colSpan={2} className="group-header">
                        Client Info
                      </th>
                      <th colSpan={4} className="group-header">
                        Units Held
                      </th>
                      <th colSpan={4} className="group-header">
                        Portfolio Value (UGX)
                      </th>
                      <th rowSpan={2} className="group-header total-header">
                        Total Portfolio Value
                      </th>
                    </tr>
                    <tr>
                      <th onClick={() => handleSort('clientName')} className="sortable">
                        Client Name <SortIcon column="clientName" />
                      </th>
                      <th onClick={() => handleSort('accountNumber')} className="sortable">
                        Account Number <SortIcon column="accountNumber" />
                      </th>
                      <th
                        onClick={() => handleSort('units.XUMMF')}
                        className="sortable right-align"
                      >
                        XUMMF <SortIcon column="units.XUMMF" />
                      </th>
                      <th onClick={() => handleSort('units.XUBF')} className="sortable right-align">
                        XUBF <SortIcon column="units.XUBF" />
                      </th>
                      <th
                        onClick={() => handleSort('units.XUDEF')}
                        className="sortable right-align"
                      >
                        XUDEF <SortIcon column="units.XUDEF" />
                      </th>
                      <th
                        onClick={() => handleSort('units.XUREF')}
                        className="sortable right-align"
                      >
                        XUREF <SortIcon column="units.XUREF" />
                      </th>
                      <th
                        onClick={() => handleSort('values.XUMMF')}
                        className="sortable right-align"
                      >
                        XUMMF <SortIcon column="values.XUMMF" />
                      </th>
                      <th
                        onClick={() => handleSort('values.XUBF')}
                        className="sortable right-align"
                      >
                        XUBF <SortIcon column="values.XUBF" />
                      </th>
                      <th
                        onClick={() => handleSort('values.XUDEF')}
                        className="sortable right-align"
                      >
                        XUDEF <SortIcon column="values.XUDEF" />
                      </th>
                      <th
                        onClick={() => handleSort('values.XUREF')}
                        className="sortable right-align"
                      >
                        XUREF <SortIcon column="values.XUREF" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => {
                      const isExpanded = expandedAccounts.has(entry.accountId);
                      const isHighlighted = matchedGoalIds.some(m => m.accountId === entry.accountId);
                      const goals = goalBreakdowns.get(entry.accountId) || [];
                      const isLoadingGoals = loadingGoals.has(entry.accountId);

                      return (
                        <React.Fragment key={entry.accountId}>
                          <tr
                            className={`account-row ${isExpanded ? 'expanded' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                            onClick={() => toggleAccountExpansion(entry.accountId)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="client-name">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <ChevronDown
                                  style={{
                                    width: '16px',
                                    height: '16px',
                                    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                    transition: 'transform 0.2s',
                                    color: '#666'
                                  }}
                                />
                                {formatName(entry.clientName)}
                              </div>
                            </td>
                            <td className="account-number">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {entry.accountNumber}
                                {entry.goalCount > 0 && (
                                  <span className="goal-count-badge">
                                    {entry.goalCount} {entry.goalCount === 1 ? 'goal' : 'goals'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="right-align units">{formatNumber(entry.units.XUMMF, 4)}</td>
                            <td className="right-align units">{formatNumber(entry.units.XUBF, 4)}</td>
                            <td className="right-align units">{formatNumber(entry.units.XUDEF, 4)}</td>
                            <td className="right-align units">{formatNumber(entry.units.XUREF, 4)}</td>
                            <td className="right-align value">{formatCurrency(entry.values.XUMMF)}</td>
                            <td className="right-align value">{formatCurrency(entry.values.XUBF)}</td>
                            <td className="right-align value">{formatCurrency(entry.values.XUDEF)}</td>
                            <td className="right-align value">{formatCurrency(entry.values.XUREF)}</td>
                            <td className="right-align total-value">
                              {formatCurrency(entry.totalValue)}
                            </td>
                          </tr>

                          {/* Expanded Goal Breakdown Row */}
                          {isExpanded && (
                            <tr className="goal-breakdown-row">
                              <td colSpan={11} style={{ padding: 0, background: '#f8f9fa' }}>
                                <div style={{ padding: '16px 24px' }}>
                                  {isLoadingGoals ? (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                                      <Loader2 style={{ width: '20px', height: '20px', marginRight: '8px', animation: 'spin 1s linear infinite' }} />
                                      <span style={{ color: '#666', fontSize: '14px' }}>Loading goals...</span>
                                    </div>
                                  ) : goals.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#999', padding: '20px', fontSize: '14px' }}>
                                      No goals found for this account
                                    </div>
                                  ) : (
                                    <>
                                      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                                        Goal Breakdown for {entry.accountNumber}
                                      </h4>
                                      <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                          <thead>
                                            <tr style={{ background: '#e9ecef' }}>
                                              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>Goal</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUMMF Units</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUBF Units</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUDEF Units</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUREF Units</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUMMF Value</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUBF Value</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUDEF Value</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>XUREF Value</th>
                                              <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>Total Value</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {goals.map((goal) => {
                                              const isMatchedGoal = matchedGoalIds.some(m => m.goalId === goal.goalId);
                                              return (
                                                <tr
                                                  key={goal.goalId}
                                                  style={{
                                                    background: isMatchedGoal ? '#fff3cd' : 'white',
                                                    fontWeight: isMatchedGoal ? '600' : 'normal'
                                                  }}
                                                >
                                                  <td style={{ padding: '8px', borderBottom: '1px solid #dee2e6' }}>
                                                    <div style={{ fontWeight: '500', color: '#333' }}>{goal.goalTitle}</div>
                                                    <div style={{ fontSize: '11px', color: '#666', fontFamily: 'Courier New, monospace' }}>
                                                      {goal.goalNumber}
                                                    </div>
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace' }}>
                                                    {formatNumber(goal.units.XUMMF, 2)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace' }}>
                                                    {formatNumber(goal.units.XUBF, 2)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace' }}>
                                                    {formatNumber(goal.units.XUDEF, 2)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace' }}>
                                                    {formatNumber(goal.units.XUREF, 2)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace', color: '#0c5460' }}>
                                                    {formatCurrency(goal.values.XUMMF)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace', color: '#0c5460' }}>
                                                    {formatCurrency(goal.values.XUBF)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace', color: '#0c5460' }}>
                                                    {formatCurrency(goal.values.XUDEF)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace', color: '#0c5460' }}>
                                                    {formatCurrency(goal.values.XUREF)}
                                                  </td>
                                                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #dee2e6', fontFamily: 'Courier New, monospace', fontWeight: '600', color: '#155724' }}>
                                                    {formatCurrency(goal.totalValue)}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            <tr style={{ background: '#d4edda', borderTop: '2px solid #333' }}>
                                              <td style={{ padding: '10px 8px', fontWeight: '700', fontSize: '13px' }}>
                                                Total ({goals.length} {goals.length === 1 ? 'goal' : 'goals'})
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px' }}>
                                                {formatNumber(goals.reduce((sum, g) => sum + g.units.XUMMF, 0), 2)}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px' }}>
                                                {formatNumber(goals.reduce((sum, g) => sum + g.units.XUBF, 0), 2)}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px' }}>
                                                {formatNumber(goals.reduce((sum, g) => sum + g.units.XUDEF, 0), 2)}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px' }}>
                                                {formatNumber(goals.reduce((sum, g) => sum + g.units.XUREF, 0), 2)}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px', color: '#0c5460' }}>
                                                {formatCurrency(goals.reduce((sum, g) => sum + g.values.XUMMF, 0))}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px', color: '#0c5460' }}>
                                                {formatCurrency(goals.reduce((sum, g) => sum + g.values.XUBF, 0))}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px', color: '#0c5460' }}>
                                                {formatCurrency(goals.reduce((sum, g) => sum + g.values.XUDEF, 0))}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '600', fontSize: '12px', color: '#0c5460' }}>
                                                {formatCurrency(goals.reduce((sum, g) => sum + g.values.XUREF, 0))}
                                              </td>
                                              <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: '700', fontSize: '13px', color: '#155724' }}>
                                                {formatCurrency(goals.reduce((sum, g) => sum + g.totalValue, 0))}
                                              </td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  {summary && (
                    <tfoot>
                      <tr className="summary-row">
                        <td colSpan={2} className="summary-label">
                          <strong>Total Units ({summary.totalClients} clients)</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatNumber(summary.totalUnits.XUMMF, 4)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatNumber(summary.totalUnits.XUBF, 4)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatNumber(summary.totalUnits.XUDEF, 4)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatNumber(summary.totalUnits.XUREF, 4)}</strong>
                        </td>
                        <td colSpan={4} className="summary-spacer"></td>
                        <td className="right-align">
                          <strong>{formatCurrency(summary.totalValue)}</strong>
                        </td>
                      </tr>
                      <tr className="summary-values-row">
                        <td colSpan={2} className="summary-label">
                          <strong>Total Portfolio Value</strong>
                        </td>
                        <td colSpan={4} className="summary-spacer"></td>
                        <td className="right-align">
                          <strong>{formatCurrency(summary.totalValues.XUMMF)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatCurrency(summary.totalValues.XUBF)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatCurrency(summary.totalValues.XUDEF)}</strong>
                        </td>
                        <td className="right-align">
                          <strong>{formatCurrency(summary.totalValues.XUREF)}</strong>
                        </td>
                        <td className="right-align total-summary">
                          <strong>{formatCurrency(summary.totalValue)}</strong>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Pagination Controls */}
              {Math.ceil(total / limit) > 1 && (
                <div className="pagination-container">
                  <div className="pagination-info">
                    Showing page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
                    <span style={{ marginLeft: '8px' }}>
                      ({entries.length} of {total} accounts)
                    </span>
                  </div>

                  <div className="pagination-buttons">
                    {/* Previous button */}
                    <button
                      onClick={handlePrevPage}
                      disabled={offset === 0}
                      className="pagination-btn pagination-nav"
                      title="Previous page"
                    >
                      <ChevronLeft style={{ width: '16px', height: '16px' }} />
                    </button>

                    {/* Page number buttons */}
                    {getPageNumbers().map((pageNum, index) =>
                      pageNum === '...' ? (
                        <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                          ...
                        </span>
                      ) : (
                        <button
                          key={`page-${pageNum}`}
                          onClick={() => handleGoToPage(pageNum as number)}
                          className={`pagination-btn ${
                            Math.floor(offset / limit) + 1 === pageNum ? 'pagination-active' : ''
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    )}

                    {/* Next button */}
                    <button
                      onClick={handleNextPage}
                      disabled={offset + limit >= total}
                      className="pagination-btn pagination-nav"
                      title="Next page"
                    >
                      <ChevronRight style={{ width: '16px', height: '16px' }} />
                    </button>
                  </div>

                  {/* Go to page input */}
                  {Math.ceil(total / limit) > 7 && (
                    <div className="pagination-goto">
                      <form onSubmit={handlePageInputSubmit} className="pagination-form">
                        <label htmlFor="pageNumber" className="pagination-label">
                          Go to page:
                        </label>
                        <input
                          type="number"
                          id="pageNumber"
                          name="pageNumber"
                          min="1"
                          max={Math.ceil(total / limit)}
                          placeholder={`1-${Math.ceil(total / limit)}`}
                          className="pagination-input"
                        />
                        <button type="submit" className="pagination-go-btn">
                          Go
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* Current Prices Info */}
              {prices && (
                <div className="price-info">
                  <h4>Current Mid Prices:</h4>
                  <div className="price-grid">
                    <span>XUMMF: {prices.XUMMF ? formatNumber(prices.XUMMF, 4) : 'N/A'}</span>
                    <span>XUBF: {prices.XUBF ? formatNumber(prices.XUBF, 4) : 'N/A'}</span>
                    <span>XUDEF: {prices.XUDEF ? formatNumber(prices.XUDEF, 4) : 'N/A'}</span>
                    <span>XUREF: {prices.XUREF ? formatNumber(prices.XUREF, 4) : 'N/A'}</span>
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

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
          padding: 0 4px;
        }

        .stat-card {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          border-left: 4px solid #3b82f6;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .stat-card-primary {
          border-left-color: #3b82f6;
          background: linear-gradient(135deg, #ffffff 0%, #eff6ff 100%);
        }

        .stat-card-success {
          border-left-color: #10b981;
          background: linear-gradient(135deg, #ffffff 0%, #ecfdf5 100%);
        }

        .stat-card-fund {
          border-left-color: #8b5cf6;
          background: linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%);
        }

        .stat-label {
          font-size: 13px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #111827;
          margin-bottom: 4px;
          font-family: 'Courier New', monospace;
        }

        .stat-subtitle {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 500;
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

        .summary-values-row {
          background-color: #d4edda !important;
        }

        .summary-values-row td {
          padding: 12px 8px;
          font-weight: 600;
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

        .pagination-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px 0;
          border-top: 1px solid #e0e0e0;
        }

        .pagination-info {
          text-align: center;
          font-size: 14px;
          color: #666;
        }

        .pagination-buttons {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          flex-wrap: wrap;
        }

        .pagination-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          min-width: 40px;
          font-size: 14px;
          background-color: #f8f9fa;
          color: #333;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .pagination-btn:hover:not(:disabled) {
          background-color: #e9ecef;
        }

        .pagination-btn:disabled {
          background-color: #f8f9fa;
          color: #ccc;
          cursor: not-allowed;
          opacity: 0.5;
        }

        .pagination-active {
          background-color: #007bff;
          color: white;
          font-weight: 600;
          border-color: #007bff;
        }

        .pagination-active:hover {
          background-color: #0056b3;
          border-color: #0056b3;
        }

        .pagination-nav {
          padding: 8px;
        }

        .pagination-ellipsis {
          padding: 8px 12px;
          color: #666;
        }

        .pagination-goto {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .pagination-form {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pagination-label {
          font-size: 14px;
          color: #666;
        }

        .pagination-input {
          width: 80px;
          padding: 8px 12px;
          font-size: 14px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .pagination-input:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
        }

        .pagination-go-btn {
          padding: 8px 16px;
          font-size: 14px;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .pagination-go-btn:hover {
          background-color: #0056b3;
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

        .goal-count-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          background-color: #e3f2fd;
          color: #1976d2;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 8px;
        }

        .account-row.expanded {
          background-color: #f0f7ff;
        }

        .account-row.highlighted {
          background-color: #fff3cd;
        }

        .goal-breakdown-row {
          background-color: #f8f9fa;
        }

        .goal-breakdown-row td {
          padding: 0;
        }

        .goal-breakdown-table {
          width: 100%;
          margin: 10px 0;
          border-collapse: collapse;
        }

        .goal-breakdown-table th {
          background-color: #e9ecef;
          padding: 8px;
          font-size: 11px;
          font-weight: 600;
          text-align: left;
          color: #495057;
          border-bottom: 2px solid #dee2e6;
        }

        .goal-breakdown-table td {
          padding: 8px;
          font-size: 12px;
          border-bottom: 1px solid #dee2e6;
        }

        .goal-breakdown-table tr:hover {
          background-color: #f0f0f0;
        }

        .goal-breakdown-table .goal-info {
          font-weight: 500;
        }

        .goal-breakdown-table .goal-number {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          color: #666;
        }

        .loading-goals {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          color: #666;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .spinner {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
