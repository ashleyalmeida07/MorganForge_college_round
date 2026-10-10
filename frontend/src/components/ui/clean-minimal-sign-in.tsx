"use client" 

import * as React from "react"
 
import { useState } from "react";

import {LogIn, Lock, Mail} from "lucide-react";
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
    <div className="section-hero-home min-h-screen w-full flex items-center justify-center z-1 overflow-hidden !p-0">
      <div className="gradient-background">
        <img
          src="/images/f12e82d4b32bc32107e10535267eb88f_dark-circle.avif"
          loading="eager"
          sizes="(max-width: 2400px) 100vw, 2400px"
          srcSet="/images/f12e82d4b32bc32107e10535267eb88f_dark-circle-p-500.avif 500w, /images/f12e82d4b32bc32107e10535267eb88f_dark-circle-p-800.avif 800w, /images/f12e82d4b32bc32107e10535267eb88f_dark-circle.avif 2400w"
          alt="Dark Gradient"
          className="dark-circle"
        />
        <img
          src="/images/122b690b3a172c6eb9951588b1844a3e_blue-circle.avif"
          loading="eager"
          alt="Blue Gradient"
          className="primary-circle"
        />
        <div className="dots-vector"></div>
        <div className="dots-vector"></div>
        <img
          src="/images/56c71daa9866842d3ee5787a28d055a4_light-circle.avif"
          loading="eager"
          sizes="(max-width: 2200px) 100vw, 2200px"
          srcSet="/images/56c71daa9866842d3ee5787a28d055a4_light-circle-p-500.png 500w, /images/56c71daa9866842d3ee5787a28d055a4_light-circle-p-800.png 800w, /images/56c71daa9866842d3ee5787a28d055a4_light-circle.avif 2200w"
          alt="Light Blue Gradient"
          className="secondary-circle"
        />
        <div className="overlay-light"></div>
      </div>
      <div className="relative z-10 w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 flex flex-col items-center border border-blue-100 text-black">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white mb-6 shadow-lg shadow-opacity-5">
          <LogIn className="w-7 h-7 text-black" />
        </div>
        <h2 className="text-2xl font-semibold mb-2 text-center">
          Sign in to Verity
        </h2>
        <p className="text-gray-500 text-sm mb-6 text-center">
          Log in to your Verity dashboard to manage your verifiable computations.
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
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer text-xs select-none"></span>
          </div>
          <div className="w-full flex justify-end">
          {error && (
            <div className="text-sm text-red-500 text-left">{error}</div>
          )}
            <button className="text-xs hover:underline font-medium">
              Forgot password?
            </button>
          </div>
        </div>
        <button
          onClick={handleSignIn}
          className="w-full bg-gradient-to-b from-gray-700 to-gray-900 text-white font-medium py-2 rounded-xl shadow hover:brightness-105 cursor-pointer transition mb-4 mt-2"
        >
          Get Started
        </button>
        <div className="flex items-center w-full my-2">
          <div className="flex-grow border-t border-dashed border-gray-200"></div>
          <span className="mx-2 text-xs text-gray-400">Or sign in with</span>
          <div className="flex-grow border-t border-dashed border-gray-200"></div>
        </div>
        <div className="flex gap-3 w-full justify-center mt-2">
          <button 
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="flex items-center justify-center w-full h-12 rounded-xl border bg-white hover:bg-gray-100 transition"
          >
            <img
              src="https://cdn.21st.dev/assets/mirror/38/38146bfd9eff6dbf0d74771f2e625c70d87d3770e0d080dbb6e50db1d5403f46.svg"
              alt="Google"
              className="w-6 h-6"
            />
          </button>
        </div>
      </div>
    </div>
  );
};
 
export { SignIn2 };
