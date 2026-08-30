"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";
import { BanIcon, CalendarIcon, LogOutIcon, MenuIcon, PlusIcon, SettingsIcon, TasksIcon, XIcon, ZapIcon } from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Calendar", icon: <CalendarIcon />, exact: true },
  { href: "/dashboard/tasks", label: "My tasks", icon: <TasksIcon /> },
  { href: "/dashboard/assignment/new", label: "New assignment", icon: <PlusIcon /> },
  { href: "/dashboard/blocked", label: "Blocked times", icon: <BanIcon /> },
  { href: "/upgrade", label: "Upgrade plan", icon: <ZapIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data) setProfile(data as Profile);
        });
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  const tierColours: Record<string, string> = {
    free: "text-dim border-border",
    premium: "text-amber border-amber/30",
    pro: "text-il border-il/30",
  };

  return (
    <div className="min-h-screen bg-navy flex flex-col">
      {/* Top navigation */}
      <header className="h-14 border-b border-border bg-navy flex items-center px-4 gap-4 shrink-0 z-30 sticky top-0">
        {/* Mobile menu toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden text-muted hover:text-text transition-colors p-1 rounded"
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
        >
          {sidebarOpen ? <XIcon size={20} /> : <MenuIcon />}
        </button>

        {/* Logo */}
        <Link
          href="/dashboard"
          className="font-sora text-lg font-semibold text-text hover:text-il transition-colors shrink-0"
        >
          Study<span className="text-il">Flow</span>
        </Link>

        <div className="flex-1" />

        {/* User info */}
        {profile && (
          <div className="flex items-center gap-3">
            <span
              className={`hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full border font-medium ${tierColours[profile.tier]}`}
            >
              {profile.tier.charAt(0).toUpperCase() + profile.tier.slice(1)}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo/20 border border-indigo/30 flex items-center justify-center text-il text-sm font-semibold shrink-0">
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:block text-sm text-text font-medium">
                {profile.name}
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar overlay on mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed top-14 left-0 bottom-0 w-56 bg-navy border-r border-border z-20
            flex flex-col transition-transform duration-200
            lg:static lg:translate-x-0 lg:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          <nav className="flex-1 p-3 space-y-0.5" aria-label="Main navigation">
            <p className="text-xs font-medium text-il tracking-widest uppercase px-3 py-2">
              Menu
            </p>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all
                  ${
                    isActive(item)
                      ? "bg-indigo/20 text-il font-medium"
                      : "text-muted hover:bg-indigo/10 hover:text-text"
                  }
                `}
                aria-current={isActive(item) ? "page" : undefined}
              >
                <span className="shrink-0">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Logout at bottom of sidebar */}
          <div className="p-3 border-t border-border">
            {profile && (
              <div className="px-3 py-2 mb-1">
                <p className="text-xs text-dim truncate">{profile.name}</p>
                <p className="text-xs text-dim/70 truncate">{profile.tier} plan</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:bg-red/10 hover:text-red transition-all w-full text-left"
            >
              <LogOutIcon />
              Log out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
