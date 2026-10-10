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
      <div className="container mx-auto py-10 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Connect External Provider</h1>
        <p className="text-muted-foreground">Run a Verity provider agent on your own hardware and earn rewards.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Run Guide */}
        <Card>
          <CardHeader>
            <CardTitle>4-Step Run Guide</CardTitle>
            <CardDescription>Follow these steps to run your agent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="font-semibold text-sm">1. Clone & Install</Label>
              <div className="flex relative">
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto w-full">git clone https://github.com/verity/verity.git{'\n'}cd offchain/provider-agent{'\n'}npm install</pre>
                <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard('git clone https://github.com/verity/verity.git\ncd offchain/provider-agent\nnpm install')}><Copy className="w-3 h-3"/></Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-sm">2. Configure .env</Label>
              <p className="text-xs text-muted-foreground">Copy <code>.env.example</code> to <code>.env</code>. It is pre-filled with the local RPC URL and Contract Address.</p>
              <div className="flex relative">
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto w-full">RPC_URL=http://127.0.0.1:8545{'\n'}CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3{'\n'}PRIVATE_KEY=your_wallet_private_key</pre>
                <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard('RPC_URL=http://127.0.0.1:8545\nCONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3\nPRIVATE_KEY=')}><Copy className="w-3 h-3"/></Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-sm">3. Run the Agent</Label>
              <div className="flex relative">
                <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto w-full">npx ts-node src/index.ts</pre>
                <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6" onClick={() => copyToClipboard('npx ts-node src/index.ts')}><Copy className="w-3 h-3"/></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Register Form */}
          <Card>
            <CardHeader>
              <CardTitle>Register Provider on Chain</CardTitle>
              <CardDescription>Link your deployed agent to your wallet</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Public API URL</Label>
                  <Input 
                    placeholder="http://your-ip:8080" 
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-muted-foreground">Make sure port 8080 is open to the internet.</p>
                </div>
                <Button onClick={handleRegister} disabled={!apiUrl || isRegistering} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 h-auto rounded-lg shadow-sm">
                  {isRegistering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Register Provider
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Provider List */}
          <Card>
            <CardHeader>
              <CardTitle>Registered Providers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {providers.map((p, i) => (
                  <div key={i} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.wallet.substring(0,6)}...{p.wallet.substring(p.wallet.length-4)}</span>
                        {healthStatus[p.wallet] === undefined ? (
                           <span className="flex items-center text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Pinging...</span>
                        ) : healthStatus[p.wallet] ? (
                          <span className="flex items-center text-[10px] bg-green-100 px-1.5 py-0.5 rounded text-green-700"><CheckCircle2 className="w-3 h-3 mr-1"/> Online</span>
                        ) : (
                          <span className="flex items-center text-[10px] bg-red-100 px-1.5 py-0.5 rounded text-red-700"><XCircle className="w-3 h-3 mr-1"/> Offline</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{p.apiUrl}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Jobs: {p.jobsCompleted} | Slashed: {p.timesSlashed}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
        </div>
    </AppShell>
  );
}
