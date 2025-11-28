import React, { useState, useEffect } from 'react';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Eye,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  uploadBankFile,
  getAllBankBatches,
  getBankBatchSummary,
} from '../../services/api';

interface BankBatchInfo {
  id: string;
  batchNumber: string;
  fileName: string;
  processingStatus: string;
  totalRecords: number;
  processedRecords: number;
  totalMatched: number;
  totalUnmatched: number;
  autoApprovedCount: number;
  manualReviewCount: number;
  uploadedAt: string;
  uploadedBy: string;
}

interface BankBatchSummary {
  batch: {
    id: string;
    batchNumber: string;
    fileName: string;
    processingStatus: string;
    totalRecords: number;
    processedRecords: number;
    failedRecords: number;
    totalMatched: number;
    totalUnmatched: number;
    totalVariances: number;
    autoApprovedCount: number;
    manualReviewCount: number;
    uploadedAt: string;
    uploadedBy: string;
  };
  transactions: Array<{
    id: string;
    goalNumber: string;
    transactionId: string;
    transactionDate: string;
    totalAmount: number;
    reconciliationStatus: string;
    matchScore: number;
    varianceCount: number;
  }>;
}

const BankReconciliation = () => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<BankBatchInfo[]>([]);
  const [selectedBatchSummary, setSelectedBatchSummary] = useState<BankBatchSummary | null>(null);
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadedBy] = useState('Admin'); // TODO: Get from auth context

  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const result = await getAllBankBatches(20, 0);
      setBatches(result.data.batches);
    } catch (error) {
      console.error('Failed to fetch bank batches:', error);
      alert(`Failed to load upload history: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    try {
      setUploading(true);

      const metadata = {
        period: new Date().toISOString().slice(0, 7), // YYYY-MM
      };

      const result = await uploadBankFile(file, uploadedBy, metadata);

      alert(
        `Upload successful!\n\n` +
          `Batch: ${result.data.batchNumber}\n` +
          `Records: ${result.data.totalRecords}\n` +
          `Matched: ${result.data.totalMatched}\n` +
          `Unmatched: ${result.data.totalUnmatched}\n` +
          `Auto-Approved: ${result.data.autoApprovedCount}\n` +
          `Manual Review: ${result.data.manualReviewCount}`
      );

      // Refresh batch list
      await fetchBatches();
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleViewSummary = async (batchId: string) => {
    try {
      const summary = await getBankBatchSummary(batchId);
      setSelectedBatchSummary(summary.data);
      setShowSummaryDialog(true);
    } catch (error) {
      console.error('Failed to fetch batch summary:', error);
      alert(`Failed to load summary: ${(error as Error).message}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-600';
      case 'FAILED':
        return 'text-red-600';
      case 'PROCESSING':
      case 'PARSING':
      case 'VALIDATING':
        return 'text-blue-600';
      case 'QUEUED':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'FAILED':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'PROCESSING':
      case 'PARSING':
      case 'VALIDATING':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />;
      case 'QUEUED':
        return <Clock className="w-5 h-5 text-gray-600" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const getReconciliationStatusBadge = (status: string) => {
    const badges: { [key: string]: string } = {
      MATCHED: 'bg-green-100 text-green-800',
      AUTO_APPROVED: 'bg-blue-100 text-blue-800',
      MANUAL_REVIEW: 'bg-yellow-100 text-yellow-800',
      MISSING_IN_FUND: 'bg-red-100 text-red-800',
      VARIANCE_DETECTED: 'bg-orange-100 text-orange-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Bank Reconciliation</h1>
        <p className="text-gray-600">
          Upload bank transaction files to reconcile with fund system transactions
        </p>
      </div>

      {/* Upload Section */}
      <div className="mb-8">
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-16 h-16 text-blue-600 animate-spin mb-4" />
              <p className="text-lg font-medium text-gray-700">Processing upload...</p>
              <p className="text-sm text-gray-500 mt-2">
                Parsing, matching, and detecting variances
              </p>
            </div>
          ) : (
            <>
              <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Upload Bank Transaction File
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Drag and drop your CSV file here, or click to browse
              </p>
              <label className="inline-block">
                <input
                  type="file"
                  className="hidden"
                  accept=".csv"
                  onChange={handleFileInput}
                  disabled={uploading}
                />
                <span className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Select CSV File
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-4">
                Format: Date, First Name, Last Name, Acc Number, Goal Number, Total Amount,
                Fund Amounts, Transaction Type, Transaction ID
              </p>
            </>
          )}
        </div>
      </div>

      {/* Batches List */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Uploads</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No uploads yet</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(batch.processingStatus)}
                    <div>
                      <h3 className="font-semibold text-gray-900">{batch.batchNumber}</h3>
                      <p className="text-sm text-gray-600">{batch.fileName}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleViewSummary(batch.id)}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    View Details
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Total Records</p>
                    <p className="text-lg font-semibold">{batch.totalRecords}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Matched</p>
                    <p className="text-lg font-semibold text-green-600 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      {batch.totalMatched}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Auto-Approved</p>
                    <p className="text-lg font-semibold text-blue-600">
                      {batch.autoApprovedCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Manual Review</p>
                    <p className="text-lg font-semibold text-yellow-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {batch.manualReviewCount}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Uploaded by {batch.uploadedBy}</span>
                  <span>{new Date(batch.uploadedAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Dialog */}
      {showSummaryDialog && selectedBatchSummary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {selectedBatchSummary.batch.batchNumber}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedBatchSummary.batch.fileName}
                  </p>
                </div>
                <button
                  onClick={() => setShowSummaryDialog(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {/* Summary Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Total Records</p>
                  <p className="text-2xl font-bold">{selectedBatchSummary.batch.totalRecords}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Matched</p>
                  <p className="text-2xl font-bold text-green-600">
                    {selectedBatchSummary.batch.totalMatched}
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Auto-Approved</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {selectedBatchSummary.batch.autoApprovedCount}
                  </p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Manual Review</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {selectedBatchSummary.batch.manualReviewCount}
                  </p>
                </div>
              </div>

              {/* Transactions Table */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Transactions</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
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
                      {selectedBatchSummary.transactions.map((txn) => (
                        <tr key={txn.id} className="hover:bg-gray-50">
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
                            <span className="font-semibold">{txn.matchScore}%</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${getReconciliationStatusBadge(
                                txn.reconciliationStatus
                              )}`}
                            >
                              {txn.reconciliationStatus.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            {txn.varianceCount > 0 ? (
                              <span className="text-orange-600 font-semibold">
                                {txn.varianceCount}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankReconciliation;
