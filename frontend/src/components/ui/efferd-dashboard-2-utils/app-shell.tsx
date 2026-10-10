import React from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col bg-gray-900 text-white font-sans">
      <header className="flex h-16 items-center justify-between border-b border-gray-800 px-6">
        <h1 className="text-xl font-bold">Verity Dashboard</h1>
        <nav className="flex space-x-4">
          <a href="#" className="text-sm font-medium hover:text-blue-400">Home</a>
          <a href="#" className="text-sm font-medium hover:text-blue-400">Settings</a>
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-6 bg-gray-800">
        {children}
      </main>
    </div>
  );
}