import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import HealthBadge from "@/components/HealthBadge";

export default function Home() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <Typography variant="h3" component="h1">
          Wisper Admin
        </Typography>
        <HealthBadge />
      </Box>
      <Typography color="text.secondary">
        Platform administration for Wisper — overview, policy &amp; pricing rules, host and
        consumer moderation, payouts, and audit. Admin-only (gated to the <code>admin</code>{" "}
        role); features are added next.
      </Typography>
    </Container>
  );
}
