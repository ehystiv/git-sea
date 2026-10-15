import type { CSSProperties, ReactNode } from "react";
import styles from "./Badge.module.css";

interface BadgeProps {
  /** Index into the branch palette (--b0 … --b7). */
  color?: number;
  children: ReactNode;
}

export function Badge({ color = 0, children }: BadgeProps) {
  const style = { "--c": `var(--b${color % 8})` } as CSSProperties;
  return (
    <span className={styles.badge} style={style}>
      {children}
    </span>
  );
}
