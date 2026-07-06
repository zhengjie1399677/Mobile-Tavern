import React from "react";
import { motion, AnimatePresence } from "motion/react";

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
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              ease: "easeOut",
            }}
            className="flex flex-col items-center space-y-6"
          >
            {/* Logo/Icon Container */}
            <motion.div
              animate={{
                scale: [1, 1.05, 1],
                filter: [
                  "drop-shadow(0 0 0px var(--primary-glow, rgba(99, 102, 241, 0)))",
                  "drop-shadow(0 0 15px var(--primary-glow, rgba(99, 102, 241, 0.45)))",
                  "drop-shadow(0 0 0px var(--primary-glow, rgba(99, 102, 241, 0)))"
                ]
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="flex items-center justify-center"
            >
              <img src="/logo.png" className="w-24 h-24 object-contain" alt="Logo" />
            </motion.div>

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
                className="h-px bg-primary"
              />
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
                className="text-xs tracking-widest text-muted-foreground pt-1"
              >
                开启你的灵魂交响录
              </motion.p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
