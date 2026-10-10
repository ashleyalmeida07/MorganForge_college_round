"use client";

import React, { useState } from 'react';
import { 
  FileText, 
  ClipboardList, 
  Users, 
  BarChart3, 
  ArrowUpRight, 
  CheckCircle2, 
  Cpu, 
  ShieldCheck,
  Activity
} from 'lucide-react';
import { 
  Area, 
  AreaChart, 
  Bar, 
  BarChart, 
  ResponsiveContainer, 
  YAxis, 
  XAxis, 
  CartesianGrid, 
  Tooltip 
} from 'recharts';

export function Dashboard() {
  // Task throughput data (matching the 8 weeks trend in the reference)
  const throughputData = [
    { name: 'Wk 1', opened: 35, completed: 28 },
    { name: 'Wk 2', opened: 41, completed: 33 },
    { name: 'Wk 3', opened: 30, completed: 37 },
    { name: 'Wk 4', opened: 45, completed: 40 },
    { name: 'Wk 5', opened: 38, completed: 43 },
    { name: 'Wk 6', opened: 52, completed: 46 },
    { name: 'Wk 7', opened: 48, completed: 50 },
    { name: 'Wk 8', opened: 44, completed: 55 },
  ];

  // Daily distribution data
  const dailyData = [
    { name: 'Mon', value: 12 },
    { name: 'Tue', value: 24 },
    { name: 'Wed', value: 18 },
    { name: 'Thu', value: 38 },
    { name: 'Fri', value: 29 },
    { name: 'Sat', value: 48 },
    { name: 'Sun', value: 42 },
  ];

  const stats = [
    {
      title: 'Total projects',
      value: '24',
      change: '+2 from last month',
      isPositive: true,
      icon: FileText,
    },
    {
      title: 'Active tasks',
      value: '127',
      change: '+12 from yesterday',
      isPositive: true,
      icon: ClipboardList,
    },
    {
      title: 'Team members',
      value: '16',
      change: '+1 new member',
      isPositive: true,
      icon: Users,
    },
    {
      title: 'Completion rate',
      value: '87%',
      change: '+5% from last week',
      isPositive: true,
      icon: BarChart3,
    },
  ];

  return (
    <div className="space-y-6 w-full max-w-[1240px] mx-auto pb-10">
      
      {/* Top 4 Metrics Cards (Clean White & Blue Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div 
              key={idx} 
              className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs hover:border-blue-200 transition-all duration-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{item.title}</span>
                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-3xl font-bold tracking-tight text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1 font-normal">
                  <span>{item.change}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Task Throughput Chart Card (White and Blue) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Task throughput</h2>
              <p className="text-sm text-slate-500 mt-0.5">Tasks opened against tasks completed over the last eight weeks</p>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                <Activity className="w-3.5 h-3.5" /> Live Sync
              </span>
            </div>
          </div>
        </div>

        {/* Recharts Area Chart */}
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughputData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="0 0" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#64748b' }} 
                dy={12} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#64748b' }} 
                domain={[0, 60]}
                ticks={[0, 15, 30, 45, 60]}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-slate-900 text-white rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
                        <div className="font-semibold text-slate-300">{payload[0]?.payload.name}</div>
                        <div className="flex items-center gap-2 text-blue-400">
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                          <span>Completed: {payload[0]?.value}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-300">
                          <span className="w-2 h-2 rounded-full bg-slate-400 inline-block"></span>
                          <span>Opened: {payload[1]?.value}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Completed: Solid Blue Line with smooth blue gradient area */}
              <Area 
                type="monotone" 
                dataKey="completed" 
                stroke="#2563eb" 
                strokeWidth={2.5} 
                fillOpacity={1} 
                fill="url(#completedGradient)" 
              />
              {/* Opened: Dashed Comparison Line */}
              <Area 
                type="monotone" 
                dataKey="opened" 
                stroke="#94a3b8" 
                strokeWidth={2} 
                strokeDasharray="4 4" 
                fillOpacity={0} 
                fill="none" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend matching reference image */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-slate-100 text-xs font-medium text-slate-600">
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block"></span>
            <span>Opened</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-blue-600 inline-block"></span>
            <span className="text-slate-900 font-semibold">Completed</span>
          </div>
        </div>
      </div>

      {/* Second Row: Bar Chart & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Daily Jobs Distribution */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Daily verification</h3>
              <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">This week</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Computations settled per day</p>
          </div>
          
          <div className="h-[200px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f8fafc" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900 text-white rounded-md px-2.5 py-1.5 text-xs">
                          {payload[0]?.value} settled
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Verity Node Status / Network Summary */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Network Integrity</h3>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                <CheckCircle2 className="w-3.5 h-3.5" /> 100% Operational
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Bisection Dispute Engine</div>
                    <div className="text-[11px] text-slate-500">Active contracts deployed on local chain</div>
                  </div>
                </div>
                <span className="text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">Ready</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">FastAPI Compute Worker</div>
                    <div className="text-[11px] text-slate-500">Local port 8000 (Honest & Adversarial modes)</div>
                  </div>
                </div>
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Online</span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Last audit trace sync: 2 minutes ago</span>
            <a href="/create-job" className="text-blue-600 font-semibold hover:underline flex items-center gap-1">
              Create New Job <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

      </div>

    </div>
  );
}

export default Dashboard;