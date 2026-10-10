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
import { signOut, useSession } from 'next-auth/react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
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
              <a href="/">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
                  <Home className="mr-3 h-4 w-4 text-slate-400" />
                  Home Page
                </Button>
              </a>
              <Link href="/dashboard">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm bg-slate-100 text-slate-900 font-medium rounded-md hover:bg-slate-200">
                  <LayoutDashboard className="mr-3 h-4 w-4 text-slate-500" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/create-job">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
                  <BarChart className="mr-3 h-4 w-4 text-slate-400" />
                  Create Job
                </Button>
              </Link>
              <Link href="/provider">
                <Button variant="ghost" className="w-full justify-start h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
                  <FolderGit2 className="mr-3 h-4 w-4 text-slate-400" />
                  Providers
                </Button>
              </Link>
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
            onClick={() => signOut({ callbackUrl: '/' })} 
            variant="ghost" 
            className="w-full justify-start h-9 px-3 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
          >
            <LogOut className="mr-3 h-4 w-4 text-red-500" />
            Log Out
          </Button>

          {session?.user && (
            <div className="flex items-center gap-3 pt-3 mt-2 border-t border-slate-100 px-1">
              {session.user.image ? (
                <img src={session.user.image} alt={session.user.name || "User"} className="w-8 h-8 rounded-full border border-slate-200 object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-xs">
                  {session.user.name ? session.user.name[0] : "U"}
                </div>
              )}
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-800 truncate">{session.user.name || "User"}</p>
                <p className="text-[11px] text-slate-400 truncate">{session.user.email}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="h-14 border-b border-slate-200 flex flex-row items-center justify-end px-6 gap-3 shrink-0 bg-white">
          <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center">
            <Send className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full w-9 h-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center">
            <Bell className="h-4 w-4" />
          </Button>
          
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center overflow-hidden shrink-0">
              {session?.user?.image ? (
                <img src={session.user.image} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-4 h-4 text-blue-600" />
              )}
            </div>
            <span className="text-xs font-semibold text-slate-800">
              {session?.user?.name || "Ashley Almeida"}
            </span>
            <Button 
              onClick={() => signOut({ callbackUrl: '/' })} 
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