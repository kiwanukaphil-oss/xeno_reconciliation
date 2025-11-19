import React from "react";
import { TrendingUp, Upload, CheckCircle, AlertCircle } from "lucide-react";

const Dashboard = () => {
  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Stats Cards */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Uploads</p>
              <p className="text-2xl font-bold text-gray-900">24</p>
            </div>
            <Upload className="h-12 w-12 text-blue-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Transactions</p>
              <p className="text-2xl font-bold text-gray-900">12,450</p>
            </div>
            <TrendingUp className="h-12 w-12 text-green-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">Across all funds</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-green-600">18</p>
            </div>
            <CheckCircle className="h-12 w-12 text-green-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">Successfully processed</p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Approval</p>
              <p className="text-2xl font-bold text-orange-600">6</p>
            </div>
            <AlertCircle className="h-12 w-12 text-orange-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">Awaiting review</p>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Activity
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium text-gray-900">
                Client Fund transactions.csv
              </p>
              <p className="text-sm text-gray-500">Uploaded 2 hours ago</p>
            </div>
            <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">
              Completed
            </span>
          </div>
          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium text-gray-900">
                Q4_2024_transactions.xlsx
              </p>
              <p className="text-sm text-gray-500">Uploaded 5 hours ago</p>
            </div>
            <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full">
              Pending Approval
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium text-gray-900">
                November_goals.csv
              </p>
              <p className="text-sm text-gray-500">Uploaded 1 day ago</p>
            </div>
            <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full">
              Completed
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
