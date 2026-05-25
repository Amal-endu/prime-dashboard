import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConfigProvider } from "@/components/config-provider";
import { ToastProvider } from "@/components/toast-provider";
import { TopNav } from "@/components/top-nav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prime Dashboard — SDD Operations Intelligence",
  description: "Real-time operations intelligence for Shadowfax Prime SDD. Monitor rider performance, delivery metrics, and allocation trends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] antialiased" suppressHydrationWarning>
        <ConfigProvider>
          <ToastProvider>
            <TopNav />
            <main className="flex-1 px-4 sm:px-6 py-5 max-w-[1600px] mx-auto w-full">
              {children}
            </main>
          </ToastProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
