import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";
import PayoutsPanel from "@/components/PayoutsPanel";

export default function PayoutsPage() {
  return (
    <AdminGate>
      <AdminShell>
        <PayoutsPanel />
      </AdminShell>
    </AdminGate>
  );
}
