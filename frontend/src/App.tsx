import { useState } from "react";
import {
  Upload,
  BarChart3,
  FileText,
  Menu,
  X,
  Home,
  TrendingUp,
  DollarSign,
  Wallet,
  Building2,
  Scale,
  Target,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitCompare,
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
import { FundPrices } from "./components/fund-price/FundPrices";
import { UnitRegistry } from "./components/unit-registry/UnitRegistry";
import TransactionComparison from "./components/comparison/TransactionComparison";
import GoalComparison from "./components/comparison/GoalComparison";
import FundComparison from "./components/comparison/FundComparison";

interface MenuItem {
  id: string;
  name: string;
  icon: any;
  description: string;
}

interface MenuGroup {
  id: string;
  name: string;
  icon: any;
  items: MenuItem[];
}

type MenuEntry = MenuItem | MenuGroup;

const isGroup = (entry: MenuEntry): entry is MenuGroup => {
  return "items" in entry;
};

const App = () => {
  const [activeModule, setActiveModule] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["uploads", "transactions", "variance-analysis"])
  );

  const menuStructure: MenuEntry[] = [
    {
      id: "dashboard",
      name: "Dashboard",
      icon: Home,
      description: "Overview and statistics",
    },
    {
      id: "uploads",
      name: "Uploads",
      icon: Upload,
      items: [
        {
          id: "fund-upload",
          name: "Fund Upload",
          icon: Upload,
          description: "Upload fund transaction files",
        },
        {
          id: "bank-upload",
          name: "Bank Upload",
          icon: Building2,
          description: "Upload bank transaction files",
        },
        {
          id: "fund-prices",
          name: "Fund Price Upload",
          icon: DollarSign,
          description: "Upload daily fund prices",
        },
      ],
    },
    {
      id: "transactions",
      name: "Transactions",
      icon: FolderOpen,
      items: [
        {
          id: "goal-transactions",
          name: "Goal Transactions",
          icon: TrendingUp,
          description: "Aggregated goal transactions",
        },
        {
          id: "bank-transactions",
          name: "Bank Transactions",
          icon: Building2,
          description: "Uploaded bank transaction records",
        },
        {
          id: "fund-transactions",
          name: "Fund Transactions",
          icon: FileText,
          description: "Individual fund transactions",
        },
      ],
    },
    {
      id: "unit-registry",
      name: "Unit Registry",
      icon: Wallet,
      description: "Client portfolio positions and values",
    },
    {
      id: "variance-analysis",
      name: "Variance Analysis",
      icon: GitCompare,
      items: [
        {
          id: "goal-comparison",
          name: "Goal Comparison",
          icon: Target,
          description: "Compare totals by goal with smart matching",
        },
        {
          id: "fund-comparison",
          name: "Fund Comparison",
          icon: BarChart3,
          description: "Compare fund-level variances by goal",
        },
        {
          id: "transaction-comparison",
          name: "Variance Transactions",
          icon: Scale,
          description: "Review unmatched transactions",
        },
      ],
    },
  ];

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const renderActiveModule = () => {
    switch (activeModule) {
      case "dashboard":
        return <Dashboard />;
      case "fund-upload":
        return <FundUpload />;
      case "bank-upload":
        return <BankUpload />;
      case "goal-comparison":
        return <GoalComparison />;
      case "fund-comparison":
        return <FundComparison />;
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
      default:
        return <Dashboard />;
    }
  };

  // Find active module info (search in groups too)
  const findModuleInfo = (): MenuItem | undefined => {
    for (const entry of menuStructure) {
      if (isGroup(entry)) {
        const found = entry.items.find((item) => item.id === activeModule);
        if (found) return found;
      } else if (entry.id === activeModule) {
        return entry;
      }
    }
    return undefined;
  };

  const activeModuleInfo = findModuleInfo();

  const renderMenuItem = (item: MenuItem, isNested: boolean = false) => {
    const Icon = item.icon;
    const isActive = activeModule === item.id;

    return (
      <button
        key={item.id}
        onClick={() => {
          setActiveModule(item.id);
          setSidebarOpen(false);
        }}
        className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
          isNested ? "pl-10" : ""
        } ${
          isActive
            ? "bg-blue-50 text-blue-700"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        }`}
      >
        <Icon
          className={`mr-3 h-4 w-4 ${
            isActive ? "text-blue-600" : "text-gray-400"
          }`}
        />
        <span>{item.name}</span>
      </button>
    );
  };

  const renderMenuGroup = (group: MenuGroup) => {
    const Icon = group.icon;
    const isExpanded = expandedGroups.has(group.id);
    const hasActiveChild = group.items.some(
      (item) => item.id === activeModule
    );

    return (
      <div key={group.id}>
        <button
          onClick={() => toggleGroup(group.id)}
          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            hasActiveChild
              ? "text-blue-700 bg-blue-50/50"
              : "text-gray-700 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center">
            <Icon
              className={`mr-3 h-4 w-4 ${
                hasActiveChild ? "text-blue-600" : "text-gray-500"
              }`}
            />
            <span>{group.name}</span>
          </div>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {isExpanded && (
          <div className="mt-1 space-y-1">
            {group.items.map((item) => renderMenuItem(item, true))}
          </div>
        )}
      </div>
    );
  };

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
                XENO Recon
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
          <nav className="mt-4 px-3 flex-1 overflow-y-auto">
            <div className="space-y-1">
              {menuStructure.map((entry) =>
                isGroup(entry)
                  ? renderMenuGroup(entry)
                  : renderMenuItem(entry)
              )}
            </div>
          </nav>

          {/* Status Footer */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
              <span>All Systems Operational</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Version 1.0.0
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
                  <div className="text-xs text-gray-500">admin@xeno.com</div>
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
