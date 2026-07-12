import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";

export default function Home() {
  return (
    <AdminGate>
      <AdminShell>
        <Box sx={{ maxWidth: 720 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Overview
          </Typography>
          <Typography color="text.secondary">
            Platform administration for Wisper — overview, policy &amp; pricing rules,
            host and consumer moderation, payouts, and audit. You&apos;re signed in to the
            admin console; the dashboard, policy editor, and moderation tools are added
            next.
          </Typography>
        </Box>
      </AdminShell>
    </AdminGate>
  );
}
