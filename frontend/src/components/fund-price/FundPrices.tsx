import { useState } from "react";
import { FundPriceUpload } from "./FundPriceUpload";
import { FundPriceList } from "./FundPriceList";

export function FundPrices() {
  const [activeTab, setActiveTab] = useState<"upload" | "view">("view");

  return (
    <div className="fund-prices">
      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "view" ? "active" : ""}`}
          onClick={() => setActiveTab("view")}
        >
          View Prices
        </button>
        <button
          className={`tab-btn ${activeTab === "upload" ? "active" : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          Upload Prices
        </button>
      </div>

      <div className="tab-content">
        {activeTab === "view" && <FundPriceList />}
        {activeTab === "upload" && <FundPriceUpload />}
      </div>

      <style>{`
        .fund-prices {
          padding: 20px;
        }

        .tabs {
          max-width: 1200px;
          margin: 0 auto 20px auto;
          display: flex;
          gap: 4px;
          border-bottom: 2px solid #e0e0e0;
        }

        .tab-btn {
          padding: 12px 24px;
          border: none;
          background: transparent;
          color: #666;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
        }

        .tab-btn:hover {
          color: #333;
          background: #f8f9fa;
        }

        .tab-btn.active {
          color: #007bff;
          border-bottom-color: #007bff;
        }

        .tab-content {
          animation: fadeIn 0.3s ease-in;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
