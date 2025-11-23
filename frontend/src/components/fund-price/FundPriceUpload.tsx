import { useState } from "react";
import { uploadFundPrices, downloadFundPriceTemplate } from "../../services/api";

interface UploadResult {
  success: boolean;
  message: string;
  summary?: {
    totalRecords: number;
    inserted: number;
    updated: number;
    failed: number;
  };
  errors?: Array<{
    row: number;
    error: string;
    data?: any;
  }>;
}

export function FundPriceUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const ext = selectedFile.name.toLowerCase().split(".").pop();
      if (!["csv", "xlsx", "xls"].includes(ext || "")) {
        setError("Please select a CSV or Excel file");
        setFile(null);
        return;
      }

      setFile(selectedFile);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file first");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const uploadResult = await uploadFundPrices(file);
      setResult(uploadResult);
      setFile(null);

      // Reset file input
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    } catch (err: any) {
      setError(err.message || "Failed to upload fund prices");
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadFundPriceTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fund_prices_template.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || "Failed to download template");
    }
  };

  return (
    <div className="fund-price-upload">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Upload Fund Prices</h2>
            <p className="text-muted">Upload daily fund prices (bid, mid, offer) for all funds</p>
          </div>
          <button onClick={handleDownloadTemplate} className="btn btn-secondary">
            Download Template
          </button>
        </div>

        <div className="card-body">
          {/* File Upload Section */}
          <div className="upload-section">
            <div className="form-group">
              <label htmlFor="file-input" className="form-label">
                Select CSV or Excel File
              </label>
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                disabled={uploading}
                className="form-control"
              />
              {file && (
                <div className="file-info">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">({(file.size / 1024).toFixed(2)} KB)</span>
                </div>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="btn btn-primary"
            >
              {uploading ? "Uploading..." : "Upload Fund Prices"}
            </button>
          </div>

          {/* Expected Format Info */}
          <div className="info-box">
            <h4>Expected Excel File Format:</h4>
            <div className="format-description">
              <p>Upload an Excel file with <strong>3 tabs</strong> (bid, mid, offer):</p>

              <div className="tab-example">
                <h5>Bid Tab:</h5>
                <table className="format-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>XUMMF</th>
                      <th>XUBF</th>
                      <th>XUDEF</th>
                      <th>XUREF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>2024-01-15</td>
                      <td>1250.50</td>
                      <td>1180.25</td>
                      <td>1095.80</td>
                      <td>1320.40</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="tab-example">
                <h5>Mid Tab:</h5>
                <table className="format-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>XUMMF</th>
                      <th>XUBF</th>
                      <th>XUDEF</th>
                      <th>XUREF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>2024-01-15</td>
                      <td>1251.00</td>
                      <td>1181.00</td>
                      <td>1096.50</td>
                      <td>1321.25</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="tab-example">
                <h5>Offer Tab:</h5>
                <table className="format-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>XUMMF</th>
                      <th>XUBF</th>
                      <th>XUDEF</th>
                      <th>XUREF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>2024-01-15</td>
                      <td>1251.50</td>
                      <td>1181.75</td>
                      <td>1097.20</td>
                      <td>1322.10</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="note">
              <strong>Note:</strong> Prices must satisfy: Bid Price ≤ Mid Price ≤ Offer Price
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="alert alert-error">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className={`alert ${result.success ? "alert-success" : "alert-warning"}`}>
              <h4>{result.message}</h4>
              {result.summary && (
                <div className="upload-summary">
                  <div className="summary-item">
                    <span className="label">Total Records:</span>
                    <span className="value">{result.summary.totalRecords}</span>
                  </div>
                  <div className="summary-item success">
                    <span className="label">Inserted:</span>
                    <span className="value">{result.summary.inserted}</span>
                  </div>
                  <div className="summary-item info">
                    <span className="label">Updated:</span>
                    <span className="value">{result.summary.updated}</span>
                  </div>
                  {result.summary.failed > 0 && (
                    <div className="summary-item error">
                      <span className="label">Failed:</span>
                      <span className="value">{result.summary.failed}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Error Details */}
              {result.errors && result.errors.length > 0 && (
                <div className="error-details">
                  <h5>Errors:</h5>
                  <ul className="error-list">
                    {result.errors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>
                        <strong>Row {err.row}:</strong> {err.error}
                      </li>
                    ))}
                    {result.errors.length > 10 && (
                      <li className="more-errors">
                        ... and {result.errors.length - 10} more errors
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .fund-price-upload {
          max-width: 900px;
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
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .card-header h2 {
          margin: 0 0 8px 0;
          color: #333;
        }

        .btn-secondary {
          background-color: #6c757d;
          color: white;
        }

        .btn-secondary:hover {
          background-color: #5a6268;
        }

        .text-muted {
          color: #666;
          margin: 0;
        }

        .card-body {
          padding: 20px;
        }

        .upload-section {
          margin-bottom: 30px;
        }

        .form-group {
          margin-bottom: 15px;
        }

        .form-label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #333;
        }

        .form-control {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .file-info {
          margin-top: 8px;
          font-size: 14px;
          color: #666;
        }

        .file-name {
          font-weight: 500;
          color: #333;
        }

        .file-size {
          margin-left: 8px;
        }

        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-primary {
          background-color: #007bff;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background-color: #0056b3;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .info-box {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }

        .info-box h4 {
          margin: 0 0 12px 0;
          font-size: 16px;
          color: #333;
        }

        .format-description {
          margin-top: 12px;
        }

        .format-description p {
          margin-bottom: 15px;
          color: #666;
        }

        .tab-example {
          margin-bottom: 20px;
        }

        .tab-example h5 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: #007bff;
          font-weight: 600;
        }

        .format-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 10px;
          font-size: 14px;
        }

        .format-table th,
        .format-table td {
          padding: 8px;
          text-align: left;
          border: 1px solid #ddd;
        }

        .format-table th {
          background-color: #e9ecef;
          font-weight: 600;
        }

        .note {
          font-size: 13px;
          color: #666;
        }

        .alert {
          padding: 15px;
          border-radius: 4px;
          margin-top: 20px;
        }

        .alert-error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .alert-success {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .alert-warning {
          background-color: #fff3cd;
          color: #856404;
          border: 1px solid #ffeeba;
        }

        .alert h4 {
          margin: 0 0 12px 0;
          font-size: 16px;
        }

        .upload-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
          margin: 12px 0;
        }

        .summary-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background: white;
          border-radius: 4px;
        }

        .summary-item .label {
          font-weight: 500;
        }

        .summary-item .value {
          font-weight: 600;
        }

        .summary-item.success .value {
          color: #28a745;
        }

        .summary-item.info .value {
          color: #17a2b8;
        }

        .summary-item.error .value {
          color: #dc3545;
        }

        .error-details {
          margin-top: 15px;
        }

        .error-details h5 {
          margin: 0 0 8px 0;
          font-size: 14px;
        }

        .error-list {
          margin: 0;
          padding-left: 20px;
          font-size: 13px;
        }

        .error-list li {
          margin-bottom: 4px;
        }

        .more-errors {
          color: #666;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
