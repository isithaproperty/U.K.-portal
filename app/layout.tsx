import type { Metadata } from "next";
import "./globals.css";
import "./portal.css";
import "./block-register.css";
import "./clean.css";
import "./login.css";
import "./units.css";
import "./tenant.css";
export const metadata: Metadata = {
  title: "London Property Portal",
  description: "UK property register and management workspace.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
