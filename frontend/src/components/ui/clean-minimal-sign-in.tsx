"use client" 

import * as React from "react"
import { useState } from "react";
import { LogIn, Lock, Mail } from "lucide-react";
import { signIn } from "next-auth/react";

const SignIn2 = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignIn = () => {
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    alert("Sign in successful! (Demo)");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0a0a] rounded-xl z-1">
      <div className="w-full max-w-sm bg-gradient-to-b from-gray-900 to-[#121212] rounded-3xl shadow-xl p-8 flex flex-col items-center border border-gray-800 text-white">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-800 mb-6 shadow-lg">
          <LogIn className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-2xl font-semibold mb-2 text-center">
          Sign in to Verity
        </h2>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Verifiable computation for a new era of trust.
        </p>
        <div className="w-full flex flex-col gap-3 mb-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <Mail className="w-4 h-4" />
            </span>
            <input
              placeholder="Email"
              type="email"
              value={email}
              className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-900 text-white text-sm"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <Lock className="w-4 h-4" />
            </span>
            <input
              placeholder="Password"
              type="password"
              value={password}
              className="w-full pl-10 pr-10 py-2 rounded-xl border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-900 text-white text-sm"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="w-full flex justify-end">
          {error && (
            <div className="text-sm text-red-500 text-left w-full">{error}</div>
          )}
            <button className="text-xs hover:underline font-medium text-gray-400">
              Forgot password?
            </button>
          </div>
        </div>
        <button
          onClick={handleSignIn}
          className="w-full bg-blue-600 text-white font-medium py-2 rounded-xl shadow hover:bg-blue-500 cursor-pointer transition mb-4 mt-2"
        >
          Get Started
        </button>
        <div className="flex items-center w-full my-2">
          <div className="flex-grow border-t border-dashed border-gray-700"></div>
          <span className="mx-2 text-xs text-gray-500">Or sign in with</span>
          <div className="flex-grow border-t border-dashed border-gray-700"></div>
        </div>
        <div className="flex gap-3 w-full justify-center mt-2">
          <button 
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="flex items-center justify-center w-12 h-12 rounded-xl border border-gray-700 bg-gray-800 hover:bg-gray-700 transition grow">
            <img
              src="https://cdn.21st.dev/assets/mirror/38/38146bfd9eff6dbf0d74771f2e625c70d87d3770e0d080dbb6e50db1d5403f46.svg"
              alt="Google"
              className="w-6 h-6 filter brightness-0 invert"
            />
          </button>
          <button className="flex items-center justify-center w-12 h-12 rounded-xl border border-gray-700 bg-gray-800 hover:bg-gray-700 transition grow">
            <img
              src="https://cdn.21st.dev/assets/mirror/49/49c99a2bb048f4c4941540ccf601621071669cdd1f51e52312a412f23bb2d5fa.svg"
              alt="Facebook"
              className="w-6 h-6 filter brightness-0 invert"
            />
          </button>
          <button className="flex items-center justify-center w-12 h-12 rounded-xl border border-gray-700 bg-gray-800 hover:bg-gray-700 transition grow">
            <img
              src="https://cdn.21st.dev/assets/mirror/c2/c221b3f2143cf5d8d85a3b68da84dbae21b18db4164e63ca8c07c6ffdbb922c4.svg"
              alt="Apple"
              className="w-6 h-6 filter brightness-0 invert"
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export { SignIn2 };
