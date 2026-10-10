"use client";

import React from 'react';
import { 
  LayoutDashboard, 
  BarChart, 
  FolderGit2, 
  Users, 
  HelpCircle, 
  BookOpen, 
  Send, 
  Bell,
  Sidebar,
  Home,
  LogOut,
  User as UserIcon,
  ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { WalletButton } from '@/components/solana/WalletButton';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/create-job', label: 'Create Job', icon: BarChart },
  { href: '/provider', label: 'Providers', icon: FolderGit2 },
];

const ACTIVE = 'w-full justify-start h-9 px-3 text-sm bg-slate-100 text-slate-900 font-medium rounded-md hover:bg-slate-200';
const IDLE = 'w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, displayName, avatarUrl, signOut } = useAuth();
  const pathname = usePathname();
  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 overflow-hidden font-sans">
      <div className="w-[240px] border-r border-slate-200 bg-white flex flex-col h-full hidden md:flex shrink-0">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-200">
          <div className="w-6 h-6 flex items-center justify-center bg-blue-600 rounded-md text-white">
            <Sidebar className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-sm">Verity App</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 space-y-6 scrollbar-hide">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 px-4 uppercase tracking-wider">Menu</div>
            <div className="space-y-1 px-3">
              {/* Full page load: the landing page boots Webflow/GSAP scripts. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
                  <Home className="mr-3 h-4 w-4 text-slate-400" />
                  Home Page
                </Button>
              </a>
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link key={href} href={href}>
                    <Button variant="ghost" className={active ? ACTIVE : IDLE}>
                      <Icon className={`mr-3 h-4 w-4 ${active ? 'text-slate-500' : 'text-slate-400'}`} />
                      {label}
                    </Button>
                  </Link>
                );
              })}
              <Link href="/admin">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md">
                  <ShieldAlert className="mr-3 h-4 w-4 text-red-500" />
                  Chaos & Admin
                </Button>
              </Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 px-4 uppercase tracking-wider">Workspace</div>
            <div className="space-y-1 px-3">
              <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
                <Users className="mr-3 h-4 w-4 text-slate-400" />
                Team
              </Button>
            </div>
          </div>
        </div>
        <div className="p-3 mt-auto space-y-1 border-t border-slate-200">
          <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
            <HelpCircle className="mr-3 h-4 w-4 text-slate-400" />
            Support
          </Button>
          <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
            <BookOpen className="mr-3 h-4 w-4 text-slate-400" />
            Docs
          </Button>
          <Button 
            onClick={signOut} 
            variant="ghost" 
            className="w-full justify-start h-9 px-3 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
          >
            <LogOut className="mr-3 h-4 w-4 text-red-500" />
            Log Out
          </Button>

          {user && (
            <div className="flex items-center gap-3 pt-3 mt-2 border-t border-slate-100 px-1">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName || "User"} className="w-8 h-8 rounded-full border border-slate-200 object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs">
                  {displayName ? displayName[0].toUpperCase() : "U"}
                </div>
              )}
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-800 truncate">{displayName || "User"}</p>
                <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="h-14 border-b border-slate-200 flex flex-row items-center justify-end px-6 gap-3 shrink-0 bg-white">
          <WalletButton />
          <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center">
            <Send className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center">
            <Bell className="h-4 w-4" />
          </Button>
          
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center overflow-hidden shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-4 h-4 text-blue-600" />
              )}
            </div>
            <span className="text-xs font-semibold text-slate-800">
              {displayName || "Guest"}
            </span>
            <Button 
              onClick={signOut} 
              variant="ghost" 
              size="sm"
              className="ml-1 text-xs h-8 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
              title="Log Out"
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Log Out</span>
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 md:p-8">
          <div className="mx-auto max-w-[1200px]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}