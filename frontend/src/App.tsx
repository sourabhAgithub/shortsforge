import {
  Film,
  LayoutGrid,
  Menu,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import ComingSoon from "./pages/ComingSoon";
import Home from "./pages/Home";
import MyVideos from "./pages/MyVideos";
import Settings from "./pages/Settings";
import { GROUPS, TOOLS } from "./tools/registry";

function Logo({ className = "px-3 pb-6" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-deep via-brand to-sky shadow-lg shadow-brand/30">
        <svg viewBox="0 0 24 24" className="size-4 fill-white">
          <path d="M8 5l11 7-11 7z" />
        </svg>
      </div>
      <div className="text-lg font-extrabold tracking-tight">
        Shorts<span className="text-sky">Forge</span>
      </div>
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  soon,
}: {
  to: string;
  icon: typeof Film;
  label: string;
  soon?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
          isActive
            ? "bg-brand/15 text-white"
            : soon
              ? "text-muted/70 hover:bg-white/5"
              : "text-muted hover:bg-white/5 hover:text-white"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`size-4 shrink-0 ${isActive ? "text-sky" : ""}`} />
          <span className="truncate">{label}</span>
          {soon && (
            <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
              Soon
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function App() {
  // Below the lg breakpoint the sidebar is a drawer opened from the top bar.
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenu(false), [pathname]);

  return (
    <div className="flex h-full">
      {menu && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel px-3 py-5 transition-transform lg:static lg:translate-x-0 lg:bg-panel/60 ${
          menu ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setMenu(false)}
          className="absolute top-5 right-3 rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white lg:hidden"
          title="Close menu"
        >
          <X className="size-5" />
        </button>
        <Logo />
        <NavItem to="/" icon={LayoutGrid} label="Dashboard" />
        <NavItem to="/videos" icon={Film} label="My Videos" />
        {GROUPS.map((g) => (
          <div key={g} className="mt-5">
            <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted/60 uppercase">
              {g}
            </div>
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <NavItem
                key={t.id}
                to={`/${t.id}`}
                icon={t.icon}
                label={t.name}
                soon={t.status === "soon"}
              />
            ))}
          </div>
        ))}
        <div className="mt-auto pt-6">
          <NavItem to="/settings" icon={SettingsIcon} label="Settings" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-ink/90 px-3 py-2.5 backdrop-blur lg:hidden">
          <button
            onClick={() => setMenu(true)}
            className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white"
            title="Menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="" />
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/videos" element={<MyVideos />} />
          <Route path="/settings" element={<Settings />} />
          {TOOLS.map((t) => {
            const Component = t.component;
            return (
              <Route
                key={t.id}
                path={`/${t.id}/*`}
                element={Component ? <Component /> : <ComingSoon tool={t} />}
              />
            );
          })}
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}
