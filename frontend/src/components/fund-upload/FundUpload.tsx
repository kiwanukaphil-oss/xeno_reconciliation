import React, { useState, useEffect, useRef } from 'react';
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
  uploadFundFile,
  downloadTemplate,
  getBatchStatus,
  getAllBatches,
  getBatchSummary,
  getNewEntities,
  approveEntities,
  cancelBatch,
  rollbackBatch,
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

interface ValidationWarning {
  field: string;
  value: any;
  message: string;
  severity: string;
  errorCode: string;
  rowNumber: number;
  suggestedAction: string;
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
  validationWarnings: ValidationWarning[];
  uploadedAt: string;
}

const FundUpload = () => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [selectedBatchSummary, setSelectedBatchSummary] = useState<BatchSummary | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  // Approval workflow state
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approvalBatchId, setApprovalBatchId] = useState<string | null>(null);
  const [newEntitiesData, setNewEntitiesData] = useState<any>(null);
  const [approving, setApproving] = useState(false);

  // Track which batches have already shown approval dialog (to avoid showing multiple times)
  const shownApprovalDialogs = useRef<Set<string>>(new Set());

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
      const result = await getAllBatches(1, 12); // Fetch only last 12 uploads
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
      console.error('Failed to fetch batches:', error);
      alert(`Failed to load upload history: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllBatchesForDialog = async (page: number) => {
    try {
      setLoadingAllBatches(true);
      const result = await getAllBatches(page, 20); // 20 per page for dialog
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
      setTotalPages(result.totalPages || 1);
    } catch (error) {
      console.error('Failed to fetch all batches:', error);
      alert(`Failed to load all uploads: ${(error as Error).message}`);
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
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(fileExtension)) {
      alert('Please upload only Excel (.xlsx, .xls) or CSV files');
      return;
    }

    setUploading(true);

    try {
      const result = await uploadFundFile(file);
      console.log('=== UPLOAD RESPONSE ===', result);
      console.log('Status received:', result.status);
      console.log('Batch ID:', result.batchId);

      // Add to batches list
      const newBatch: BatchInfo = {
        batchId: result.batchId,
        fileName: result.fileName,
        fileSize: result.fileSize,
        rowCount: result.rowCount,
        processingStatus: result.status.toUpperCase(),
        uploadedAt: new Date().toISOString(),
      };

      console.log('=== NEW BATCH ADDED TO STATE ===', newBatch);
      console.log('Processing status (uppercase):', newBatch.processingStatus);

      setBatches((prev) => {
        const updated = [newBatch, ...prev];
        console.log('=== BATCHES STATE UPDATED ===', updated.length, 'batches');
        return updated;
      });
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fund_transactions_template.csv';
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
      ['QUEUED', 'PARSING', 'VALIDATING', 'PROCESSING', 'WAITING_FOR_APPROVAL'].includes(
        b.processingStatus
      )
    );

    console.log('=== POLLING USEEFFECT TRIGGERED ===');
    console.log('Total batches in state:', batches.length);
    console.log('Active batches to poll:', activeBatches.length);
    if (activeBatches.length > 0) {
      console.log(
        'Active batches:',
        activeBatches.map((b) => ({
          batchId: b.batchId.substring(0, 8) + '...',
          fileName: b.fileName,
          status: b.processingStatus,
        }))
      );
    }

    if (activeBatches.length === 0) {
      console.log('No active batches, polling will not start');
      return;
    }

    console.log('Starting polling interval (every 2 seconds)');
    const interval = setInterval(async () => {
      console.log('=== POLLING TICK ===');
      for (const batch of activeBatches) {
        try {
          console.log(
            `Fetching status for batch ${batch.batchId.substring(0, 8)}... (current: ${batch.processingStatus})`
          );
          const status = await getBatchStatus(batch.batchId);
          console.log(`Status received from API: ${status.processingStatus}`);

          // Check if status changed to WAITING_FOR_APPROVAL
          if (
            status.processingStatus === 'WAITING_FOR_APPROVAL' &&
            batch.processingStatus !== 'WAITING_FOR_APPROVAL' &&
            !shownApprovalDialogs.current.has(batch.batchId)
          ) {
            console.log('=== STATUS CHANGED TO WAITING_FOR_APPROVAL ===');
            console.log('Opening approval modal...');
            // Fetch approval data and show modal
            await handleShowApprovalModal(batch.batchId);
            shownApprovalDialogs.current.add(batch.batchId);
          }

          console.log(
            `Updating batch ${batch.batchId.substring(0, 8)}... status to ${status.processingStatus}`
          );
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
    }, 2000); // Poll every 2 seconds

    return () => {
      console.log('Cleaning up polling interval');
      clearInterval(interval);
    };
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
      case 'WAITING_FOR_APPROVAL':
        return 'text-yellow-600 bg-yellow-50';
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
      const summary = await getBatchSummary(batchId);
      setSelectedBatchSummary(summary);
      setShowValidationDialog(true);
    } catch (error) {
      console.error('Failed to fetch batch summary:', error);
      alert('Failed to load validation summary');
    }
  };

  // Show approval modal for batches waiting for approval
  const handleShowApprovalModal = async (batchId: string) => {
    try {
      const [summary, entities] = await Promise.all([
        getBatchSummary(batchId),
        getNewEntities(batchId),
      ]);

      setSelectedBatchSummary(summary);
      setNewEntitiesData(entities);
      setApprovalBatchId(batchId);
      setShowApprovalDialog(true);
    } catch (error) {
      console.error('Failed to fetch approval data:', error);
      alert('Failed to load approval data');
    }
  };

  // Handle approve action
  const handleApprove = async () => {
    if (!approvalBatchId) return;

    try {
      setApproving(true);
      await approveEntities(approvalBatchId, {
        approvalStatus: 'approved',
        approvedBy: 'user', // TODO: Get from auth
      });

      // Close modal and refresh batches
      setShowApprovalDialog(false);
      setApprovalBatchId(null);
      setNewEntitiesData(null);
      setSelectedBatchSummary(null);

      // Refresh batches list
      await fetchBatches();
    } catch (error) {
      console.error('Failed to approve entities:', error);
      alert(`Failed to approve: ${(error as Error).message}`);
    } finally {
      setApproving(false);
    }
  };

  // Handle reject action
  const handleReject = async () => {
    if (!approvalBatchId) return;

    try {
      setApproving(true);
      await approveEntities(approvalBatchId, {
        approvalStatus: 'rejected',
        approvedBy: 'user', // TODO: Get from auth
      });

      // Close modal and refresh batches
      setShowApprovalDialog(false);
      setApprovalBatchId(null);
      setNewEntitiesData(null);
      setSelectedBatchSummary(null);

      // Refresh batches list
      await fetchBatches();

      alert('Batch rejected. New entities were not created.');
    } catch (error) {
      console.error('Failed to reject entities:', error);
      alert(`Failed to reject: ${(error as Error).message}`);
    } finally {
      setApproving(false);
    }
  };

  // Handle rollback/delete batch
  const handleRollbackBatch = async (batchId: string, fileName: string) => {
    const confirmMessage =
      `Are you sure you want to delete this batch?\n\n` +
      `File: ${fileName}\n\n` +
      `This will permanently delete:\n` +
      `- All fund transactions from this batch\n` +
      `- Any goals, accounts, and clients that have no other transactions\n\n` +
      `This action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const result = await rollbackBatch(batchId);

      // Show success message with details
      const message =
        `Batch deleted successfully!\n\n` +
        `Deleted:\n` +
        `- ${result.deletedCounts.fundTransactions} fund transactions\n` +
        `- ${result.deletedCounts.goals} goals\n` +
        `- ${result.deletedCounts.accounts} accounts\n` +
        `- ${result.deletedCounts.clients} clients`;

      alert(message);

      // Refresh batches list
      await fetchBatches();
    } catch (error) {
      console.error('Failed to rollback batch:', error);
      alert(`Failed to delete batch: ${(error as Error).message}`);
    }
  };

  // Helper function to normalize validation data (handle both array and object formats)
  const normalizeValidationData = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    // If it's an object (error during processing), convert to array format
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

  const getValidationSummary = () => {
    if (!selectedBatchSummary) return {};

    const errors = normalizeValidationData(selectedBatchSummary.validationErrors);
    const warnings = normalizeValidationData(selectedBatchSummary.validationWarnings);
    const allValidations = [...errors, ...warnings];

    const summary: Record<string, { count: number; severity: string }> = {};
    allValidations.forEach((item: any) => {
      if (!summary[item.errorCode]) {
        summary[item.errorCode] = { count: 0, severity: item.severity };
      }
      summary[item.errorCode].count++;
    });
    return summary;
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
          <h2 className="text-lg font-semibold text-gray-900">Upload Fund Transaction File</h2>
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
              <p className="text-lg font-medium text-gray-900 mb-2">Drag and drop your file here</p>
              <p className="text-sm text-gray-500 mb-4">or click to browse files</p>
              <input
                type="file"
                id="file-upload"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                className="hidden"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer transition-colors"
              >
                <FileText className="h-4 w-4 mr-2" />
                Choose File
              </label>
              <p className="text-xs text-gray-500 mt-4">
                Supported formats: CSV, Excel (.xlsx, .xls) • Max size: 100MB
              </p>
            </>
          )}
        </div>
      </div>

      {/* Upload History */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Upload History (Last 12)</h2>
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
          <div className="text-center text-gray-500 py-8">No upload history available</div>
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
                        {/* Actions for WAITING_FOR_APPROVAL */}
                        {batch.processingStatus === 'WAITING_FOR_APPROVAL' && (
                          <>
                            <button
                              onClick={() => handleShowApprovalModal(batch.batchId)}
                              className="inline-flex items-center px-3 py-1 text-yellow-700 hover:text-yellow-900 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                            >
                              <AlertCircle className="h-4 w-4 mr-1" />
                              Review & Approve
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm('Are you sure you want to cancel this batch?')) {
                                  try {
                                    await cancelBatch(batch.batchId);
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
                          </>
                        )}

                        {/* Actions for COMPLETED or FAILED */}
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
                  Validation Summary - {selectedBatchSummary.fileName}
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
                  <span className="text-gray-600">
                    Total Records: {selectedBatchSummary.totalRecords}
                  </span>
                  <span className="text-gray-600">
                    Processed: {selectedBatchSummary.processedRecords}
                  </span>
                  {getCriticalErrors().length > 0 && (
                    <span className="text-red-600 font-semibold">
                      Critical Errors: {getCriticalErrors().length}
                    </span>
                  )}
                  {getWarnings().length > 0 && (
                    <span className="text-yellow-600 font-semibold">
                      Warnings: {getWarnings().length}
                    </span>
                  )}
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
              {/* Validation Summary Cards */}
              <div className="mb-6">
                <h4 className="text-md font-semibold text-gray-900 mb-3">
                  Validation Items Summary
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(getValidationSummary()).map(([code, data]) => (
                    <div
                      key={code}
                      className={`border rounded-lg p-3 ${
                        data.severity === 'CRITICAL'
                          ? 'bg-red-50 border-red-200'
                          : 'bg-yellow-50 border-yellow-200'
                      }`}
                    >
                      <div
                        className={`text-xs font-medium ${
                          data.severity === 'CRITICAL' ? 'text-red-600' : 'text-yellow-600'
                        }`}
                      >
                        {code.replace(/_/g, ' ')}
                      </div>
                      <div
                        className={`text-lg font-semibold mt-1 ${
                          data.severity === 'CRITICAL' ? 'text-red-900' : 'text-yellow-900'
                        }`}
                      >
                        {data.count} {data.severity === 'CRITICAL' ? 'errors' : 'warnings'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Critical Errors Section */}
              {getCriticalErrors().length > 0 && (
                <div className="mb-6">
                  <h4 className="text-md font-semibold text-red-900 mb-3">
                    Critical Errors ({getCriticalErrors().length})
                  </h4>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-red-900 font-medium">
                      These errors prevented the upload from being processed:
                    </p>
                  </div>
                  <div className="overflow-x-auto border border-red-200 rounded-lg">
                    <table className="min-w-full divide-y divide-red-200">
                      <thead className="bg-red-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">
                            Row
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">
                            Field
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">
                            Error
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">
                            Value
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-red-900 uppercase">
                            Suggested Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-red-100">
                        {getCriticalErrors()
                          .slice(0, 50)
                          .map((error: any, index) => (
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
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {error.suggestedAction}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {getCriticalErrors().length > 50 && (
                    <p className="text-sm text-gray-500 mt-2">
                      Showing first 50 of {getCriticalErrors().length} errors
                    </p>
                  )}
                </div>
              )}

              {/* Warnings Section */}
              {getWarnings().length > 0 && (
                <div>
                  <h4 className="text-md font-semibold text-yellow-900 mb-3">
                    Reconciliation Warnings ({getWarnings().length})
                  </h4>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-yellow-900 font-medium">
                      These items were imported but require reconciliation review:
                    </p>
                  </div>
                  <div className="overflow-x-auto border border-yellow-200 rounded-lg">
                    <table className="min-w-full divide-y divide-yellow-200">
                      <thead className="bg-yellow-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">
                            Row
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">
                            Field
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">
                            Warning
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">
                            Value
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-yellow-900 uppercase">
                            Suggested Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-yellow-100">
                        {getWarnings()
                          .slice(0, 100)
                          .map((warning: any, index) => (
                            <tr key={index} className="hover:bg-yellow-50">
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">
                                {warning.rowNumber}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {warning.field || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{warning.message}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono max-w-xs truncate">
                                {typeof warning.value === 'object'
                                  ? JSON.stringify(warning.value)
                                  : String(warning.value || '-')}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {warning.suggestedAction}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {getWarnings().length > 100 && (
                    <p className="text-sm text-gray-500 mt-2">
                      Showing first 100 of {getWarnings().length} warnings
                    </p>
                  )}
                </div>
              )}

              {/* No Validation Issues */}
              {getCriticalErrors().length === 0 && getWarnings().length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-900">No validation issues found!</p>
                  <p className="text-sm text-gray-500 mt-2">
                    All {selectedBatchSummary.processedRecords} transactions passed validation.
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

      {/* Approval Dialog */}
      {showApprovalDialog && selectedBatchSummary && newEntitiesData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-yellow-600" />
                Approval Required
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                New entities detected. Please review and approve to continue processing.
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Batch Info */}
              <div className="mb-6 bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Batch Information</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">File:</span>{' '}
                    <span className="font-medium">{selectedBatchSummary.fileName}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Total Records:</span>{' '}
                    <span className="font-medium">{selectedBatchSummary.totalRecords}</span>
                  </div>
                </div>
              </div>

              {/* New Entities Summary */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">New Entities Detected</h3>
                <div className="grid grid-cols-3 gap-4">
                  {newEntitiesData.summary && (
                    <>
                      <div className="bg-blue-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {newEntitiesData.summary.clients || 0}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">New Clients</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {newEntitiesData.summary.accounts || 0}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">New Accounts</div>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600">
                          {newEntitiesData.summary.goals || 0}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">New Goals</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Validation Warnings */}
              {selectedBatchSummary.validationWarnings &&
                normalizeValidationData(selectedBatchSummary.validationWarnings).length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-600" />
                      Validation Warnings (
                      {normalizeValidationData(selectedBatchSummary.validationWarnings).length})
                    </h3>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                      <div className="space-y-2">
                        {normalizeValidationData(selectedBatchSummary.validationWarnings)
                          .slice(0, 10)
                          .map((warning: any, idx: number) => (
                            <div
                              key={idx}
                              className="text-sm border-b border-yellow-200 pb-2 last:border-b-0"
                            >
                              <div className="font-medium text-yellow-900">
                                Row {warning.rowNumber}: {warning.message}
                              </div>
                              {warning.suggestedAction && (
                                <div className="text-yellow-700 text-xs mt-1">
                                  → {warning.suggestedAction}
                                </div>
                              )}
                            </div>
                          ))}
                        {normalizeValidationData(selectedBatchSummary.validationWarnings).length >
                          10 && (
                          <div className="text-xs text-yellow-700 text-center pt-2">
                            +{' '}
                            {normalizeValidationData(selectedBatchSummary.validationWarnings)
                              .length - 10}{' '}
                            more warnings...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {/* New Entities Details */}
              {newEntitiesData.newEntitiesReport && (
                <div className="space-y-4">
                  {/* New Clients */}
                  {newEntitiesData.newEntitiesReport.clients &&
                    newEntitiesData.newEntitiesReport.clients.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">New Clients:</h4>
                        <div className="bg-gray-50 rounded p-3 space-y-1 text-sm">
                          {newEntitiesData.newEntitiesReport.clients.map(
                            (client: any, idx: number) => (
                              <div key={idx} className="flex justify-between">
                                <span className="font-medium">{client.clientName}</span>
                                <span className="text-gray-600">
                                  {client.transactionCount} transaction(s)
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* New Accounts */}
                  {newEntitiesData.newEntitiesReport.accounts &&
                    newEntitiesData.newEntitiesReport.accounts.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">New Accounts:</h4>
                        <div className="bg-gray-50 rounded p-3 space-y-1 text-sm">
                          {newEntitiesData.newEntitiesReport.accounts.map(
                            (account: any, idx: number) => (
                              <div key={idx} className="flex justify-between">
                                <span className="font-medium">
                                  {account.accountNumber} ({account.accountType})
                                </span>
                                <span className="text-gray-600">
                                  {account.transactionCount} transaction(s)
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* New Goals */}
                  {newEntitiesData.newEntitiesReport.goals &&
                    newEntitiesData.newEntitiesReport.goals.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">New Goals:</h4>
                        <div className="bg-gray-50 rounded p-3 space-y-1 text-sm">
                          {newEntitiesData.newEntitiesReport.goals.map((goal: any, idx: number) => (
                            <div key={idx} className="flex justify-between">
                              <span className="font-medium">
                                {goal.goalNumber} - {goal.goalTitle}
                              </span>
                              <span className="text-gray-600">
                                {goal.transactionCount} transaction(s)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Footer with Actions */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
              <p className="text-sm text-gray-600">
                Approving will create these new entities and continue processing.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleReject}
                  disabled={approving}
                  className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {approving ? 'Processing...' : 'Reject'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {approving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    'Approve & Continue'
                  )}
                </button>
              </div>
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
                All Upload History
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
                              {/* Actions for WAITING_FOR_APPROVAL */}
                              {batch.processingStatus === 'WAITING_FOR_APPROVAL' && (
                                <>
                                  <button
                                    onClick={() => {
                                      setShowAllUploadsDialog(false);
                                      handleShowApprovalModal(batch.batchId);
                                    }}
                                    className="inline-flex items-center px-3 py-1 text-yellow-700 hover:text-yellow-900 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                                  >
                                    <AlertCircle className="h-4 w-4 mr-1" />
                                    Review
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (confirm('Are you sure you want to cancel this batch?')) {
                                        try {
                                          await cancelBatch(batch.batchId);
                                          setShowAllUploadsDialog(false);
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
                                </>
                              )}

                              {/* Actions for COMPLETED or FAILED */}
                              {(batch.processingStatus === 'COMPLETED' ||
                                batch.processingStatus === 'FAILED') && (
                                <>
                                  <button
                                    onClick={() => {
                                      setShowAllUploadsDialog(false);
                                      handleViewValidation(batch.batchId);
                                    }}
                                    className="inline-flex items-center px-3 py-1 text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                                  >
                                    <AlertCircle className="h-4 w-4 mr-1" />
                                    View Details
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (
                                        confirm(
                                          `Are you sure you want to delete this batch?\n\nFile: ${batch.fileName}\n\nThis action cannot be undone.`
                                        )
                                      ) {
                                        try {
                                          await rollbackBatch(batch.batchId);
                                          await fetchAllBatchesForDialog(currentPage);
                                          await fetchBatches();
                                        } catch (error) {
                                          alert(`Failed to delete batch: ${(error as Error).message}`);
                                        }
                                      }
                                    }}
                                    className="inline-flex items-center px-3 py-1 text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                                    title="Delete this batch and all associated data"
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
              <div className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || loadingAllBatches}
                  className="inline-flex items-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </button>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || loadingAllBatches}
                  className="inline-flex items-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </button>
              </div>
              <button
                onClick={() => setShowAllUploadsDialog(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
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

export default FundUpload;
