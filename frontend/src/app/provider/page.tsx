"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Copy, Loader2, Play } from 'lucide-react';
import { AppShell } from '@/components/ui/efferd-dashboard-2-utils/app-shell';

// Mock Providers for Phase 1 Demo since we don't have a wallet connected yet
const MOCK_PROVIDERS = [
  { wallet: '0xBuiltInHonest', apiUrl: 'http://localhost:8080', jobsCompleted: 42, timesChallenged: 0, timesSlashed: 0, active: true },
  { wallet: '0xBuiltInLazy', apiUrl: 'http://localhost:8081', jobsCompleted: 5, timesChallenged: 3, timesSlashed: 3, active: true },
];

export default function ConnectProviderPage() {
  const [apiUrl, setApiUrl] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [providers, setProviders] = useState(MOCK_PROVIDERS);
  const [healthStatus, setHealthStatus] = useState<Record<string, boolean>>({});

  const handleRegister = async () => {
    setIsRegistering(true);
    // Simulate smart contract call: registerProvider(apiUrl)
    setTimeout(() => {
      setProviders([...providers, {
        wallet: '0xYourWalletAddress...',
        apiUrl,
        jobsCompleted: 0,
        timesChallenged: 0,
        timesSlashed: 0,
        active: true
      }]);
      setIsRegistering(false);
      setApiUrl('');
    }, 1000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  useEffect(() => {
    // Ping health endpoints
    const pingHealth = async () => {
      const statuses: Record<string, boolean> = {};
      for (const p of providers) {
        try {
          const res = await fetch(`${p.apiUrl}/health`);
          statuses[p.wallet] = res.ok;
        } catch (e) {
          statuses[p.wallet] = false;
        }
      }
      setHealthStatus(statuses);
    };

    pingHealth();
    const interval = setInterval(pingHealth, 10000); // Ping every 10s
    return () => clearInterval(interval);
  }, [providers]);

  return (
    <AppShell>
      <div className="container mx-auto py-10 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Connect External Provider</h1>
          <p className="text-slate-500 mt-1 text-sm">Run a Verity provider agent on your own hardware and earn rewards.</p>
        </div>

        <div className="space-y-10 divide-y divide-slate-200">
          
          {/* Run Guide Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 first:pt-0">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">4-Step Run Guide</h2>
              <p className="text-sm text-slate-500 mt-1">Follow these instructions to run the provider agent locally on your machine.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              <div className="space-y-2">
                <Label className="font-semibold text-sm text-slate-700">1. Clone & Install</Label>
                <div className="flex relative">
                  <pre className="bg-slate-50 border border-slate-200 p-3 rounded-md text-xs overflow-x-auto w-full text-slate-800">git clone https://github.com/verity/verity.git{'\n'}cd offchain/provider-agent{'\n'}npm install</pre>
                  <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6 text-slate-400 hover:text-slate-900" onClick={() => copyToClipboard('git clone https://github.com/verity/verity.git\ncd offchain/provider-agent\nnpm install')}><Copy className="w-3 h-3"/></Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-sm text-slate-700">2. Configure Environment</Label>
                <p className="text-xs text-slate-500">Copy <code>.env.example</code> to <code>.env</code> and fill in your private key.</p>
                <div className="flex relative">
                  <pre className="bg-slate-50 border border-slate-200 p-3 rounded-md text-xs overflow-x-auto w-full text-slate-800">RPC_URL=http://127.0.0.1:8545{'\n'}CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3{'\n'}PRIVATE_KEY=your_wallet_private_key</pre>
                  <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6 text-slate-400 hover:text-slate-900" onClick={() => copyToClipboard('RPC_URL=http://127.0.0.1:8545\nCONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3\nPRIVATE_KEY=')}><Copy className="w-3 h-3"/></Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-sm text-slate-700">3. Run the Agent</Label>
                <div className="flex relative">
                  <pre className="bg-slate-50 border border-slate-200 p-3 rounded-md text-xs overflow-x-auto w-full text-slate-800">npx ts-node src/index.ts</pre>
                  <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6 text-slate-400 hover:text-slate-900" onClick={() => copyToClipboard('npx ts-node src/index.ts')}><Copy className="w-3 h-3"/></Button>
                </div>
              </div>
            </div>
          </div>

          {/* Registration Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Provider Registration</h2>
              <p className="text-sm text-slate-500 mt-1">Link your deployed agent to your wallet to start accepting jobs.</p>
            </div>
            <div className="md:col-span-2 space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Public API URL</Label>
                <Input 
                  placeholder="http://your-ip:8080" 
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
                />
                <p className="text-[11px] text-slate-500 mt-1">Make sure port 8080 is open to the internet.</p>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleRegister} disabled={!apiUrl || isRegistering} className="bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-6 h-auto rounded-lg shadow-sm transition-colors">
                  {isRegistering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Register Provider
                </Button>
              </div>
            </div>
          </div>

          {/* Network List Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
            <div className="md:col-span-1">
              <h2 className="text-base font-semibold text-slate-900">Network Status</h2>
              <p className="text-sm text-slate-500 mt-1">Currently registered and active providers on the network.</p>
            </div>
            <div className="md:col-span-2">
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <ul className="divide-y divide-slate-100">
                  {providers.map((p, i) => (
                    <li key={i} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-sm text-slate-900">{p.wallet.substring(0,6)}...{p.wallet.substring(p.wallet.length-4)}</span>
                            {healthStatus[p.wallet] === undefined ? (
                               <span className="flex items-center text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded-full text-slate-600"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Pinging</span>
                            ) : healthStatus[p.wallet] ? (
                              <span className="flex items-center text-[11px] font-medium bg-emerald-50 px-2 py-0.5 rounded-full text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1"/> Online</span>
                            ) : (
                              <span className="flex items-center text-[11px] font-medium bg-rose-50 px-2 py-0.5 rounded-full text-rose-600"><XCircle className="w-3 h-3 mr-1"/> Offline</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5 font-mono bg-slate-100 inline-block px-1.5 py-0.5 rounded">{p.apiUrl}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-700">{p.jobsCompleted} <span className="font-normal text-slate-500">Jobs</span></div>
                          <div className="text-xs font-semibold text-rose-600 mt-1">{p.timesSlashed} <span className="font-normal text-rose-400">Slashes</span></div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
