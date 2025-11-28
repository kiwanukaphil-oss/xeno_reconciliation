import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { getBankReconciliationReport } from '../../services/api';

interface Variance {
  type: string;
  severity: string;
  description: string;
  difference: number;
  autoApproved: boolean;
}

interface ReportTransaction {
  rowNumber: number;
  client: string;
  accountNumber: string;
  goalNumber: string;
  transactionId: string;
  transactionDate: string;
  totalAmount: number;
  status: string;
  matchScore: number;
  matchedCode: string | null;
  variances: Variance[];
}

interface ReportData {
  batchInfo: {
    batchNumber: string;
    fileName: string;
    uploadedAt: string;
    uploadedBy: string;
    processingStatus: string;
  };
  summary: {
    totalRecords: number;
    matched: number;
    unmatched: number;
    autoApproved: number;
    manualReview: number;
    totalVariances: number;
  };
  transactions: ReportTransaction[];
}

const ReconciliationReport = () => {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (batchId) {
      fetchReport();
    }
  }, [batchId]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      const result = await getBankReconciliationReport(batchId!);
      setReport(result.data);
    } catch (error) {
      console.error('Failed to fetch report:', error);
      alert(`Failed to load report: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'MATCHED':
      case 'AUTO_APPROVED':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'MISSING_IN_FUND':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'MANUAL_REVIEW':
      case 'VARIANCE_DETECTED':
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      default:
        return <Minus className="w-5 h-5 text-gray-600" />;
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
      MATCHED: 'bg-green-100 text-green-800',
      AUTO_APPROVED: 'bg-blue-100 text-blue-800',
      MANUAL_REVIEW: 'bg-yellow-100 text-yellow-800',
      MISSING_IN_FUND: 'bg-red-100 text-red-800',
      VARIANCE_DETECTED: 'bg-orange-100 text-orange-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  const filteredTransactions = report?.transactions.filter((txn) => {
    if (filter === 'all') return true;
    return txn.status === filter;
  }) || [];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Report not found</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/reconciliation')}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Reconciliation
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{report.batchInfo.batchNumber}</h1>
            <p className="text-gray-600 mt-1">{report.batchInfo.fileName}</p>
            <p className="text-sm text-gray-500 mt-1">
              Uploaded by {report.batchInfo.uploadedBy} on{' '}
              {new Date(report.batchInfo.uploadedAt).toLocaleString()}
            </p>
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export Report
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Total Records</p>
          <p className="text-2xl font-bold text-gray-900">{report.summary.totalRecords}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Matched</p>
          <p className="text-2xl font-bold text-green-600 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {report.summary.matched}
          </p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Unmatched</p>
          <p className="text-2xl font-bold text-red-600 flex items-center gap-2">
            <TrendingDown className="w-5 h-5" />
            {report.summary.unmatched}
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Auto-Approved</p>
          <p className="text-2xl font-bold text-blue-600">{report.summary.autoApproved}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Manual Review</p>
          <p className="text-2xl font-bold text-yellow-600">{report.summary.manualReview}</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 mb-1">Total Variances</p>
          <p className="text-2xl font-bold text-orange-600">{report.summary.totalVariances}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white border border-gray-200 rounded-lg mb-6">
        <div className="flex gap-2 p-2">
          {[
            { value: 'all', label: 'All' },
            { value: 'MATCHED', label: 'Matched' },
            { value: 'AUTO_APPROVED', label: 'Auto-Approved' },
            { value: 'MANUAL_REVIEW', label: 'Manual Review' },
            { value: 'MISSING_IN_FUND', label: 'Missing in Fund' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Row
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Account
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Goal Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Transaction ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Match Score
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Variances
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.map((txn) => (
                <React.Fragment key={txn.rowNumber}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{txn.rowNumber}</td>
                    <td className="px-4 py-3 text-sm">{txn.client}</td>
                    <td className="px-4 py-3 text-sm font-mono">{txn.accountNumber}</td>
                    <td className="px-4 py-3 text-sm font-mono">{txn.goalNumber}</td>
                    <td className="px-4 py-3 text-sm font-mono">{txn.transactionId}</td>
                    <td className="px-4 py-3 text-sm">
                      {new Date(txn.transactionDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {txn.totalAmount.toLocaleString('en-UG', {
                        style: 'currency',
                        currency: 'UGX',
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      <span
                        className={`font-semibold ${
                          txn.matchScore >= 90
                            ? 'text-green-600'
                            : txn.matchScore >= 70
                            ? 'text-yellow-600'
                            : 'text-red-600'
                        }`}
                      >
                        {txn.matchScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getStatusIcon(txn.status)}
                        <span
                          className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(
                            txn.status
                          )}`}
                        >
                          {txn.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {txn.variances.length > 0 ? (
                        <span className="text-orange-600 font-semibold">
                          {txn.variances.length}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>

                  {/* Variance Details Row */}
                  {txn.variances.length > 0 && (
                    <tr className="bg-gray-50">
                      <td colSpan={10} className="px-4 py-3">
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-gray-700 mb-2">Variances:</p>
                          {txn.variances.map((variance, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-4 text-sm bg-white p-3 rounded border border-gray-200"
                            >
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded ${getSeverityBadge(
                                  variance.severity
                                )}`}
                              >
                                {variance.severity}
                              </span>
                              <span className="font-medium text-gray-700">{variance.type}</span>
                              <span className="text-gray-600">{variance.description}</span>
                              {variance.difference && (
                                <span className="font-mono text-gray-900">
                                  Δ {variance.difference.toLocaleString()}
                                </span>
                              )}
                              {variance.autoApproved && (
                                <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800">
                                  Auto-Approved
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filteredTransactions.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No transactions found for this filter
          </div>
        )}
      </div>
    </div>
  );
};

export default ReconciliationReport;
