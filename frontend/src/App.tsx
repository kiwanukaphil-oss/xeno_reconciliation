import { useState } from "react";
import {
  Upload,
  BarChart3,
  FileText,
  Menu,
  X,
  Home,
  CheckSquare,
  TrendingUp,
  Users,
  DollarSign,
  Wallet,
  AlertTriangle,
  Building2,
  Scale,
  Target,
} from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./lib/queryClient";

// Import components
import Dashboard from "./components/Dashboard";
import FundUpload from "./components/fund-upload/FundUpload";
import BankUpload from "./components/bank-upload/BankUpload";
import GoalTransactions from "./components/transactions/GoalTransactions";
import FundTransactions from "./components/transactions/FundTransactions";
import BankTransactions from "./components/transactions/BankTransactions";
import ApprovalQueue from "./components/approval/ApprovalQueue";
import { FundPrices } from "./components/fund-price/FundPrices";
import { UnitRegistry } from "./components/unit-registry/UnitRegistry";
import VarianceReview from "./components/reconciliation/VarianceReview";
import TransactionComparison from "./components/comparison/TransactionComparison";
import GoalComparison from "./components/comparison/GoalComparison";

const App = () => {
  const [activeModule, setActiveModule] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const modules = [
    {
      id: "dashboard",
      name: "Dashboard",
      icon: Home,
      description: "Overview and statistics",
    },
    {
      id: "upload",
      name: "Fund Upload",
      icon: Upload,
      description: "Upload CSV/Excel files",
    },
    {
      id: "bank-upload",
      name: "Bank Upload",
      icon: Building2,
      description: "Upload bank transaction files",
    },
    {
      id: "variance-review",
      name: "Variance Review",
      icon: AlertTriangle,
      description: "Review and resolve variances",
    },
    {
      id: "goal-comparison",
      name: "Goal Comparison",
      icon: Target,
      description: "Compare totals by goal with smart matching",
    },
    {
      id: "transaction-comparison",
      name: "Transaction Comparison",
      icon: Scale,
      description: "Compare bank and fund transactions",
    },
    {
      id: "fund-prices",
      name: "Fund Prices",
      icon: DollarSign,
      description: "Upload and view daily fund prices",
    },
    {
      id: "unit-registry",
      name: "Unit Registry",
      icon: Wallet,
      description: "Client portfolio positions and values",
    },
    {
      id: "goal-transactions",
      name: "Goal Transactions",
      icon: TrendingUp,
      description: "Aggregated goal transactions",
    },
    {
      id: "fund-transactions",
      name: "Fund Transactions",
      icon: FileText,
      description: "Individual fund transactions",
    },
    {
      id: "bank-transactions",
      name: "Bank Transactions",
      icon: Building2,
      description: "Uploaded bank transaction records",
    },
    {
      id: "approval",
      name: "Approval Queue",
      icon: CheckSquare,
      description: "Approve new entities",
    },
    {
      id: "master-data",
      name: "Master Data",
      icon: Users,
      description: "Clients, Accounts, Goals",
    },
  ];

  const renderActiveModule = () => {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard />;
      case "upload":
        return <FundUpload />;
      case "bank-upload":
        return <BankUpload />;
      case "variance-review":
        return <VarianceReview />;
      case "goal-comparison":
        return <GoalComparison />;
      case "transaction-comparison":
        return <TransactionComparison />;
      case "fund-prices":
        return <FundPrices />;
      case "unit-registry":
        return <UnitRegistry />;
      case "goal-transactions":
        return <GoalTransactions />;
      case "fund-transactions":
        return <FundTransactions />;
      case "bank-transactions":
        return <BankTransactions />;
      case "approval":
        return <ApprovalQueue />;
      default:
        return <Dashboard />;
    }
  };

  const activeModuleInfo = modules.find((m) => m.id === activeModule);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 lg:static lg:inset-0`}
        >
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
            <div className="flex items-center">
              <BarChart3 className="h-8 w-8 text-blue-600 mr-3" />
              <span className="text-xl font-bold text-gray-900">
                XENO Reconciliation
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="mt-6 px-3">
            <div className="space-y-1">
              {modules.map((module) => {
                const Icon = module.icon;
                const isActive = activeModule === module.id;

                return (
                  <button
                    key={module.id}
                    onClick={() => {
                      setActiveModule(module.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-700 border-r-2 border-blue-600"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon
                      className={`mr-3 h-5 w-5 ${
                        isActive ? "text-blue-600" : "text-gray-400"
                      }`}
                    />
                    <div className="text-left">
                      <div className="font-medium">{module.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {module.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Status Footer */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
              <span>All Systems Operational</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Version 1.0.0 • Production Ready
            </div>
          </div>
        </div>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Header */}
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
              <div className="flex items-center">
                {/* Mobile menu button */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 mr-2"
                >
                  <Menu className="h-5 w-5" />
                </button>

                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {activeModuleInfo?.name}
                  </h1>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {activeModuleInfo?.description}
                  </p>
                </div>
              </div>

              {/* User Info */}
              <div className="flex items-center space-x-4">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-gray-900">
                    System Admin
                  </div>
                  <div className="text-xs text-gray-500">
                    admin@xeno.com
                  </div>
                </div>
                <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">SA</span>
                </div>
              </div>
            </div>
          </header>

          {/* Module Content */}
          <main className="flex-1 overflow-y-auto">{renderActiveModule()}</main>
        </div>
      </div>
      <ReactQueryDevtools initialIsOpen={false} position="bottom" />
    </QueryClientProvider>
  );
};

export default App;
