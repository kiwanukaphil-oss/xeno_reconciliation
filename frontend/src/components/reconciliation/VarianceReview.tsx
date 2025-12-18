import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getReconciliationVariances, resolveVariance } from '../../services/api';

interface Variance {
  id: string;
  type: string;
  severity: string;
  description: string;
  differenceAmount: number | null;
  fundCode: string | null;
  resolutionStatus: string;
  autoApproved: boolean;
  detectedAt: string;
  transaction: {
    goalNumber: string;
    transactionId: string;
    transactionDate: string;
    totalAmount: number;
    client: string;
    accountNumber: string;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const VarianceReview = () => {
  const [variances, setVariances] = useState<Variance[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVariance, setSelectedVariance] = useState<Variance | null>(null);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState('APPROVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvedBy] = useState('Admin'); // TODO: Get from auth context
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    fetchVariances(1);
  }, [severityFilter, statusFilter]);

  const fetchVariances = async (page: number = 1, limitOverride?: number) => {
    try {
      setLoading(true);
      const limit = limitOverride || pagination.limit;
      const offset = (page - 1) * limit;
      const result = await getReconciliationVariances(
        limit,
        offset,
        severityFilter,
        statusFilter
      );
      setVariances(result.data.variances);
      const total = result.data.pagination?.total || result.data.variances.length;
      setPagination({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error('Failed to fetch variances:', error);
      alert(`Failed to load variances: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchVariances(newPage);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    fetchVariances(1, newLimit);
  };

  const handleResolve = async () => {
    if (!selectedVariance) return;

    try {
      setResolving(true);
      await resolveVariance(
        selectedVariance.id,
        resolutionStatus,
        resolutionNotes,
        resolvedBy
      );
      alert('Variance resolved successfully');
      setShowResolveDialog(false);
      setSelectedVariance(null);
      setResolutionNotes('');
      await fetchVariances();
    } catch (error) {
      console.error('Failed to resolve variance:', error);
      alert(`Failed to resolve variance: ${(error as Error).message}`);
    } finally {
      setResolving(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    const badges: { [key: string]: string } = {
      LOW: 'bg-green-100 text-green-800',
      MEDIUM: 'bg-yellow-100 text-yellow-800',
      HIGH: 'bg-orange-100 text-orange-800',
      CRITICAL: 'bg-red-100 text-red-800',
    };
    return badges[severity] || 'bg-gray-100 text-gray-800';
  };

  const getStatusBadge = (status: string) => {
    const badges: { [key: string]: string } = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      AUTO_APPROVED: 'bg-blue-100 text-blue-800',
      APPROVED: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      INVESTIGATING: 'bg-purple-100 text-purple-800',
      RESOLVED: 'bg-gray-100 text-gray-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  const filteredVariances = variances.filter((variance) => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        variance.transaction.goalNumber.toLowerCase().includes(search) ||
        variance.transaction.transactionId.toLowerCase().includes(search) ||
        variance.transaction.client.toLowerCase().includes(search) ||
        variance.transaction.accountNumber.toLowerCase().includes(search)
      );
    }
    return true;
  });

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Variance Review</h1>
        <p className="text-gray-600">
          Review and resolve reconciliation variances requiring manual attention
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by goal, transaction ID, client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Severity Filter */}
          <div>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Severities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
        </div>
      </div>

      {/* Variances Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      ) : filteredVariances.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <AlertTriangle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No variances found</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Severity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Goal Number
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Transaction ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Difference
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVariances.map((variance) => (
                  <tr key={variance.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      {variance.type.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getSeverityBadge(
                          variance.severity
                        )}`}
                      >
                        {variance.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{variance.transaction.client}</td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {variance.transaction.goalNumber}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {variance.transaction.transactionId}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {variance.description}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {variance.differenceAmount !== null ? (
                        <span
                          className={
                            variance.differenceAmount > 0 ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          {Number(variance.differenceAmount).toLocaleString('en-US')}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(
                          variance.resolutionStatus
                        )}`}
                      >
                        {variance.resolutionStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {variance.resolutionStatus === 'PENDING' && (
                        <button
                          onClick={() => {
                            setSelectedVariance(variance);
                            setShowResolveDialog(true);
                          }}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-700">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total.toLocaleString()} variances
              </span>
              <select
                value={pagination.limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value))}
                className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
                <option value={200}>200 per page</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1 || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </button>
              <span className="text-sm text-gray-700 px-3">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Dialog */}
      {showResolveDialog && selectedVariance && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Resolve Variance</h2>

            <div className="space-y-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Type:</strong> {selectedVariance.type.replace(/_/g, ' ')}
                </p>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Severity:</strong>{' '}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded ${getSeverityBadge(
                      selectedVariance.severity
                    )}`}
                  >
                    {selectedVariance.severity}
                  </span>
                </p>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Description:</strong> {selectedVariance.description}
                </p>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Client:</strong> {selectedVariance.transaction.client}
                </p>
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Goal Number:</strong> {selectedVariance.transaction.goalNumber}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Transaction ID:</strong> {selectedVariance.transaction.transactionId}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resolution Decision
                </label>
                <select
                  value={resolutionStatus}
                  onChange={(e) => setResolutionStatus(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="APPROVED">Approve (Accept Variance)</option>
                  <option value="REJECTED">Reject (Requires Correction)</option>
                  <option value="INVESTIGATING">Mark as Investigating</option>
                  <option value="RESOLVED">Mark as Resolved</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resolution Notes
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={4}
                  placeholder="Explain the reason for your decision..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button
                onClick={() => {
                  setShowResolveDialog(false);
                  setSelectedVariance(null);
                  setResolutionNotes('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                disabled={resolving}
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                disabled={resolving || !resolutionNotes.trim()}
              >
                {resolving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Resolving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Resolve Variance
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VarianceReview;
