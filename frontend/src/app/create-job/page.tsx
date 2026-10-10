"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';

export default function CreateJobPage() {
  const [provider, setProvider] = useState('honest');

  return (
    <AppShell>
      <div className="container mx-auto py-10 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Create Computation Job</h1>
          <p className="text-slate-500 mt-1 text-sm">Request a verifiable computation on the network.</p>
        </div>

        <div className="space-y-10 divide-y divide-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 first:pt-0">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Job Parameters</h2>
              <p className="text-sm text-slate-500 mt-1">Configure the dataset size and the complexity of the verifiable computation you want to request.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Dataset Size</Label>
                <div className="relative">
                  <select className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow">
                    <option value="1024">1,024 elements (Demo)</option>
                    <option value="4096">4,096 elements</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Execution Settings</h2>
              <p className="text-sm text-slate-500 mt-1">Select which provider will compute the result. In Phase 2, this will be chosen dynamically.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Choose Provider</Label>
                <div className="relative">
                  <select 
                    value={provider} 
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
                  >
                    <optgroup label="Built-in Demo Providers">
                      <option value="honest">Honest Provider</option>
                      <option value="wrongresult">Malicious (Wrong Result)</option>
                      <option value="lazy">Malicious (Lazy)</option>
                    </optgroup>
                    <optgroup label="Registered External Providers">
                      <option value="0xexternal">0xYourWalletAddress... (http://localhost:8080)</option>
                    </optgroup>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">The provider will run the computation off-chain and commit the result.</p>
              </div>
              
              <div className="flex justify-end pt-4">
                <Button className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-6 h-auto rounded-lg shadow-sm transition-colors">
                  Create Job
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
