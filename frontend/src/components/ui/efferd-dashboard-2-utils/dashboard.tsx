"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, YAxis, XAxis, CartesianGrid } from 'recharts';

export function Dashboard() {
  const barData = [
    { name: 'Mon', value: 10 },
    { name: 'Tue', value: 25 },
    { name: 'Wed', value: 15 },
    { name: 'Thu', value: 40 },
    { name: 'Fri', value: 30 },
    { name: 'Sat', value: 50 },
    { name: 'Sun', value: 45 },
  ];

  const lineData = [
    { name: 'Jan', value1: 400, value2: 240 },
    { name: 'Feb', value1: 300, value2: 139 },
    { name: 'Mar', value1: 550, value2: 380 },
    { name: 'Apr', value1: 450, value2: 290 },
    { name: 'May', value1: 600, value2: 480 },
    { name: 'Jun', value1: 700, value2: 380 },
    { name: 'Jul', value1: 850, value2: 430 },
  ];

  return (
    <div className="grid gap-4 w-full">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-medium text-slate-500">Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-3 tracking-tight">$18,290</div>
            <div className="flex items-center text-[11px] text-emerald-500 font-medium">
              <ArrowUpRight className="w-3 h-3 mr-1" />
              12.4% vs last week
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-medium text-slate-500">Conversion Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-3 tracking-tight">3.28%</div>
            <div className="flex items-center text-[11px] text-rose-500 font-medium">
              <ArrowDownRight className="w-3 h-3 mr-1" />
              0.4% vs last week
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-medium text-slate-500">New signups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-3 tracking-tight">142</div>
            <div className="flex items-center text-[11px] text-emerald-500 font-medium">
              <ArrowUpRight className="w-3 h-3 mr-1" />
              8.7% vs last week
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-5">
        <Card className="col-span-1 lg:col-span-2 rounded-xl shadow-sm h-[320px] flex flex-col">
          <CardContent className="flex-1 p-0 pb-2 pt-6 pl-2 pr-6">
            <ChartContainer config={{ value: { color: "hsl(var(--primary))" } }} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dx={-10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="col-span-1 lg:col-span-3 rounded-xl shadow-sm h-[320px] flex flex-col">
          <CardHeader className="pb-0 pt-5 px-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  Channel sales <span className="text-emerald-600 text-[10px] font-medium bg-emerald-50 px-1.5 py-0.5 rounded flex items-center"><ArrowUpRight className="w-2.5 h-2.5 mr-0.5"/> 58.3%</span>
                </CardTitle>
                <div className="text-[13px] text-slate-500 mt-1">Daily sales count by channel, last 7 days.</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 pb-6 pt-4 px-2">
            <ChartContainer config={{ 
              value1: { color: "#10b981", label: "Organic" },
              value2: { color: "#3b82f6", label: "Paid" }
             }} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 20, right: 20, left: -20, bottom: 20 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dx={-10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="value1" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="value2" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}