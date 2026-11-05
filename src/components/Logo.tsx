"use client";

import { motion } from "framer-motion";

/** Dalil mark: a compass needle in a circle ("dalil" = guide). */
export default function Logo({ size = 32, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded-full bg-inv-bg text-inv-fg"
      style={{ width: size, height: size }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        animate={spinning ? { rotate: [0, 18, -12, 8, 0] } : { rotate: 0 }}
        transition={spinning ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
        <path d="M12 3.5 L15 12 L12 10.6 L9 12 Z" fill="currentColor" />
        <path d="M12 20.5 L9 12 L12 13.4 L15 12 Z" fill="currentColor" opacity="0.45" />
      </motion.svg>
    </div>
  );
}
