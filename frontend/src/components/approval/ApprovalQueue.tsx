import React from "react";
import { CheckSquare } from "lucide-react";

const ApprovalQueue = () => {
  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Approval Queue
        </h2>
        <div className="text-center text-gray-500 py-12">
          <CheckSquare className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-lg font-medium">No pending approvals</p>
          <p className="text-sm mt-2">
            New clients, accounts, and goals will appear here for approval
          </p>
        </div>
      </div>
    </div>
  );
};

export default ApprovalQueue;
