import React, { useState, useEffect } from 'react';
import {
  Upload,
  FileText,
  Loader2,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Trash2,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  uploadBankTransactionFile,
  downloadBankTemplate,
  getBankUploadBatchStatus,
  getAllBankUploadBatches,
  getBankUploadBatchSummary,
  cancelBankUploadBatch,
  rollbackBankUploadBatch,
} from '../../services/api';

interface BatchInfo {
  batchId: string;
  fileName: string;
  fileSize: number;
  rowCount: number;
  processingStatus: string;
  uploadedAt: string;
  totalRecords?: number;
  processedRecords?: number;
  failedRecords?: number;
}

interface BatchSummary {
  id: string;
  batchNumber: string;
  fileName: string;
  processingStatus: string;
  validationStatus: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  validationErrors: any[];
  validationWarnings: any[];
  uploadedAt: string;
  totalAmount: number;
}

const BankUpload = () => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [selectedBatchSummary, setSelectedBatchSummary] = useState<BatchSummary | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  // View all uploads dialog state
  const [showAllUploadsDialog, setShowAllUploadsDialog] = useState(false);
  const [allBatches, setAllBatches] = useState<BatchInfo[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingAllBatches, setLoadingAllBatches] = useState(false);

  // Fetch batches on mount
  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const result = await getAllBankUploadBatches(1, 12);
      const formattedBatches: BatchInfo[] = result.data.map((batch: any) => ({
        batchId: batch.id,
        fileName: batch.fileName,
        fileSize: Number(batch.fileSize),
        rowCount: batch.totalRecords || 0,
        processingStatus: batch.processingStatus,
        uploadedAt: batch.uploadedAt,
        totalRecords: batch.totalRecords,
        processedRecords: batch.processedRecords,
        failedRecords: batch.failedRecords,
      }));
      setBatches(formattedBatches);
    } catch (error) {
      console.error('Failed to fetch bank batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllBatchesForDialog = async (page: number) => {
    try {
      setLoadingAllBatches(true);
      const result = await getAllBankUploadBatches(page, 20);
      const formattedBatches: BatchInfo[] = result.data.map((batch: any) => ({
        batchId: batch.id,
        fileName: batch.fileName,
        fileSize: Number(batch.fileSize),
        rowCount: batch.totalRecords || 0,
        processingStatus: batch.processingStatus,
        uploadedAt: batch.uploadedAt,
        totalRecords: batch.totalRecords,
        processedRecords: batch.processedRecords,
        failedRecords: batch.failedRecords,
      }));
      setAllBatches(formattedBatches);
      setTotalPages(result.pagination?.pages || 1);
    } catch (error) {
      console.error('Failed to fetch all bank batches:', error);
    } finally {
      setLoadingAllBatches(false);
    }
  };

  const handleViewAllUploads = async () => {
    setCurrentPage(1);
    setShowAllUploadsDialog(true);
    await fetchAllBatchesForDialog(1);
  };

  const handlePageChange = async (newPage: number) => {
    setCurrentPage(newPage);
    await fetchAllBatchesForDialog(newPage);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    const file = files[0];
    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(fileExtension)) {
      alert('Please upload CSV or Excel files (.csv, .xlsx, .xls) for bank transactions');
      return;
    }

    setUploading(true);

    try {
      const result = await uploadBankTransactionFile(file);

      const newBatch: BatchInfo = {
        batchId: result.batchId,
        fileName: result.fileName,
        fileSize: result.fileSize,
        rowCount: result.rowCount,
        processingStatus: result.status.toUpperCase(),
        uploadedAt: new Date().toISOString(),
      };

      setBatches((prev) => [newBatch, ...prev]);
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadBankTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bank_transactions_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Template download failed:', error);
      alert(`Template download failed: ${(error as Error).message}`);
    }
  };

  // Poll for batch status updates
  useEffect(() => {
    const activeBatches = batches.filter((b) =>
      ['QUEUED', 'PARSING', 'VALIDATING', 'PROCESSING'].includes(b.processingStatus)
    );

    if (activeBatches.length === 0) {
      return;
    }

    const interval = setInterval(async () => {
      for (const batch of activeBatches) {
        try {
          const status = await getBankUploadBatchStatus(batch.batchId);

          setBatches((prev) =>
            prev.map((b) =>
              b.batchId === batch.batchId
                ? {
                    ...b,
                    processingStatus: status.processingStatus,
                    totalRecords: status.totalRecords,
                    processedRecords: status.processedRecords,
                    failedRecords: status.failedRecords,
                  }
                : b
            )
          );
        } catch (error) {
          console.error('Failed to fetch batch status:', error);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [batches]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'FAILED':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-blue-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-600 bg-green-50';
      case 'FAILED':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-blue-600 bg-blue-50';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const handleViewValidation = async (batchId: string) => {
    try {
      const summary = await getBankUploadBatchSummary(batchId);
      setSelectedBatchSummary(summary);
      setShowValidationDialog(true);
    } catch (error) {
      console.error('Failed to fetch batch summary:', error);
      alert('Failed to load validation summary');
    }
  };

  const handleRollbackBatch = async (batchId: string, fileName: string) => {
    const confirmMessage =
      `Are you sure you want to delete this batch?\n\n` +
      `File: ${fileName}\n\n` +
      `This will permanently delete all bank transactions from this batch.\n\n` +
      `This action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const result = await rollbackBankUploadBatch(batchId);
      alert(`Batch deleted successfully!\n\nDeleted ${result.deletedCounts.bankTransactions} bank transactions`);
      await fetchBatches();
    } catch (error) {
      console.error('Failed to rollback batch:', error);
      alert(`Failed to delete batch: ${(error as Error).message}`);
    }
  };

  const normalizeValidationData = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') {
      return [
        {
          errorCode: 'PROCESSING_ERROR',
          message: data.error || 'An error occurred during processing',
          severity: 'CRITICAL',
          rowNumber: 0,
        },
      ];
    }
    return [];
  };

  const getCriticalErrors = () => {
    if (!selectedBatchSummary) return [];
    return normalizeValidationData(selectedBatchSummary.validationErrors);
  };

  const getWarnings = () => {
    if (!selectedBatchSummary) return [];
    return normalizeValidationData(selectedBatchSummary.validationWarnings);
  };

  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Upload Bank Transaction File</h2>
          <button
            onClick={handleDownloadTemplate}
            className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </button>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {uploading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="h-16 w-16 text-blue-600 animate-spin mb-4" />
              <p className="text-lg font-medium text-gray-900">Uploading file...</p>
              <p className="text-sm text-gray-500 mt-1">Please wait while we process your file</p>
            </div>
          ) : (
            <>
              <Upload className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">Drag and drop your bank file here</p>
              <p className="text-sm text-gray-500 mb-4">or click to browse files</p>
              <input
                type="file"
                id="bank-file-upload"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                className="hidden"
              />
              <label
                htmlFor="bank-file-upload"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer transition-colors"
              >
                <FileText className="h-4 w-4 mr-2" />
                Choose File
              </label>
              <p className="text-xs text-gray-500 mt-4">Supported formats: CSV, Excel (.xlsx, .xls)</p>
            </>
          )}
        </div>
      </div>

      {/* Upload History */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Bank Upload History (Last 12)</h2>
          <button
            onClick={handleViewAllUploads}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <History className="h-4 w-4 mr-2" />
            View All Uploads
          </button>
        </div>
        {loading ? (
          <div className="text-center text-gray-500 py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            Loading upload history...
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No bank upload history available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Records
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploaded At
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {batches.map((batch) => (
                  <tr key={batch.batchId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileText className="h-5 w-5 text-gray-400 mr-3" />
                        <div className="text-sm font-medium text-gray-900">{batch.fileName}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getStatusIcon(batch.processingStatus)}
                        <span
                          className={`ml-2 px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                            batch.processingStatus
                          )}`}
                        >
                          {batch.processingStatus}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {batch.totalRecords !== undefined ? (
                        <div>
                          <div>Total: {batch.totalRecords}</div>
                          {batch.processedRecords !== undefined && (
                            <div className="text-xs text-gray-500">
                              Processed: {batch.processedRecords}
                              {batch.failedRecords ? ` | Failed: ${batch.failedRecords}` : ''}
                            </div>
                          )}
                        </div>
                      ) : (
                        batch.rowCount
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatFileSize(batch.fileSize)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(batch.uploadedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        {(batch.processingStatus === 'COMPLETED' ||
                          batch.processingStatus === 'FAILED') && (
                          <>
                            <button
                              onClick={() => handleViewValidation(batch.batchId)}
                              className="inline-flex items-center px-3 py-1 text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                            >
                              <AlertCircle className="h-4 w-4 mr-1" />
                              View Details
                            </button>
                            <button
                              onClick={() => handleRollbackBatch(batch.batchId, batch.fileName)}
                              className="inline-flex items-center px-3 py-1 text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                              title="Delete this batch and all associated data"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </button>
                          </>
                        )}
                        {['QUEUED', 'PARSING', 'VALIDATING', 'PROCESSING'].includes(batch.processingStatus) && (
                          <button
                            onClick={async () => {
                              if (confirm('Are you sure you want to cancel this batch?')) {
                                try {
                                  await cancelBankUploadBatch(batch.batchId);
                                  await fetchBatches();
                                } catch (error) {
                                  alert(`Failed to cancel batch: ${(error as Error).message}`);
                                }
                              }
                            }}
                            className="inline-flex items-center px-3 py-1 text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Validation Details Dialog */}
      {showValidationDialog && selectedBatchSummary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Bank Upload Summary - {selectedBatchSummary.fileName}
                </h3>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-gray-600">Batch: {selectedBatchSummary.batchNumber}</span>
                  <span className="text-gray-600">
                    Status:{' '}
                    <span
                      className={`font-semibold ${selectedBatchSummary.processingStatus === 'COMPLETED' ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {selectedBatchSummary.processingStatus}
                    </span>
                  </span>
                  <span className="text-gray-600">Total Records: {selectedBatchSummary.totalRecords}</span>
                  <span className="text-gray-600">Processed: {selectedBatchSummary.processedRecords}</span>
                </div>
              </div>
              <button
                onClick={() => setShowValidationDialog(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="h-6 w-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Critical Errors Section */}
              {getCriticalErrors().length > 0 && (
                <div className="mb-6">
                  <h4 className="text-md font-semibold text-red-900 mb-3">
                    Validation Errors ({getCriticalErrors().length})
                  </h4>
                  <div className="overflow-x-auto border border-red-200 rounded-lg">
                    <table className="min-w-full divide-y divide-red-200">
                      <thead className="bg-red-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">Row</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">Field</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">Error</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">Value</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-red-100">
                        {getCriticalErrors()
                          .slice(0, 50)
                          .map((error: any, index: number) => (
                            <tr key={index} className="hover:bg-red-50">
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">
                                {error.rowNumber}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {error.field || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{error.message}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono max-w-xs truncate">
                                {typeof error.value === 'object'
                                  ? JSON.stringify(error.value)
                                  : String(error.value || '-')}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Warnings Section */}
              {getWarnings().length > 0 && (
                <div className="mb-6">
                  <h4 className="text-md font-semibold text-yellow-900 mb-3">
                    Warnings ({getWarnings().length})
                  </h4>
                  <div className="overflow-x-auto border border-yellow-200 rounded-lg">
                    <table className="min-w-full divide-y divide-yellow-200">
                      <thead className="bg-yellow-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">Row</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">Field</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">Warning</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-yellow-100">
                        {getWarnings()
                          .slice(0, 50)
                          .map((warning: any, index: number) => (
                            <tr key={index} className="hover:bg-yellow-50">
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">
                                {warning.rowNumber}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {warning.field || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{warning.message}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No Validation Issues */}
              {getCriticalErrors().length === 0 && getWarnings().length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-900">Upload completed successfully!</p>
                  <p className="text-sm text-gray-500 mt-2">
                    {selectedBatchSummary.processedRecords} bank transactions were uploaded.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowValidationDialog(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View All Uploads Dialog */}
      {showAllUploadsDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <History className="h-5 w-5" />
                All Bank Upload History
              </h3>
              <button
                onClick={() => setShowAllUploadsDialog(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="h-6 w-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingAllBatches ? (
                <div className="text-center text-gray-500 py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  Loading uploads...
                </div>
              ) : allBatches.length === 0 ? (
                <div className="text-center text-gray-500 py-8">No uploads found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">File Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">File Size</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploaded At</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {allBatches.map((batch) => (
                        <tr key={batch.batchId} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <FileText className="h-5 w-5 text-gray-400 mr-3" />
                              <div className="text-sm font-medium text-gray-900">{batch.fileName}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              {getStatusIcon(batch.processingStatus)}
                              <span
                                className={`ml-2 px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                                  batch.processingStatus
                                )}`}
                              >
                                {batch.processingStatus}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {batch.totalRecords || batch.rowCount || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatFileSize(batch.fileSize)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(batch.uploadedAt)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex justify-end gap-2">
                              {(batch.processingStatus === 'COMPLETED' || batch.processingStatus === 'FAILED') && (
                                <>
                                  <button
                                    onClick={() => {
                                      setShowAllUploadsDialog(false);
                                      handleViewValidation(batch.batchId);
                                    }}
                                    className="inline-flex items-center px-3 py-1 text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                                  >
                                    <AlertCircle className="h-4 w-4 mr-1" />
                                    View
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Delete batch ${batch.fileName}?`)) {
                                        try {
                                          await rollbackBankUploadBatch(batch.batchId);
                                          await fetchAllBatchesForDialog(currentPage);
                                          await fetchBatches();
                                        } catch (error) {
                                          alert(`Failed to delete: ${(error as Error).message}`);
                                        }
                                      }
                                    }}
                                    className="inline-flex items-center px-3 py-1 text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer with Pagination */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
              <div className="text-sm text-gray-600">Page {currentPage} of {totalPages}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || loadingAllBatches}
                  className="inline-flex items-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </button>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || loadingAllBatches}
                  className="inline-flex items-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </button>
              </div>
              <button
                onClick={() => setShowAllUploadsDialog(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankUpload;
