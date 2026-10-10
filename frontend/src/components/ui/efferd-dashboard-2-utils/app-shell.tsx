"use client";

import React, { useState } from 'react';
import {
  LayoutDashboard,
  PlayCircle,
  Cpu,
  Activity,
  Boxes,
  ShieldAlert,
  Home,
  LogOut,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Terminal,
  BookOpen,
  ChevronRight,
  Menu,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { WalletButton } from '@/components/solana/WalletButton';
import { env, explorerAddress } from '@/lib/env';
import { shortKey } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
  { href: '/create-job', label: 'Create Job', icon: PlayCircle, badge: 'New' },
  { href: '/rulesets', label: 'Rule Sets', icon: Boxes, badge: '6 WASM' },
  { href: '/provider', label: 'Providers', icon: Cpu, badge: 'Staking' },
  { href: '/activity', label: 'Activity Feed', icon: Activity, badge: 'Live' },
  { href: '/admin', label: 'Chaos & Admin', icon: ShieldAlert, badge: 'Testing', danger: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, displayName, avatarUrl, signOut } = useAuth();
  const pathname = usePathname();
  const [copiedProgram, setCopiedProgram] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const copyProgramId = () => {
    navigator.clipboard.writeText(env.programId);
    setCopiedProgram(true);
    setTimeout(() => setCopiedProgram(false), 2000);
  };

  const getPageTitle = () => {
    if (pathname === '/dashboard') return 'Overview & Analytics';
    if (pathname === '/create-job') return 'Dispatch Computation';
    if (pathname === '/rulesets') return 'Rule Set Marketplace';
    if (pathname === '/provider') return 'Provider Node Operations';
    if (pathname === '/activity') return 'Immutable Event Stream';
    if (pathname === '/admin') return 'Adversarial Chaos Theater';
    if (pathname.startsWith('/requests/')) return 'Execution Audit';
    if (pathname.startsWith('/verify/')) return 'Public Zero-Trust Verification';
    return 'Computation Portal';
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans selection:bg-blue-600/20 selection:text-blue-900">
      {/* Sidebar Desktop (White Theme) */}
      <aside className="w-[270px] border-r border-slate-200/90 bg-white flex flex-col h-full hidden md:flex shrink-0 z-30 shadow-xs">
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200/90 bg-white">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 p-[1px] shadow-sm shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-shadow">
              <div className="w-full h-full bg-white rounded-[7px] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-blue-600 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm tracking-wider text-slate-900">
                  VERITY
                </span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  DEVNET
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono tracking-tight -mt-0.5">
                Verifiable Computation
              </p>
            </div>
          </Link>
        </div>

        {/* Network & Program Bar */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Solana Cluster
            </span>
            <span className="text-emerald-700 font-semibold font-mono">Devnet (Synced)</span>
          </div>

          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[10px] font-mono text-slate-600 shadow-xs">
            <span className="truncate max-w-[150px] font-semibold text-slate-800" title={env.programId}>
              ID: {shortKey(env.programId, 6)}
            </span>
            <div className="flex items-center gap-1 text-slate-500">
              <button
                type="button"
                onClick={copyProgramId}
                className="hover:text-blue-600 transition-colors p-0.5"
                title="Copy Program ID"
              >
                {copiedProgram ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              </button>
              <a
                href={explorerAddress(env.programId) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 transition-colors p-0.5"
                title="View on Solana Explorer"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin">
          <div>
            <div className="text-[10px] font-mono font-bold text-slate-400 mb-2 px-3 uppercase tracking-wider">
              Core Platform
            </div>
            <div className="space-y-1">
              {NAV.map(({ href, label, icon: Icon, badge, danger }) => {
                const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
                return (
                  <Link key={href} href={href}>
                    <div
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all group ${
                        active
                          ? danger
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold shadow-xs'
                            : 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold shadow-xs'
                          : danger
                          ? 'text-slate-600 hover:text-rose-600 hover:bg-rose-50/50'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`w-4 h-4 transition-colors ${
                            active
                              ? danger
                                ? 'text-rose-600'
                                : 'text-blue-600'
                              : danger
                              ? 'text-rose-500 group-hover:text-rose-600'
                              : 'text-slate-400 group-hover:text-slate-700'
                          }`}
                        />
                        <span>{label}</span>
                      </div>
                      {badge && (
                        <span
                          className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                            active
                              ? danger
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-blue-100 text-blue-800'
                              : danger
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-mono font-bold text-slate-400 mb-2 px-3 uppercase tracking-wider">
              External & Resources
            </div>
            <div className="space-y-1">
              <a
                href="/"
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all"
              >
                <Home className="w-4 h-4 text-slate-400" />
                Landing Page
              </a>
              <a
                href="https://github.com/ashleyalmeida07/MorganForge_college_round"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <Terminal className="w-4 h-4 text-slate-400" />
                  GitHub Source
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
              <Link
                href="/rulesets"
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4 text-slate-400" />
                  WASM Specs
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* User Footer (Clean White) */}
        <div className="p-3 mt-auto border-t border-slate-200/90 bg-slate-50/70 space-y-2">
          {user ? (
            <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2.5 overflow-hidden">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName || "User"}
                    className="w-7 h-7 rounded-full border border-slate-200 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 font-bold text-xs shrink-0">
                    {displayName ? displayName[0].toUpperCase() : "U"}
                  </div>
                )}
                <div className="overflow-hidden">
                  <p className="text-xs font-semibold text-slate-800 truncate leading-tight">
                    {displayName || "Authenticated"}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 truncate leading-tight">
                    {user.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                title="Log out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition shadow-xs"
            >
              Sign In to Verity
            </Link>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F8FAFC]">
        {/* Top Navbar (White Theme) */}
        <header className="h-16 border-b border-slate-200/90 bg-white/95 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 hover:text-slate-900"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <span>Portal</span>
                <ChevronRight className="w-3 h-3 text-slate-300" />
                <span className="text-blue-600 font-semibold">{pathname.split('/')[1] || 'Dashboard'}</span>
              </div>
              <h1 className="text-sm font-bold text-slate-900 hidden sm:block">
                {getPageTitle()}
              </h1>
            </div>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>WASM Fuel Metering Active</span>
            </div>

            <WalletButton />
          </div>
        </header>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-200 bg-white px-4 py-3 space-y-1 z-30 shadow-md">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium ${
                  pathname === href
                    ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Scrollable Page Body */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-6 lg:p-8 web3-mesh-bg">
          <div className="mx-auto max-w-[1280px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}