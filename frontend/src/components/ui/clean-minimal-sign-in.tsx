"use client"

import * as React from "react"

import { useState } from "react";

import {LogIn, Lock, Mail, Loader2} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

function nextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`;
}

const SignIn2 = ({ mode = "signin" }: { mode?: Mode }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  // Surface errors passed back from /auth/callback (read after mount to avoid hydration mismatch).
  React.useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) {
      queueMicrotask(() => setError(e));
    }
  }, []);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignIn = async () => {
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (isSignup && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setInfo("");
    setLoading(true);
    const supabase = getSupabase();
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (error) throw error;
        if (data.session) {
          window.location.href = nextPath();
          return;
        }
        setInfo("Check your inbox to confirm your email, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = nextPath();
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError("");
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  };

  const handleForgot = async () => {
    if (!validateEmail(email)) {
      setError("Enter your email above first.");
      return;
    }
    setError("");
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
    });
    if (error) setError(error.message);
    else setInfo("Password reset link sent. Check your inbox.");
  };
 
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-slate-50 px-4">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_30rem_at_15%_0%,rgba(37,99,235,0.18),transparent),radial-gradient(40rem_30rem_at_90%_100%,rgba(14,165,233,0.14),transparent)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 flex flex-col items-center border border-blue-100 text-black">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white mb-6 shadow-lg shadow-opacity-5">
          <LogIn className="w-7 h-7 text-black" />
        </div>
        <h2 className="text-2xl font-semibold mb-2 text-center">
          {isSignup ? "Create your Verity account" : "Sign in to Verity"}
        </h2>
        <p className="text-gray-500 text-sm mb-6 text-center">
          {isSignup
            ? "Sign up to request, verify and audit verifiable computations."
            : "Log in to your Verity dashboard to manage your verifiable computations."}
        </p>
        <div className="w-full flex flex-col gap-3 mb-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Mail className="w-4 h-4" />
            </span>
            <input
              placeholder="Email"
              type="email"
              value={email}
              className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Lock className="w-4 h-4" />
            </span>
            <input
              placeholder="Password"
              type="password"
              value={password}
              className="w-full pl-10 pr-10 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer text-xs select-none"></span>
          </div>
          <div className="w-full flex justify-end">
          {error && (
            <div className="text-sm text-red-500 text-left">{error}</div>
          )}
            {!isSignup && (
              <button type="button" onClick={handleForgot} className="text-xs hover:underline font-medium">
                Forgot password?
              </button>
            )}
          </div>
        </div>
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full bg-gradient-to-b from-gray-700 to-gray-900 text-white font-medium py-2 rounded-xl shadow hover:brightness-105 cursor-pointer transition mb-4 mt-2 disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSignup ? "Create Account" : "Get Started"}
        </button>
        {info && <div className="text-sm text-green-600 text-center -mt-2 mb-2">{info}</div>}
        <div className="flex items-center w-full my-2">
          <div className="flex-grow border-t border-dashed border-gray-200"></div>
          <span className="mx-2 text-xs text-gray-400">{isSignup ? "Or sign up with" : "Or sign in with"}</span>
          <div className="flex-grow border-t border-dashed border-gray-200"></div>
        </div>
        <div className="flex gap-3 w-full justify-center mt-2">
          <button 
            type="button"
            onClick={handleGoogle}
            className="flex items-center justify-center w-full h-12 rounded-xl border bg-white hover:bg-gray-100 transition"
          >
            <img
              src="https://cdn.21st.dev/assets/mirror/38/38146bfd9eff6dbf0d74771f2e625c70d87d3770e0d080dbb6e50db1d5403f46.svg"
              alt="Google"
              className="w-6 h-6"
            />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-5">
          {isSignup ? "Already have an account? " : "New to Verity? "}
          <a href={isSignup ? "/login" : "/signup"} className="font-medium text-black hover:underline">
            {isSignup ? "Sign in" : "Create an account"}
          </a>
        </p>
      </div>
    </div>
  );
};
 
export { SignIn2 };
