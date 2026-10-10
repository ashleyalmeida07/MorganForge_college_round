/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";

const PROMPT = "Enter Your Email Here For Early Access";
const SUCCESS = "You Will Receive Notifications By Email";
const RESET_DELAY = 4000;
const TYPE_INTERVAL = 60;

export default function Hero() {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState("");
  const [typed, setTyped] = useState("");

  // Type the placeholder out one character at a time while the form is open.
  useEffect(() => {
    if (!showForm) {
      setTyped("");
      return;
    }

    const text = submitted ? SUCCESS : PROMPT;
    setTyped("");

    const id = setInterval(() => {
      setTyped((prev) => {
        if (prev.length >= text.length) {
          clearInterval(id);
          return prev;
        }
        return text.slice(0, prev.length + 1);
      });
    }, TYPE_INTERVAL);

    return () => clearInterval(id);
  }, [showForm, submitted]);

  // Drop back to the button state a few seconds after a submission.
  useEffect(() => {
    if (!submitted) return;

    const id = setTimeout(() => {
      setSubmitted(false);
      setShowForm(false);
      setEmail("");
    }, RESET_DELAY);

    return () => clearTimeout(id);
  }, [submitted]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmail("");
    setSubmitted(true);
  };

  return (
    <section className="relative flex-1 flex flex-col items-center justify-center px-6">
      <div className="relative z-10 text-center max-w-5xl mx-auto flex flex-col items-center justify-center w-full gap-12">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-white/80 text-[10px] md:text-[11px] font-medium tracking-[0.2em] uppercase mb-4"
        >
          BUILD A NO-CODE AI APP IN MINUTES
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="text-4xl md:text-[64px] font-medium tracking-[-0.01em] leading-[1.1] mb-6 bg-gradient-to-b from-white via-white/95 to-white/70 bg-clip-text text-transparent max-w-4xl"
        >
          A new way to think and create
          <br className="hidden md:block" /> with computers
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="min-h-[50px] mt-2"
        >
          <AnimatePresence mode="wait">
            {showForm ? (
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 pl-5 pr-1.5 py-1.5 text-[14px] font-medium border border-white/20 rounded-full bg-white/[0.02] backdrop-blur-sm w-full max-w-[320px] focus-within:border-white/40 transition-colors duration-300"
              >
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={typed}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-white placeholder-white/45"
                />
                <button
                  type="submit"
                  className="shrink-0 grid place-items-center w-9 h-9 rounded-full bg-white text-black hover:bg-white/80 transition-colors duration-300 cursor-pointer"
                >
                  {submitted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                </button>
              </motion.form>
            ) : (
              <motion.button
                key="button"
                type="button"
                onClick={() => setShowForm(true)}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="px-10 py-3 text-[14px] font-medium border border-white/10 rounded-full hover:border-white/30 hover:bg-white/[0.02] transition-all duration-300 text-white/90 backdrop-blur-sm cursor-pointer"
              >
                Get early access
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <button
            type="button"
            className="text-white/80 hover:text-white/40 transition-colors duration-300 text-[13px] font-medium tracking-wide cursor-pointer"
          >
            Play Video Demo
          </button>
        </motion.div>
      </div>
    </section>
  );
}
