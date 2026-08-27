import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { TRANSLATIONS } from "../locales/index";

interface SplashScreenProps {
  isVisible: boolean;
}

export function SplashScreen({ isVisible }: SplashScreenProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          style={{ backgroundColor: "#01091c", color: "#f8fafc" }}
          data-ui="startup-splash"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        >
          <div className="flex flex-col items-center space-y-5">
            {/* Logo/Icon Container */}
            <div className="flex h-24 w-24 items-center justify-center">
              <img
                src="/splash-logo.png"
                className="h-24 w-24 object-contain"
                alt="Mobile Tavern"
                loading="eager"
                decoding="sync"
                fetchPriority="high"
              />
            </div>

            {/* Title */}
            <div className="flex flex-col items-center space-y-2">
              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                className="text-2xl tracking-[0.2em] font-medium font-mono"
              >
                EXPLORER
              </motion.h1>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "2rem", opacity: 0.5 }}
                transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
                className="h-px bg-cyan-300"
              />
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                className="pt-1 text-xs tracking-widest text-slate-400"
              >
                {TRANSLATIONS["zh-CN"]["splash.tagline"]}
              </motion.p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
