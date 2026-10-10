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
      <div className="container mx-auto py-10 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create Computation Job</CardTitle>
          <CardDescription>Request a verifiable computation on the network.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Dataset Size</Label>
            <div className="relative">
              <select className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="1024">1,024 elements (Demo)</option>
                <option value="4096">4,096 elements</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Choose Provider</Label>
            <div className="relative">
              <select 
                value={provider} 
                onChange={(e) => setProvider(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          </div>

          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 h-auto mt-4 rounded-lg shadow-sm">
            Create Job
          </Button>
        </CardContent>
      </Card>
        </div>
    </AppShell>
  );
}
