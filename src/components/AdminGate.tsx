"use client";

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import BlockIcon from "@mui/icons-material/Block";
import LockIcon from "@mui/icons-material/Lock";
import { ADMIN_GROUP } from "@/lib/auth/jwt";
import { isCognitoConfigured } from "@/lib/auth/storage";
import { useAuth } from "@/lib/auth/context";
import ApiKeySignIn from "@/components/ApiKeySignIn";

/** A centered full-height message used by the non-authenticated states. */
function CenteredMessage({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Container maxWidth="sm" sx={{ minHeight: "100dvh", display: "flex", alignItems: "center" }}>
      <Box
        sx={{
          width: "100%",
          py: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 2,
        }}
      >
        {icon}
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Typography color="text.secondary">{children}</Typography>
        {action}
      </Box>
    </Container>
  );
}

/** Renders children only for an authenticated admin. Everyone else sees the
 *  matching state: a loading spinner, a sign-in prompt, or a clear
 *  not-authorized screen for a valid session that lacks the admin group. */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { status, user, signIn } = useAuth();

  if (status === "loading") {
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress color="primary" aria-label="Checking access" />
      </Box>
    );
  }

  if (status === "unauthenticated") {
    // With Cognito configured, the Hosted-UI flow is unchanged. Without it (local
    // dev), the Hosted-UI button would produce no URL, so offer the paste-a-key
    // form instead — an admin-scoped key from wisper-api's Auth:ApiKeys config map.
    if (!isCognitoConfigured()) {
      return (
        <CenteredMessage
          icon={<LockIcon color="primary" sx={{ fontSize: 48 }} />}
          title="Sign in to Wisper Admin"
          action={<ApiKeySignIn />}
        >
          Cognito isn&apos;t configured, so this is local dev: paste an
          admin-scoped Wisper API key to continue.
        </CenteredMessage>
      );
    }
    return (
      <CenteredMessage
        icon={<LockIcon color="primary" sx={{ fontSize: 48 }} />}
        title="Sign in to Wisper Admin"
        action={
          <Button variant="contained" color="primary" onClick={signIn}>
            Sign in
          </Button>
        }
      >
        This console is restricted to platform administrators. Sign in with your
        Wisper admin account to continue.
      </CenteredMessage>
    );
  }

  if (status === "forbidden") {
    return (
      <CenteredMessage
        icon={<BlockIcon color="error" sx={{ fontSize: 48 }} />}
        title="Not authorized"
      >
        {user?.email ? <strong>{user.email}</strong> : "Your account"} is signed in
        but isn&apos;t a member of the <code>{ADMIN_GROUP}</code> group, so it can&apos;t
        access the admin console. Ask a platform administrator for access.
      </CenteredMessage>
    );
  }

  return <>{children}</>;
}
