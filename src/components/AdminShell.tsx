"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import LogoutIcon from "@mui/icons-material/Logout";
import ShieldIcon from "@mui/icons-material/Shield";
import { usePathname } from "next/navigation";
import Link from "next/link";
import HealthBadge from "@/components/HealthBadge";
import { useAuth } from "@/lib/auth/context";

/** Top-level admin navigation. Destinations are built out by later tasks
 *  (AD2 overview/policy, AD3 moderation/payouts/audit); the shell links them now. */
const NAV: { label: string; href: string }[] = [
  { label: "Overview", href: "/" },
  { label: "Policy & Pricing", href: "/policy" },
  { label: "Moderation", href: "/moderation" },
  { label: "Payouts", href: "/payouts" },
  { label: "Audit", href: "/audit" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** The admin app chrome: amber AppBar with brand, primary nav, API health, and
 *  an account menu. Wrap authenticated pages with it. */
export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const closeMenu = () => setAnchor(null);

  const initial = (user?.email || user?.username || "?").charAt(0).toUpperCase();

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "primary.main" }}>
            <ShieldIcon />
            <Typography variant="h6" component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
              Wisper Admin
            </Typography>
          </Box>

          <Box component="nav" aria-label="Admin sections" sx={{ display: "flex", gap: 0.5, ml: 2 }}>
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Button
                  key={item.href}
                  component={Link}
                  href={item.href}
                  size="small"
                  color={active ? "primary" : "inherit"}
                  aria-current={active ? "page" : undefined}
                  sx={{ fontWeight: active ? 700 : 400 }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Box>

          <Box sx={{ flexGrow: 1 }} />
          <HealthBadge />

          <Tooltip title={user?.email || "Account"}>
            <IconButton onClick={openMenu} size="small" sx={{ ml: 1 }} aria-label="Account menu">
              <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main", color: "background.default" }}>
                {initial}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu} keepMounted>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {user?.email || user?.username || "Admin"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Administrator
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                closeMenu();
                signOut();
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Container component="main" maxWidth="lg" sx={{ py: 4, flexGrow: 1 }}>
        {children}
      </Container>
    </Box>
  );
}
