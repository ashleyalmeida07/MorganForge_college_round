import React from 'react';

export function Dashboard() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Total Computations</h3>
          <p className="mt-2 text-3xl font-bold">1,234</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Active Disputes</h3>
          <p className="mt-2 text-3xl font-bold text-red-400">3</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Total Rewards Escrowed</h3>
          <p className="mt-2 text-3xl font-bold text-green-400">25.4 ETH</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Uptime</h3>
          <p className="mt-2 text-3xl font-bold">99.9%</p>
        </div>
      </div>
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-4">Recent Jobs</h2>
        <div className="space-y-4">
          {[1, 2, 3].map((job) => (
            <div key={job} className="flex items-center justify-between border-b border-gray-800 pb-4 last:border-0 last:pb-0">
              <div>
                <p className="font-medium">Job #{job}0824</p>
                <p className="text-sm text-gray-400">Statistical Aggregate</p>
              </div>
              <div className="text-sm font-medium text-green-400 bg-green-400/10 px-3 py-1 rounded-full">Finalized</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}