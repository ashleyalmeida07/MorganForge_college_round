/* eslint-disable @next/next/no-img-element */
"use client";
import React from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function SignUp() {
  return (
    <div className="page-wrapper">
      <div className="main-wrapper">
        <div className="section-hero-home" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="gradient-background">
            <img src="/images/f12e82d4b32bc32107e10535267eb88f_dark-circle.avif" loading="eager" className="dark-circle"/>
            <img src="/images/122b690b3a172c6eb9951588b1844a3e_blue-circle.avif" loading="eager" className="primary-circle"/>
            <div className="dots-vector"></div>
            <div className="dots-vector"></div>
            <img src="/images/56c71daa9866842d3ee5787a28d055a4_light-circle.avif" loading="eager" className="secondary-circle"/>
            <div className="overlay-light"></div>
          </div>
          
          <div className="padding-global" style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '440px' }}>
            <div className="form" style={{ background: 'rgba(255,255,255,0.02)', padding: '48px 40px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <Link href="/">
                  <img src="/images/6e2ce84846bb3c8d4b3feedcb27bdc19_brand-20logo.webp" alt="Verity Logo" style={{ height: '32px', margin: '0 auto 24px' }} />
                </Link>
                <h1 className="h4 text-color-primary-light">Create an account</h1>
                <p className="body-m text-color-secondary" style={{ marginTop: '8px' }}>Start proving your computations</p>
              </div>

              <form>
                <div className="field-area-wrapper" style={{ marginBottom: '20px' }}>
                  <label htmlFor="name" className="field-label">Full Name</label>
                  <input className="text-field w-input" type="text" id="name" required style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.1)' }} />
                </div>
                <div className="field-area-wrapper" style={{ marginBottom: '20px' }}>
                  <label htmlFor="email" className="field-label">Email Address</label>
                  <input className="text-field w-input" type="email" id="email" required style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.1)' }} />
                </div>
                <div className="field-area-wrapper" style={{ marginBottom: '32px' }}>
                  <label htmlFor="password" className="field-label">Password</label>
                  <input className="text-field w-input" type="password" id="password" required style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.1)' }} />
                </div>
                <button type="submit" className="button w-inline-block" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <div className="button-wrap-out" style={{ width: '100%' }}>
                    <div className="button-wrap-in">
                      <div className="body-m">Sign Up</div>
                      <div className="body-m position-absolute">Sign Up</div>
                    </div>
                  </div>
                </button>
              </form>
              <div style={{ marginTop: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ padding: '0 10px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>OR</div>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
              </div>
              <button type="button" onClick={() => signIn('google', { callbackUrl: '/' })} className="button w-inline-block" style={{ width: '100%', display: 'flex', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="button-wrap-out" style={{ width: '100%' }}>
                  <div className="button-wrap-in">
                    <div className="body-m" style={{ color: '#fff' }}>Continue with Google</div>
                    <div className="body-m position-absolute" style={{ color: '#fff' }}>Continue with Google</div>
                  </div>
                </div>
              </button>


              <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <p className="body-s text-color-secondary">
                  Already have an account? <Link href="/login" className="text-color-primary-light" style={{ textDecoration: 'underline' }}>Log in</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
